import json
import boto3
from botocore.client import Config as BotoConfig
import uuid
import base64
import urllib.request
import urllib.parse
from decimal import Decimal
from datetime import datetime, timezone


# =============================================================================
# CONFIG
# =============================================================================

AWS_REGION = "us-east-1"

MEDIA_BUCKET = "companio-clinical-media-839581577002"

REKOGNITION_MIN_CONFIDENCE = 70.0


# =============================================================================
# AWS CLIENTS
# =============================================================================

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)

# SigV4 is REQUIRED, not optional, for this bucket.
#
# companio-clinical-media has default SSE-KMS encryption, and S3 refuses any
# KMS-encrypted request signed with the legacy V2 algorithm:
#
#   InvalidArgument: Requests specifying Server Side Encryption with
#   AWS KMS managed keys require AWS Signature Version 4.
#
# boto3's S3 client can still fall back to SigV2 in us-east-1, so every
# presigned upload URL was being signed the wrong way and rejected with an
# opaque 400 -- which is what broke the camera (Rekognition) and voice
# check-in (Transcribe), since both upload through S3 first.
s3 = boto3.client(
    "s3",
    region_name=AWS_REGION,
    config=BotoConfig(signature_version="s3v4"),
)

rekognition = boto3.client(
    "rekognition",
    region_name=AWS_REGION
)

transcribe = boto3.client(
    "transcribe",
    region_name=AWS_REGION
)


# =============================================================================
# DYNAMODB TABLES
# =============================================================================

TABLES = {
    "identity": dynamodb.Table("CompanioIdentity"),
    "clinical-profile": dynamodb.Table("CompanioClinicalProfiles"),
    "therapist-rule": dynamodb.Table("CompanioTherapistRules"),
    "decision": dynamodb.Table("CompanioDecisions"),
    "session": dynamodb.Table("CompanioSessions"),
    "assignment": dynamodb.Table("CompanioAssignments"),
    "note": dynamodb.Table("CompanioNotes"),
}


PRIMARY_KEYS = {
    "identity": "patient_id",
    "clinical-profile": "patient_id",
    "therapist-rule": "rule_id",
    "decision": "decision_id",
    "session": "session_id",
    "assignment": "assignment_id",
    "note": "note_id",
}

# The plural key each resource's "list items for a patient" response uses,
# on top of the generic "items" key -- this is what the mobile client (see
# mobile/src/services/engine.js: getDecisions/getSessions/getNotes/
# getAssignments) actually reads. Before this was added, every one of those
# calls silently returned an empty list, even with real data in the table,
# because the response only ever had "items", never "decisions"/"sessions"/etc.
RESOURCE_LIST_KEYS = {
    "decision": "decisions",
    "session": "sessions",
    "note": "notes",
    "assignment": "assignments",
    "therapist-rule": "rules",
}


# =============================================================================
# BASIC HELPERS
# =============================================================================

def now():
    return datetime.now(timezone.utc).isoformat()


class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            if obj % 1 == 0:
                return int(obj)

            return float(obj)

        return super().default(obj)


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers":
                "Content-Type,Authorization",
            "Access-Control-Allow-Methods":
                "GET,POST,PUT,DELETE,OPTIONS",
        },
        "body": json.dumps(
            body,
            cls=DecimalEncoder
        ),
    }


def parse_body(event):
    body = event.get("body")

    if body is None:
        return {}

    if isinstance(body, str):
        return json.loads(body)

    return body


def get_method(event):
    return (
        event.get("requestContext", {})
        .get("http", {})
        .get(
            "method",
            event.get("httpMethod", "GET")
        )
    )


def get_path(event):
    return (
        event.get("rawPath")
        or event.get("path")
        or "/"
    )


# =============================================================================
# COGNITO / JWT
# =============================================================================

def get_claims(event):
    return (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )


def get_user_sub(event):
    return get_claims(event).get("sub")


def get_username(event):
    claims = get_claims(event)

    return (
        claims.get("cognito:username")
        or claims.get("username")
        or claims.get("sub")
    )


def get_groups(event):
    groups = get_claims(event).get(
        "cognito:groups",
        []
    )

    if isinstance(groups, list):
        return groups

    if not groups:
        return []

    if isinstance(groups, str):

        value = groups.strip()

        try:
            parsed = json.loads(value)

            if isinstance(parsed, list):
                return [
                    str(group).strip()
                    for group in parsed
                ]

        except Exception:
            pass

        value = value.strip("[]")

        return [
            group.strip().strip('"').strip("'")
            for group in value.split(",")
            if group.strip()
        ]

    return []


def has_group(event, group):
    return group in get_groups(event)


def is_patient(event):
    return has_group(event, "PATIENT")


def is_therapist(event):
    return has_group(event, "THERAPIST")


def is_admin(event):
    return has_group(event, "ADMIN")


def is_authenticated(event):
    return bool(get_user_sub(event))


# =============================================================================
# ID + ROUTE HELPERS
# =============================================================================

def make_id(resource):
    prefixes = {
        "therapist-rule": "TR",
        "decision": "D",
        "session": "S",
        "assignment": "A",
        "note": "N",
    }

    prefix = prefixes.get(
        resource,
        "ID"
    )

    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def normalize_resource(path):

    parts = [
        p
        for p in path.split("/")
        if p
    ]

    if not parts:
        return None, []

    aliases = {
        "clinical-profiles": "clinical-profile",
        "clinical-profile": "clinical-profile",

        "identity": "identity",
        "identities": "identity",

        "therapist-rule": "therapist-rule",
        "therapist-rules": "therapist-rule",

        "decision": "decision",
        "decisions": "decision",

        "session": "session",
        "sessions": "session",

        "assignment": "assignment",
        "assignments": "assignment",

        "note": "note",
        "notes": "note",
    }

    return (
        aliases.get(parts[0]),
        parts[1:]
    )


# =============================================================================
# DYNAMODB
# =============================================================================

# Real-identity fields that must live ONLY in CompanioIdentity. A generic
# writer like build_item() otherwise stores whatever the caller sends, so a
# future screen (a therapist intake form, a note editor, anything) could
# accidentally re-introduce a real name into a clinical table exactly the
# way the original AddPatient screen did (fixed in conversation.js -- it was
# sending `name` straight into /clinical-profile). This is the backend half
# of that fix: the guarantee is enforced here, not left to client discipline.
IDENTITY_ONLY_FIELDS = {"name", "username", "display_name", "full_name", "real_name", "first_name", "last_name"}


def build_item(resource, body):

    item = dict(body)

    if resource != "identity":
        for field in IDENTITY_ONLY_FIELDS:
            item.pop(field, None)

    key_name = PRIMARY_KEYS[resource]

    if resource in [
        "identity",
        "clinical-profile",
    ]:

        if not item.get("patient_id"):
            raise ValueError(
                "patient_id is required"
            )

    elif not item.get(key_name):

        item[key_name] = make_id(
            resource
        )

    item["updated_at"] = now()

    if "created_at" not in item:
        item["created_at"] = now()

    return item


def put_resource(resource, body):

    table = TABLES[resource]

    item = build_item(
        resource,
        body
    )

    table.put_item(
        Item=item
    )

    return item


def get_one(resource, item_id):

    table = TABLES[resource]

    key_name = PRIMARY_KEYS[resource]

    result = table.get_item(
        Key={
            key_name: item_id
        }
    )

    return result.get("Item")


def get_by_patient(
    resource,
    patient_id
):

    table = TABLES[resource]

    if PRIMARY_KEYS[resource] == "patient_id":

        item = get_one(
            resource,
            patient_id
        )

        return (
            []
            if item is None
            else [item]
        )

    result = table.scan(
        FilterExpression="patient_id = :pid",
        ExpressionAttributeValues={
            ":pid": patient_id
        }
    )

    return result.get(
        "Items",
        []
    )


def update_resource(
    resource,
    item_id,
    body
):

    table = TABLES[resource]

    key_name = PRIMARY_KEYS[resource]

    existing = get_one(
        resource,
        item_id
    )

    if not existing:
        return None

    protected = {
        key_name,
        "created_at",
        "cognito_sub",
    }

    # Same identity/clinical separation guard as build_item() -- PUT updates
    # go through this function, not that one, so it needs its own copy.
    if resource != "identity":
        protected = protected | IDENTITY_ONLY_FIELDS

    updates = {
        key: value
        for key, value
        in body.items()
        if key not in protected
    }

    updates["updated_at"] = now()

    names = {}
    values = {}
    expressions = []

    for index, (
        field,
        value
    ) in enumerate(updates.items()):

        name_key = f"#n{index}"
        value_key = f":v{index}"

        names[name_key] = field
        values[value_key] = value

        expressions.append(
            f"{name_key} = {value_key}"
        )

    if not expressions:
        return existing

    result = table.update_item(
        Key={
            key_name: item_id
        },
        UpdateExpression=(
            "SET "
            + ", ".join(expressions)
        ),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    )

    return result.get(
        "Attributes"
    )


def delete_resource(
    resource,
    item_id
):

    table = TABLES[resource]

    key_name = PRIMARY_KEYS[resource]

    existing = get_one(
        resource,
        item_id
    )

    if not existing:
        return None

    table.delete_item(
        Key={
            key_name: item_id
        }
    )

    return existing


# =============================================================================
# IDENTITY + ACCESS CONTROL
# =============================================================================

def get_identity_by_sub(user_sub, username=None):
    """Find this signed-in user's identity record.

    Matching on cognito_sub alone was a broken link. A therapist creating a
    patient writes an identity row with patient_id + username, but has no way
    to know that person's Cognito sub -- the patient may not even have signed
    up yet. So the row is written WITHOUT cognito_sub, and a patient who later
    self-registers never matched anything: /me returned no name and no
    patient_id, and the two halves of the account never met.

    Now: match on cognito_sub first (fast path, already linked), and otherwise
    fall back to the username the therapist recorded at intake. On a username
    match, write cognito_sub back so the link is permanent and every later
    lookup takes the fast path. That is the moment the two accounts join.
    """

    if not user_sub:
        return None

    result = TABLES["identity"].scan(
        FilterExpression="cognito_sub = :sub",
        ExpressionAttributeValues={":sub": user_sub},
    )
    items = result.get("Items", [])
    if items:
        return items[0]

    # Not linked yet -- try the username the therapist entered at intake.
    if username:
        by_name = TABLES["identity"].scan(
            FilterExpression="username = :u",
            ExpressionAttributeValues={":u": username},
        )
        candidates = [
            i for i in by_name.get("Items", [])
            if not i.get("cognito_sub")          # never steal a linked record
        ]
        if candidates:
            found = candidates[0]
            try:
                TABLES["identity"].update_item(
                    Key={"patient_id": found["patient_id"]},
                    UpdateExpression="SET cognito_sub = :sub, updated_at = :now",
                    ExpressionAttributeValues={":sub": user_sub, ":now": now()},
                )
                found["cognito_sub"] = user_sub
            except Exception as error:
                print("identity link failed:", repr(error))
            return found

    return None


def get_current_patient_id(event):

    identity = get_identity_by_sub(
        get_user_sub(event),
        get_username(event),
    )

    if not identity:
        return None

    return identity.get(
        "patient_id"
    )


def therapist_is_assigned(
    event,
    patient_id
):

    therapist_sub = get_user_sub(
        event
    )

    if not therapist_sub:
        return False

    result = TABLES[
        "assignment"
    ].scan(
        FilterExpression=(
            "patient_id = :pid "
            "AND therapist_sub = :tsub"
        ),
        ExpressionAttributeValues={
            ":pid": patient_id,
            ":tsub": therapist_sub,
        }
    )

    assignments = result.get(
        "Items",
        []
    )

    for assignment in assignments:

        if assignment.get(
            "active",
            True
        ):
            return True

    return False


def can_access_patient(
    event,
    patient_id
):

    if not patient_id:
        return False

    if is_admin(event):
        return True

    if is_patient(event):

        return (
            get_current_patient_id(event)
            == patient_id
        )

    if is_therapist(event):

        return therapist_is_assigned(
            event,
            patient_id
        )

    return False


# =============================================================================
# CRUD PERMISSIONS
# =============================================================================

def can_post(
    event,
    resource,
    body
):

    patient_id = body.get(
        "patient_id"
    )

    if resource == "identity":
        return is_admin(event)

    if resource == "assignment":

        if is_admin(event):
            return True

        return (
            is_therapist(event)
            and bool(patient_id)
        )

    if resource == "clinical-profile":

        return can_access_patient(
            event,
            patient_id
        )

    if resource in [
        "therapist-rule",
        "note",
    ]:

        if is_admin(event):
            return True

        return (
            is_therapist(event)
            and therapist_is_assigned(
                event,
                patient_id
            )
        )

    if resource in [
        "session",
        "decision",
    ]:

        return can_access_patient(
            event,
            patient_id
        )

    return False


def can_get(
    event,
    resource,
    patient_id
):

    if resource == "note":

        if is_admin(event):
            return True

        return (
            is_therapist(event)
            and therapist_is_assigned(
                event,
                patient_id
            )
        )

    return can_access_patient(
        event,
        patient_id
    )


def can_modify_existing(
    event,
    resource,
    item
):

    if not item:
        return False

    patient_id = item.get(
        "patient_id"
    )

    if resource == "identity":
        return is_admin(event)

    if resource == "clinical-profile":

        if is_admin(event):
            return True

        return (
            is_therapist(event)
            and therapist_is_assigned(
                event,
                patient_id
            )
        )

    if resource in [
        "therapist-rule",
        "note",
    ]:

        if is_admin(event):
            return True

        return (
            is_therapist(event)
            and therapist_is_assigned(
                event,
                patient_id
            )
        )

    if resource == "assignment":

        if is_admin(event):
            return True

        return (
            is_therapist(event)
            and item.get(
                "therapist_sub"
            )
            == get_user_sub(event)
        )

    if resource in [
        "session",
        "decision",
    ]:

        return is_admin(event)

    return False


# =============================================================================
# S3 MEDIA
# =============================================================================

ALLOWED_CONTENT_TYPES = {
    "image/jpeg": ("image", "jpg"),
    "image/png": ("image", "png"),

    "audio/m4a": ("audio", "m4a"),
    "audio/mp4": ("audio", "mp4"),
    "audio/mpeg": ("audio", "mp3"),
    "audio/wav": ("audio", "wav"),
    "audio/x-wav": ("audio", "wav"),
    "audio/webm": ("audio", "webm"),
}


def validate_patient_s3_key(
    patient_id,
    key
):

    expected_prefix = (
        f"patients/{patient_id}/"
    )

    return key.startswith(
        expected_prefix
    )


def create_media_key(
    patient_id,
    content_type
):

    if content_type not in ALLOWED_CONTENT_TYPES:

        raise ValueError(
            "Unsupported media content type"
        )

    media_type, extension = (
        ALLOWED_CONTENT_TYPES[
            content_type
        ]
    )

    object_id = uuid.uuid4().hex

    return (
        f"patients/{patient_id}/"
        f"{media_type}/"
        f"{object_id}.{extension}"
    )


def handle_media_upload_url(
    event,
    body
):

    patient_id = body.get(
        "patient_id"
    )

    content_type = body.get(
        "content_type"
    )

    if not patient_id:
        return response(
            400,
            {
                "error":
                    "patient_id is required"
            }
        )

    if not content_type:
        return response(
            400,
            {
                "error":
                    "content_type is required"
            }
        )

    if not can_access_patient(
        event,
        patient_id
    ):

        return response(
            403,
            {
                "error":
                    "You do not have permission "
                    "to access this patient"
            }
        )

    key = create_media_key(
        patient_id,
        content_type
    )

    # MINIMAL presign, deliberately.
    #
    # A presigned PUT requires the client to send back EXACTLY the headers that
    # were signed, byte for byte. Every extra signed header is another way for
    # the upload to fail with an opaque 400. An earlier version signed
    # ServerSideEncryption=aws:kms on the theory that the bucket required it;
    # that produced "InvalidArgument" instead, because a bucket with DEFAULT
    # encryption applies KMS automatically on a plain PUT and rejects the
    # explicit header when no key id accompanies it.
    #
    # So: sign only the bucket and key. The bucket's own default encryption
    # still applies -- the object is stored SSE-KMS encrypted either way, it is
    # simply S3 that applies it rather than the request asking for it.
    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": MEDIA_BUCKET,
            "Key": key,
        },
        ExpiresIn=900,
    )

    media_type, _ = (
        ALLOWED_CONTENT_TYPES[
            content_type
        ]
    )

    return response(
        200,
        {
            "bucket": MEDIA_BUCKET,
            "s3_key": key,
            "media_type": media_type,
            "upload_url": upload_url,
            "expires_in_seconds": 900,
            # Nothing was signed beyond bucket+key, so the client must send
            # NO extra headers -- any it adds will break the signature.
            "required_headers": {},
        }
    )


def handle_media_delete(event, body):
    """Permanently delete one stored media object.

    The patient's "save audio" and "save images" switches must remove the
    object itself, not just the app's reference to it. A privacy control that cannot delete
    is a promise the app is unable to keep.

    Audio and images must reach S3 for Transcribe and Rekognition to read them,
    so the honest lifecycle is: upload -> process -> delete when the patient has
    not consented to retention. This endpoint is the delete step.

    Authorised for the owning patient or their assigned therapist only, and the
    key must belong to that patient's own prefix.
    """
    patient_id = body.get("patient_id")
    s3_key = body.get("s3_key")

    if not patient_id or not s3_key:
        return response(400, {"error": "patient_id and s3_key are required"})

    if not can_access_patient(event, patient_id):
        return response(403, {"error": "not authorised for this patient"})

    # Prevents deleting another patient's media by passing an arbitrary key.
    if not validate_patient_s3_key(patient_id, s3_key):
        return response(403, {"error": "s3_key does not belong to this patient"})

    try:
        s3.delete_object(Bucket=MEDIA_BUCKET, Key=s3_key)
    except Exception as exc:
        error_id = uuid.uuid4().hex[:12]
        print(f"[{error_id}] media delete failed for {s3_key}: {exc}")
        # Report the failure honestly: the caller must NOT tell the patient the
        # file was deleted when it may still be there.
        return response(500, {
            "error": "could not delete the media object",
            "error_id": error_id,
            "deleted": False,
        })

    return response(200, {"deleted": True, "s3_key": s3_key})


def handle_media_view_url(event, body):
    """
    Secure, short-lived GET for a therapist (or the owning patient) to review
    stored media -- never a public/permanent S3 URL. Added because the mobile
    client (services/engine.js -> getMediaViewUrl, POST /media-url) already
    calls this; it didn't exist in the deployed Lambda before, so every
    "View captured image" / "Play captured audio" button in the app was
    silently failing.
    """

    patient_id = body.get("patient_id")
    s3_key = body.get("s3_key")

    if not patient_id or not s3_key:
        return response(400, {"error": "patient_id and s3_key are required"})

    if not can_access_patient(event, patient_id):
        return response(403, {"error": "You do not have permission to access this patient"})

    # Never trust a client-supplied key blindly -- it must actually belong to
    # this patient's own media prefix, same rule as upload.
    if not validate_patient_s3_key(patient_id, s3_key):
        return response(403, {"error": "Invalid media path for this patient"})

    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": MEDIA_BUCKET, "Key": s3_key},
        ExpiresIn=300,
    )

    return response(200, {"url": url, "expires_in_seconds": 300})


# =============================================================================
# SERVER-SIDE PUSH
# =============================================================================
# The client asks the backend to notify; push tokens never leave the
# server. One user's device must not decide where another user's
# notifications go, and a therapist's token must not be readable by the
# patients assigned to them. The backend resolves the recipient, and
# every attempt is recorded as a delivery ledger entry.

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def _find_therapist_push_token(patient_id):
    result = TABLES["assignment"].scan(
        FilterExpression="patient_id = :pid AND active = :a",
        ExpressionAttributeValues={":pid": patient_id, ":a": True},
    )
    items = result.get("Items", [])
    items.sort(key=lambda a: a.get("updated_at", ""), reverse=True)
    for a in items:
        if a.get("therapist_push_token"):
            return a["therapist_push_token"]
    return None


def _find_patient_push_token(patient_id):
    profile = get_one("clinical-profile", patient_id) or {}
    return profile.get("push_token")


def _send_expo_push(token, title, body_text, data):
    payload = json.dumps({
        "to": token,
        "title": title,
        "body": body_text,
        "sound": "default",
        "priority": "high",
        "data": data or {},
    }).encode("utf-8")
    req = urllib.request.Request(
        EXPO_PUSH_URL,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        out = json.loads(res.read().decode("utf-8"))
    status = (out.get("data") or {}).get("status")
    return status == "ok", status or "unknown"


def handle_notify(event, body):
    """Deliver a push to the other side of this patient's care relationship.

    to="therapist": the patient's assigned therapist. to="patient": the patient
    themselves (e.g. an acknowledgement). The caller must already be authorised
    for the patient; which token is used is decided HERE, never by the client.
    """
    patient_id = body.get("patient_id")
    target = str(body.get("to") or "therapist").strip().lower()
    title = str(body.get("title") or "Companio")[:120]
    text = str(body.get("body") or "")[:300]

    if not patient_id:
        return response(400, {"error": "patient_id is required"})
    if target not in ("therapist", "patient"):
        return response(400, {"error": "to must be 'therapist' or 'patient'"})
    if not can_access_patient(event, patient_id):
        return response(403, {"error": "not authorised for this patient"})

    token = (_find_therapist_push_token(patient_id) if target == "therapist"
             else _find_patient_push_token(patient_id))

    delivered = False
    reason = "no_token"
    if token:
        try:
            delivered, reason = _send_expo_push(token, title, text, body.get("data"))
        except Exception as exc:
            reason = f"push_error: {exc}"

    # The delivery ledger: every attempt is a record the app can show, so a
    # failed delivery is never silently indistinguishable from a sent one.
    try:
        put_resource("session", {
            "patient_id": patient_id,
            "type": "notification_delivery",
            "target": target,
            "title": title,
            "delivered": delivered,
            "delivery_status": reason,
        })
    except Exception as exc:
        print("delivery ledger write failed:", repr(exc))

    return response(200, {"delivered": delivered, "status": reason})


# =============================================================================
# /me AND /my-patients
# =============================================================================
# Neither of these existed in the deployed Lambda before. Their absence meant
# the app could never resolve "who am I" or a therapist's real caseload from
# AWS at all -- every /me and /my-patients call 404'd, silently falling back
# to whatever the JWT itself carried (see mobile/src/app/AppContext.js's
# resolveUser try/catch) or to empty state.
# =============================================================================

def get_assigned_therapist_username(patient_id):
    """The real, active therapist assigned to this patient, or None. Never a
    hardcoded name -- reads the actual CompanioAssignments record."""

    result = TABLES["assignment"].scan(
        FilterExpression="patient_id = :pid AND active = :a",
        ExpressionAttributeValues={":pid": patient_id, ":a": True},
    )

    items = result.get("Items", [])
    if not items:
        return None

    items.sort(key=lambda a: a.get("updated_at", ""), reverse=True)
    return items[0].get("therapist_username")


def handle_me(event):

    groups = get_groups(event)
    username = get_username(event)

    if is_patient(event):
        identity = get_identity_by_sub(get_user_sub(event), get_username(event))
        patient_id = identity.get("patient_id") if identity else None

        return response(200, {
            "username": username,
            # Real name typed by the therapist at intake (CompanioIdentity's
            # "username" field is actually used as the real display name --
            # see AddPatient's saveIdentity call on the mobile side) -- never
            # a hardcoded placeholder. None if this patient has no identity
            # record yet (e.g. account exists in Cognito but nobody has
            # actually added them as a patient -- an honest state, not a bug).
            "name": (identity.get("display_name") or identity.get("username")) if identity else None,
            "role": "PATIENT",
            "patient_id": patient_id,
            "therapist_name": get_assigned_therapist_username(patient_id) if patient_id else None,
            "groups": groups,
        })

    if is_therapist(event):
        return response(200, {
            "username": username,
            "role": "THERAPIST",
            "groups": groups,
        })

    return response(403, {"error": "account has no PATIENT or THERAPIST group"})


def handle_my_patients(event):

    if not is_therapist(event):
        return response(403, {"error": "therapist role required"})

    therapist_sub = get_user_sub(event)

    result = TABLES["assignment"].scan(
        FilterExpression="therapist_sub = :tsub AND active = :a",
        ExpressionAttributeValues={":tsub": therapist_sub, ":a": True},
    )

    out = []
    for assignment in result.get("Items", []):
        pid = assignment.get("patient_id")
        if not pid:
            continue

        identity = get_one("identity", pid) or {}
        profile = get_one("clinical-profile", pid) or {}

        out.append({
            "patient_id": pid,
            # Real name from CompanioIdentity, never the clinical profile
            # (which per the privacy design should never hold a name) and
            # never a hardcoded fallback -- falls back to the codename itself
            # only when no identity record exists yet.
            "name": identity.get("display_name") or identity.get("username") or pid,
            "condition": profile.get("condition") or "PTSD",
        })

    return response(200, {"patients": out})


def handle_identity_by_username(event, path):
    """Resolve a login username to its patient_id, for the therapist's
    Add Patient screen: connecting an EXISTING account must reuse its record,
    never clone a blank duplicate beside it (the therapist then ends up
    managing a ghost record the patient's own app never resolves to).

    When more than one identity row claims the username, prefer the row a
    real signed-in account has linked itself to (cognito_sub present), then
    the oldest -- the original record wins over any stray duplicate.
    """
    if not is_therapist(event):
        return response(403, {"error": "therapist role required"})

    username = urllib.parse.unquote(path.split("/")[-1]).strip()
    if not username:
        return response(400, {"error": "username required"})

    result = TABLES["identity"].scan(
        FilterExpression="username = :u",
        ExpressionAttributeValues={":u": username},
    )
    items = result.get("Items", [])
    if not items:
        return response(404, {"error": "no patient with that username"})

    items.sort(key=lambda i: (0 if i.get("cognito_sub") else 1,
                              str(i.get("created_at") or "9999")))
    top = items[0]
    return response(200, {
        "patient_id": top.get("patient_id"),
        "display_name": top.get("display_name") or top.get("username"),
    })


# =============================================================================
# REKOGNITION
# =============================================================================

# =============================================================================
# TRIGGER VOCABULARY -- GENERATED. DO NOT EDIT BY HAND.
#
# Source of truth: shared/trigger_vocabulary.json
# Regenerate with: python3 tools/sync_trigger_vocabulary.py
# =============================================================================
TRIGGER_VOCABULARY_VERSION = 2
WEAK_MATCH_FACTOR = 0.35
DEFAULT_TRIGGER_THRESHOLD = 0.5
MIN_LABEL_CONFIDENCE = 55

# Specific aliases: a match here is real evidence and can stand alone.
TRIGGER_ALIASES = {
    'trash bag': {'trash', 'garbage', 'waste', 'refuse', 'rubbish', 'litter', 'bin bag', 'garbage bag', 'trash bag', 'dumpster'},
    'truck': {'truck', 'lorry', 'pickup truck', 'semi', '18-wheeler'},
    'crowd': {'crowd', 'audience', 'parade', 'mob', 'protest', 'concert'},
    'fireworks': {'fireworks', 'firework', 'pyrotechnics', 'sparkler'},
    'gun': {'gun', 'weapon', 'rifle', 'handgun', 'firearm', 'pistol'},
    'blood': {'blood', 'wound', 'injury'},
    'loud noise': {'siren', 'alarm', 'horn', 'helicopter', 'aircraft', 'airplane', 'jet'},
    'water': {'water', 'flood', 'ocean', 'sea', 'wave', 'river'},
    'dark': {'night', 'darkness', 'tunnel'},
}

# Weak aliases: everyday words that cannot fire a trigger on their own.
WEAK_TRIGGER_ALIASES = {
    'trash bag': {'bag', 'plastic bag', 'debris', 'bin'},
    'truck': {'vehicle', 'transportation', 'automobile', 'car', 'van', 'traffic'},
    'crowd': {'gathering', 'group'},
    'fireworks': {'explosion', 'flare', 'smoke', 'fire', 'flame'},
    'loud noise': {'speaker'},
}

# Never evidence of anything; discarded before matching.
GENERIC_LABELS = {'person', 'people', 'human', 'face', 'adult', 'man', 'woman', 'clothing', 'apparel', 'photography', 'portrait', 'head', 'indoors', 'outdoors', 'text'}


def detect_trigger_candidates(
    labels
):

    label_names = {
        label["name"].lower()
        for label in labels
    }

    candidates = []

    for trigger, aliases in (
        TRIGGER_ALIASES.items()
    ):

        if label_names.intersection(
            aliases
        ):
            candidates.append(
                trigger
            )

    return candidates


def get_clinical_profile_item(patient_id):
    """This patient's clinical profile, or {} when there is none.

    Used by the rule matcher so the approved/forbidden checks and the
    minimum-risk condition operate on the therapist's REAL care plan rather
    than on whatever the caller happened to send.
    """
    try:
        return get_one("clinical-profile", patient_id) or {}
    except Exception:
        # A profile that cannot be read must not crash a decision that is
        # happening during a patient episode. An empty profile simply means the
        # approved/forbidden checks cannot narrow anything.
        return {}


def get_patient_rules(
    patient_id
):

    rules = get_by_patient(
        "therapist-rule",
        patient_id
    )

    return [
        rule
        for rule in rules
        if rule.get(
            "active",
            True
        )
    ]


def rule_trigger_values(rule):

    triggers = []

    single = rule.get(
        "trigger"
    )

    if single:
        triggers.append(
            str(single)
            .strip()
            .lower()
        )

    multiple = rule.get(
        "triggers",
        []
    )

    if isinstance(
        multiple,
        list
    ):

        for trigger in multiple:

            triggers.append(
                str(trigger)
                .strip()
                .lower()
            )

    return triggers


# Risk ordering, identical to RiskLevel in the Python engine. Any other
# spelling is treated as the lowest level rather than guessed upward: inventing
# a higher risk than was measured would fire rules that should not fire.
RISK_ORDER = {
    "baseline": 0,
    "elevated": 1,
    "high": 2,
    "critical": 3,
}


def risk_at_least(current, minimum):
    """True when `current` is at least as severe as `minimum`."""
    if not minimum:
        return True
    return (
        RISK_ORDER.get(str(current or "baseline").strip().lower(), 0)
        >= RISK_ORDER.get(str(minimum).strip().lower(), 0)
    )


def canonical_triggers(values):
    """Map raw labels to canonical concepts using the shared vocabulary.

    Generic labels (a person, a face, "outdoors") are dropped: they are never
    evidence of a trigger. This mirrors the mobile client and the Python engine
    exactly -- this file used to map "person" onto the "crowd" trigger while
    the mobile client discarded it, so the same photograph matched a trigger on
    one path and not the other.
    """
    out = set()
    for raw in values or []:
        word = str(raw).strip().lower()
        if not word or word in GENERIC_LABELS:
            continue
        hit = None
        for concept, aliases in TRIGGER_ALIASES.items():
            if word == concept or word in aliases:
                hit = concept
                break
        if hit is None:
            for concept, aliases in WEAK_TRIGGER_ALIASES.items():
                if word in aliases:
                    hit = concept
                    break
        out.add(hit or word)
    return out


def find_best_matching_rule(
    patient_id,
    observed_triggers,
    risk_level=None,
    profile=None,
):
    """Pick the therapist rule that governs this moment.

    MUST stay identical to decide_from_rules() in
    therapist_engine/src/engines/decision_engine.py: a rule counts only if it
    is active, its own `min_risk_level` is met, and its action passes the
    patient's approved and forbidden lists; priority ties must not depend on
    whatever order the database
    returned. The same event could therefore fire a therapist rule here and not
    in the Python engine, so a patient's care depended on which engine happened
    to be reachable. Therapist rules are meant to be the one deterministic
    layer in the system.
    """
    observed = canonical_triggers(observed_triggers)

    profile = profile or {}
    approved = {
        str(a).strip().lower()
        for a in (profile.get("approved_interventions") or [])
    }
    forbidden = {
        str(a).strip().lower()
        for a in (profile.get("forbidden_interventions") or [])
    }

    matches = []

    for rule in get_patient_rules(patient_id):
        # (a) the therapist switched this rule off
        if rule.get("active") is False:
            continue

        # (b) defensive: never apply another patient's rule
        if rule.get("patient_id") and rule["patient_id"] != patient_id:
            continue

        # (c) the rule's own minimum risk must be met
        if not risk_at_least(risk_level, rule.get("min_risk_level")):
            continue

        # (d) trigger overlap, on canonical concepts
        configured = canonical_triggers(rule_trigger_values(rule))
        if not configured:
            continue
        if not configured.intersection(observed):
            continue

        matches.append(rule)

    if not matches:
        return None

    # Deterministic: highest priority wins, ties broken by rule_id ascending so
    # two engines given the same rules always choose the same one.
    matches.sort(
        key=lambda r: (
            -int(r.get("priority", 0) or 0),
            str(r.get("rule_id", "")),
        )
    )
    # (e) even a therapist rule may only offer an approved, non-forbidden
    # action. Filter invalid rules FIRST and then take the highest-priority
    # survivor, so a stale high-priority rule whose action left the care plan
    # cannot block every valid rule below it.
    for candidate in matches:
        action = str(candidate.get("approved_action", "")).strip().lower()
        if action and action in forbidden:
            continue
        if approved and action and action not in approved:
            continue
        return candidate

    return None


def handle_recognize(
    event,
    body
):

    patient_id = body.get(
        "patient_id"
    )

    if not patient_id:

        return response(
            400,
            {
                "error":
                    "patient_id is required"
            }
        )

    if not can_access_patient(
        event,
        patient_id
    ):

        return response(
            403,
            {
                "error":
                    "You do not have permission "
                    "to access this patient"
            }
        )

    image_base64 = body.get(
        "image_base64"
    )

    s3_key = body.get(
        "s3_key"
    )

    if not image_base64 and not s3_key:

        return response(
            400,
            {
                "error":
                    "Provide image_base64 or s3_key"
            }
        )

    if s3_key:

        if not validate_patient_s3_key(
            patient_id,
            s3_key
        ):

            return response(
                403,
                {
                    "error":
                        "Invalid media path "
                        "for this patient"
                }
            )

        image = {
            "S3Object": {
                "Bucket": MEDIA_BUCKET,
                "Name": s3_key,
            }
        }

    else:

        try:
            image_bytes = base64.b64decode(
                image_base64
            )

        except Exception:

            return response(
                400,
                {
                    "error":
                        "Invalid base64 image"
                }
            )

        image = {
            "Bytes": image_bytes
        }

    result = rekognition.detect_labels(
        Image=image,
        MaxLabels=30,
        MinConfidence=
            REKOGNITION_MIN_CONFIDENCE,
    )

    labels = [
        {
            "name":
                label["Name"],

            "confidence":
                round(
                    float(
                        label[
                            "Confidence"
                        ]
                    ),
                    2
                ),
        }
        for label
        in result.get(
            "Labels",
            []
        )
    ]

    trigger_candidates = (
        detect_trigger_candidates(
            labels
        )
    )

    # The rule conditions need the patient's real risk level and care plan.
    # Passing neither would leave min_risk_level and the approved/forbidden
    # checks inert, which is exactly the state this fix removes.
    recognize_profile = get_clinical_profile_item(patient_id) or {}
    recognize_risk = (
        body.get("risk_level")
        or recognize_profile.get("risk_level")
        or "baseline"
    )

    matched_rule = (
        find_best_matching_rule(
            patient_id,
            trigger_candidates,
            risk_level=recognize_risk,
            profile=recognize_profile,
        )
    )

    rule_result = None

    if matched_rule:

        rule_result = {
            "rule_id":
                matched_rule.get(
                    "rule_id"
                ),

            "trigger":
                matched_rule.get(
                    "trigger"
                ),

            "intervention":
                matched_rule.get(
                    "intervention"
                )
                or matched_rule.get(
                    "approved_action"
                ),

            "instructions":
                matched_rule.get(
                    "instructions"
                ),

            "priority":
                matched_rule.get(
                    "priority"
                ),
        }

    return response(
        200,
        {
            "labels": labels,

            "trigger_candidates":
                trigger_candidates,

            "known_trigger":
                matched_rule is not None,

            "matched_rule":
                rule_result,
        }
    )


# =============================================================================
# TRANSCRIPTION
# =============================================================================

SUPPORTED_TRANSCRIBE_FORMATS = {
    "m4a",
    "mp3",
    "mp4",
    "wav",
    "webm",
    "flac",
    "ogg",
    "amr",
}


def media_format_from_key(
    s3_key
):

    extension = (
        s3_key
        .rsplit(".", 1)[-1]
        .lower()
    )

    if extension not in (
        SUPPORTED_TRANSCRIBE_FORMATS
    ):

        raise ValueError(
            f"Unsupported transcription "
            f"format: {extension}"
        )

    return extension


def find_session_by_job(
    job_name
):

    result = TABLES[
        "session"
    ].scan(
        FilterExpression=(
            "transcription_job_name = :job"
        ),
        ExpressionAttributeValues={
            ":job": job_name
        }
    )

    items = result.get(
        "Items",
        []
    )

    return (
        items[0]
        if items
        else None
    )


def fetch_transcript_text(
    transcript_uri
):

    with urllib.request.urlopen(
        transcript_uri,
        timeout=10
    ) as result:

        data = json.loads(
            result.read()
            .decode("utf-8")
        )

    transcripts = (
        data.get(
            "results",
            {}
        )
        .get(
            "transcripts",
            []
        )
    )

    if not transcripts:
        return ""

    return transcripts[0].get(
        "transcript",
        ""
    )


def handle_start_transcription(
    event,
    body
):

    patient_id = body.get(
        "patient_id"
    )

    s3_key = body.get(
        "s3_key"
    )

    language_code = body.get(
        "language_code",
        "en-US"
    )

    if not patient_id:

        return response(
            400,
            {
                "error":
                    "patient_id is required"
            }
        )

    if not s3_key:

        return response(
            400,
            {
                "error":
                    "s3_key is required"
            }
        )

    if not can_access_patient(
        event,
        patient_id
    ):

        return response(
            403,
            {
                "error":
                    "You do not have permission "
                    "to access this patient"
            }
        )

    if not validate_patient_s3_key(
        patient_id,
        s3_key
    ):

        return response(
            403,
            {
                "error":
                    "Invalid media path "
                    "for this patient"
            }
        )

    media_format = (
        media_format_from_key(
            s3_key
        )
    )

    job_name = (
        f"companio-"
        f"{patient_id}-"
        f"{uuid.uuid4().hex[:16]}"
    )

    media_uri = (
        f"s3://"
        f"{MEDIA_BUCKET}/"
        f"{s3_key}"
    )

    transcribe.start_transcription_job(
        TranscriptionJobName=
            job_name,

        LanguageCode=
            language_code,

        MediaFormat=
            media_format,

        Media={
            "MediaFileUri":
                media_uri
        },
    )

    session_id = (
        body.get(
            "session_id"
        )
        or make_id(
            "session"
        )
    )

    existing = get_one(
        "session",
        session_id
    )

    session_data = {
        "patient_id":
            patient_id,

        "type":
            "voice_transcription",

        "audio_s3_key":
            s3_key,

        "transcription_job_name":
            job_name,

        "transcription_status":
            "IN_PROGRESS",
    }

    if existing:

        update_resource(
            "session",
            session_id,
            session_data
        )

    else:

        session_data[
            "session_id"
        ] = session_id

        put_resource(
            "session",
            session_data
        )

    return response(
        200,
        {
            "message":
                "Transcription started",

            "job_name":
                job_name,

            "session_id":
                session_id,

            "status":
                "IN_PROGRESS",
        }
    )


def handle_get_transcription(
    event,
    job_name
):

    session = find_session_by_job(
        job_name
    )

    if not session:

        return response(
            404,
            {
                "error":
                    "Transcription job not found"
            }
        )

    patient_id = session.get(
        "patient_id"
    )

    if not can_access_patient(
        event,
        patient_id
    ):

        return response(
            403,
            {
                "error":
                    "You do not have permission "
                    "to access this transcription"
            }
        )

    result = (
        transcribe
        .get_transcription_job(
            TranscriptionJobName=
                job_name
        )
    )

    job = result[
        "TranscriptionJob"
    ]

    status = job[
        "TranscriptionJobStatus"
    ]

    if status == "FAILED":

        reason = job.get(
            "FailureReason",
            "Unknown failure"
        )

        update_resource(
            "session",
            session["session_id"],
            {
                "transcription_status":
                    "FAILED",

                "transcription_failure_reason":
                    reason,
            }
        )

        return response(
            500,
            {
                "status":
                    "FAILED",

                "error":
                    reason,
            }
        )

    if status != "COMPLETED":

        return response(
            200,
            {
                "status":
                    status,

                "job_name":
                    job_name,

                "session_id":
                    session[
                        "session_id"
                    ],
            }
        )

    transcript_uri = (
        job[
            "Transcript"
        ][
            "TranscriptFileUri"
        ]
    )

    transcript = (
        fetch_transcript_text(
            transcript_uri
        )
    )

    updated_session = (
        update_resource(
            "session",
            session[
                "session_id"
            ],
            {
                "transcription_status":
                    "COMPLETED",

                "transcript":
                    transcript,
            }
        )
    )

    return response(
        200,
        {
            "status":
                "COMPLETED",

            "job_name":
                job_name,

            "session_id":
                session[
                    "session_id"
                ],

            "transcript":
                transcript,

            "session":
                updated_session,
        }
    )


# =============================================================================
# SAFE RESPONSE / THERAPIST RULE FIRST
# =============================================================================

SAFE_FALLBACK_MESSAGE = (
    "I'm here with you. "
    "Let's take this one breath at a time, together."
)


def save_decision(
    patient_id,
    source,
    action,
    observed,
    risk_level,
    message,
    rule_id=None,
):

    item = {
        "patient_id":
            patient_id,

        "decision_source":
            source,

        "therapist_rule_id":
            rule_id,

        "selected_action":
            action,

        "observed_triggers":
            observed,

        "risk_level":
            risk_level,

        "message":
            message,

        "timestamp":
            now(),
    }

    return put_resource(
        "decision",
        item
    )


def handle_respond(
    event,
    body
):

    patient_id = body.get(
        "patient_id"
    )

    transcript = (
        body.get(
            "transcript",
            ""
        )
        .strip()
    )

    observed_triggers = body.get(
        "observed_triggers",
        []
    )

    risk_level = body.get(
        "risk_level",
        "baseline"
    )

    if not patient_id:

        return response(
            400,
            {
                "error":
                    "patient_id is required"
            }
        )

    if not can_access_patient(
        event,
        patient_id
    ):

        return response(
            403,
            {
                "error":
                    "You do not have permission "
                    "to access this patient"
            }
        )

    # Also compare transcript words with
    # therapist-defined triggers.

    combined_triggers = list(
        observed_triggers
    )

    transcript_lower = (
        transcript.lower()
    )

    # Canonicalise the transcript's words once, then compare CONCEPTS, exactly
    # as the visual path does. Raw substring matching let "bag" inside
    # "baggage" fire a trigger while the camera path would have discounted it.
    transcript_concepts = canonical_triggers(
        transcript_lower.replace(",", " ").replace(".", " ").split()
    )

    for rule in get_patient_rules(
        patient_id
    ):

        rule_concepts = canonical_triggers(
            rule_trigger_values(rule)
        )

        for trigger in rule_concepts:

            if trigger and trigger in transcript_concepts:

                combined_triggers.append(
                    trigger
                )

    combined_triggers = list(
        dict.fromkeys(
            combined_triggers
        )
    )

    respond_profile = get_clinical_profile_item(patient_id) or {}

    matched_rule = (
        find_best_matching_rule(
            patient_id,
            combined_triggers,
            risk_level=risk_level,
            profile=respond_profile,
        )
    )

    if matched_rule:

        action = (
            matched_rule.get(
                "intervention"
            )
            or matched_rule.get(
                "approved_action"
            )
            or "therapist-approved grounding"
        )

        # Speak TO the patient, not about them. A rule's "instructions" field
        # is written by a clinician and often reads as a note about the patient
        # ("guide the patient through grounding") -- read aloud during an
        # episode that addresses them in the third person. Use the therapist's
        # words only when they were clearly written for the patient, and
        # otherwise turn the action into a second-person invitation.
        instructions = (matched_rule.get("instructions") or "").strip()

        clinical_phrasing = any(
            marker in instructions.lower()
            for marker in ("the patient", "patient's", "guide them", "encourage them", "prompt them")
        )

        if instructions and not clinical_phrasing:
            message = instructions
        else:
            spoken_action = action
            lowered = spoken_action.lower()
            for prefix in (
                "guide the patient through ", "guide the patient ", "guide them through ",
                "offer the patient ", "offer them ", "encourage the patient to ",
                "encourage them to ", "prompt the patient to ", "prompt them to ",
                "help the patient ", "help them ", "offer ", "guide ",
            ):
                if lowered.startswith(prefix):
                    spoken_action = spoken_action[len(prefix):]
                    break
            spoken_action = spoken_action.rstrip(".")
            message = (
                f"Let's try {spoken_action} together. I'm here with you."
                if spoken_action else
                SAFE_FALLBACK_MESSAGE
            )

        decision = save_decision(
            patient_id=
                patient_id,

            source=
                "therapist_rule",

            action=
                action,

            observed=
                combined_triggers,

            risk_level=
                risk_level,

            message=
                message,

            rule_id=
                matched_rule.get(
                    "rule_id"
                ),
        )

        return response(
            200,
            {
                "decision_source":
                    "therapist_rule",

                "message":
                    message,

                "action":
                    action,

                "matched_rule_id":
                    matched_rule.get(
                        "rule_id"
                    ),

                "decision":
                    decision,
            }
        )

    # -------------------------------------------------------------------------
    # No therapist rule matched.
    #
    # This is intentionally a SAFE BOUNDED FALLBACK,
    # not an unrestricted medical AI. The real bounded-AI reasoning (the
    # recommender + bandit + distress gate) lives in therapist_engine/,
    # reachable only from the patient's own phone over the LAN -- this
    # Lambda has no path to that machine, so it never pretends to reason;
    # it honestly falls back instead. See mobile/src/services/decide.js
    # for the client-side logic that tries the real engine FIRST and only
    # calls this endpoint when that's unreachable.
    # -------------------------------------------------------------------------

    profile = get_one(
        "clinical-profile",
        patient_id
    ) or {}

    # Interventions the patient has ALREADY been offered in this episode and
    # said did not help. Repeating one of these is worse than saying nothing:
    # it tells someone in distress that nothing they said was heard.
    excluded = {
        str(a).strip().lower()
        for a in (body.get("exclude_actions") or [])
    }

    # Everything the therapist actually approved for this patient, minus
    # anything explicitly forbidden, minus anything already tried and failed.
    approved = [
        a for a in (profile.get("approved_interventions") or [])
        if str(a).strip().lower() not in excluded
        and str(a).strip().lower() not in {
            str(f).strip().lower()
            for f in (profile.get("forbidden_interventions") or [])
        }
    ]

    # preferred_intervention is only a starting preference, and only counts if
    # it hasn't already failed this episode AND is still on the current
    # approved list -- a stale preference left over from earlier care-plan
    # wording must not outrank what the therapist approves today.
    preferred = profile.get("preferred_intervention")
    if preferred and str(preferred).strip().lower() in excluded:
        preferred = None
    if preferred and str(preferred).strip().lower() not in {
        str(a).strip().lower() for a in approved
    }:
        preferred = None

    # Walk the remaining approved options rather than answering with the
    # same suggestion forever: a retry after "that didn't help" must produce
    # a different message.
    if preferred:
        action = preferred
    elif approved:
        # Walk the therapist's approved list IN ORDER: the first option not
        # yet tried this episode. Every approved intervention gets its turn
        # before the "nothing left" handover below.
        action = approved[0]
    else:
        action = None

    if action:
        # Only call it "therapist-approved" when it genuinely came from the
        # therapist's approved list -- not for a generic fallback.
        # Directive, not interrogative: mid-episode, an open question hands a
        # dysregulated person a decision to make, which is itself a load.
        message = (
            "I'm right here with you. Let's try "
            f"{action}."
        )
    else:
        # Nothing approved is left to offer. Say so honestly and flag it,
        # rather than recycling something that already didn't work.
        action = "offer neutral grounding; flag for therapist review"
        message = (
            "I won't keep suggesting the same thing. "
            "Let's reach your therapist right now. "
            "You don't have to do this alone."
        )

    decision = save_decision(
        patient_id=
            patient_id,

        source=
            "safe_fallback",

        action=
            action,

        observed=
            combined_triggers,

        risk_level=
            risk_level,

        message=
            message,
    )

    return response(
        200,
        {
            "decision_source":
                "safe_fallback",

            "message":
                message,

            "action":
                action,

            "needs_therapist_review":
                True,

            "decision":
                decision,
        }
    )


# =============================================================================
# MAIN LAMBDA HANDLER
# =============================================================================

def lambda_handler(event, context):

    try:

        method = get_method(
            event
        )

        path = get_path(
            event
        )

        if method == "OPTIONS":

            return response(
                200,
                {}
            )

        if not is_authenticated(
            event
        ):

            return response(
                401,
                {
                    "error":
                        "Authentication required"
                }
            )

        body = parse_body(
            event
        )


        # =====================================================================
        # /me and /my-patients
        # =====================================================================

        if path == "/me" and method == "GET":
            return handle_me(event)

        if path == "/my-patients" and method == "GET":
            return handle_my_patients(event)

        if path.startswith("/identity-by-username/") and method == "GET":
            return handle_identity_by_username(event, path)


        # =====================================================================
        # MEDIA UPLOAD URL
        # =====================================================================

        if (
            path == "/media-upload-url"
            and method == "POST"
        ):

            return handle_media_upload_url(
                event,
                body
            )


        # =====================================================================
        # SECURE MEDIA VIEW URL
        # =====================================================================

        if path == "/media-url" and method == "POST":
            return handle_media_view_url(event, body)


        # =====================================================================
        # DELETE STORED MEDIA
        # =====================================================================
        # Makes the "save audio" / "save images" privacy switches real: media
        # can now be removed after processing rather than only unreferenced.

        if path == "/media" and method == "DELETE":
            return handle_media_delete(event, body)


        # =====================================================================
        # SERVER-SIDE PUSH
        # =====================================================================

        if path == "/notify" and method == "POST":
            return handle_notify(event, body)


        # =====================================================================
        # REKOGNITION
        # =====================================================================

        if (
            path == "/recognize"
            and method == "POST"
        ):

            return handle_recognize(
                event,
                body
            )


        # =====================================================================
        # START TRANSCRIPTION
        # =====================================================================

        if (
            path == "/transcription"
            and method == "POST"
        ):

            return handle_start_transcription(
                event,
                body
            )


        # =====================================================================
        # GET TRANSCRIPTION RESULT
        # =====================================================================

        if (
            path.startswith(
                "/transcription/"
            )
            and method == "GET"
        ):

            job_name = path.split(
                "/"
            )[-1]

            return handle_get_transcription(
                event,
                job_name
            )


        # =====================================================================
        # RESPONSE ENGINE
        # =====================================================================

        if (
            path == "/respond"
            and method == "POST"
        ):

            return handle_respond(
                event,
                body
            )


        # =====================================================================
        # EXISTING CRUD
        # =====================================================================

        resource, rest = (
            normalize_resource(
                path
            )
        )

        if resource not in TABLES:

            return response(
                404,
                {
                    "error":
                        f"Unknown route: {path}"
                }
            )


        # ---------------------------------------------------------------------
        # POST
        # ---------------------------------------------------------------------

        if method == "POST":

            if not can_post(
                event,
                resource,
                body
            ):

                return response(
                    403,
                    {
                        "error":
                            "You do not have permission "
                            "to create this resource"
                    }
                )

            if (
                resource
                == "assignment"
                and is_therapist(
                    event
                )
                and not is_admin(
                    event
                )
            ):

                body = dict(
                    body
                )

                body[
                    "therapist_sub"
                ] = get_user_sub(
                    event
                )

                body[
                    "therapist_username"
                ] = get_username(
                    event
                )

                body[
                    "active"
                ] = body.get(
                    "active",
                    True
                )

            item = put_resource(
                resource,
                body
            )

            return response(
                200,
                {
                    "message":
                        f"{resource} "
                        f"saved successfully",

                    "item":
                        item,
                }
            )


        # ---------------------------------------------------------------------
        # GET
        # ---------------------------------------------------------------------

        if method == "GET":

            if not rest:

                return response(
                    400,
                    {
                        "error":
                            "ID or patient_id "
                            "is required"
                    }
                )

            identifier = rest[0]

            if resource in [
                "identity",
                "clinical-profile",
            ]:

                patient_id = identifier

                if not can_get(
                    event,
                    resource,
                    patient_id
                ):

                    return response(
                        403,
                        {
                            "error":
                                "You do not have permission "
                                "to access this patient"
                        }
                    )

                item = get_one(
                    resource,
                    patient_id
                )

                if not item:

                    return response(
                        404,
                        {
                            "error":
                                "Not found"
                        }
                    )

                if resource == "identity":

                    item = dict(
                        item
                    )

                    item.pop(
                        "cognito_sub",
                        None
                    )

                return response(
                    200,
                    {
                        "item":
                            item
                    }
                )

            patient_id = identifier

            if not can_get(
                event,
                resource,
                patient_id
            ):

                return response(
                    403,
                    {
                        "error":
                            "You do not have permission "
                            "to access this patient"
                    }
                )

            items = get_by_patient(
                resource,
                patient_id
            )

            if resource == "assignment":

                sanitized = []

                for item in items:

                    item = dict(
                        item
                    )

                    item.pop(
                        "therapist_sub",
                        None
                    )

                    # The token now lives server-side only; a patient reading
                    # their assignment must not learn where their therapist's
                    # notifications are delivered.
                    item.pop(
                        "therapist_push_token",
                        None
                    )

                    sanitized.append(
                        item
                    )

                items = sanitized

            # Return BOTH the generic "items" key (existing shape, don't
            # break anything already relying on it) and the resource-specific
            # plural key the mobile client actually reads (decisions/
            # sessions/notes/assignments/rules) -- see RESOURCE_LIST_KEYS.
            out = {"items": items}
            list_key = RESOURCE_LIST_KEYS.get(resource)
            if list_key:
                out[list_key] = items

            return response(
                200,
                out
            )


        # ---------------------------------------------------------------------
        # PUT
        # ---------------------------------------------------------------------

        if method == "PUT":

            if not rest:

                return response(
                    400,
                    {
                        "error":
                            "Resource ID is required"
                    }
                )

            item_id = rest[0]

            existing = get_one(
                resource,
                item_id
            )

            if not existing:

                return response(
                    404,
                    {
                        "error":
                            "Not found"
                    }
                )

            if not can_modify_existing(
                event,
                resource,
                existing
            ):

                return response(
                    403,
                    {
                        "error":
                            "You do not have permission "
                            "to modify this resource"
                    }
                )

            updated = update_resource(
                resource,
                item_id,
                body
            )

            return response(
                200,
                {
                    "message":
                        f"{resource} "
                        f"updated successfully",

                    "item":
                        updated,
                }
            )


        # ---------------------------------------------------------------------
        # DELETE
        # ---------------------------------------------------------------------

        if method == "DELETE":

            if not rest:

                return response(
                    400,
                    {
                        "error":
                            "Resource ID is required"
                    }
                )

            item_id = rest[0]

            existing = get_one(
                resource,
                item_id
            )

            if not existing:

                return response(
                    404,
                    {
                        "error":
                            "Not found"
                    }
                )

            if not can_modify_existing(
                event,
                resource,
                existing
            ):

                return response(
                    403,
                    {
                        "error":
                            "You do not have permission "
                            "to delete this resource"
                    }
                )

            deleted = delete_resource(
                resource,
                item_id
            )

            return response(
                200,
                {
                    "message":
                        f"{resource} "
                        f"deleted successfully",

                    "item":
                        deleted,
                }
            )


        return response(
            405,
            {
                "error":
                    f"Method {method} not allowed"
            }
        )


    except json.JSONDecodeError:

        return response(
            400,
            {
                "error":
                    "Invalid JSON body"
            }
        )


    except ValueError as error:

        return response(
            400,
            {
                "error":
                    str(error)
            }
        )


    except Exception as error:

        # Log the FULL error server-side (CloudWatch), but never return raw
        # exception text to the client: it can expose table names, ARNs and
        # internal structure to anyone who can reach the API. The client gets
        # a correlation id instead, which is enough to find the exact entry in
        # CloudWatch without disclosing anything.
        error_id = uuid.uuid4().hex[:12]

        print(
            "ERROR",
            error_id,
            repr(error)
        )

        return response(
            500,
            {
                "error":
                    "Something went wrong handling that request.",

                "error_id":
                    error_id,
            }
        )
