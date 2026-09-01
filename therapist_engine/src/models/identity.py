# =============================================================================
# identity.py
# -----------------------------------------------------------------------------
# This file defines ONE form (model): IdentityRecord.
#
# IdentityRecord is the ONLY place in the whole system that knows who the real
# person is (their name, their email, their login). Every other form will know
# the person only by a codename like "P-001".
#
# Think of this file as the locked drawer that maps  "P-001"  ->  "Ava".
# =============================================================================


# -----------------------------------------------------------------------------
# IMPORTS  (borrowing tools from other toolboxes)
# -----------------------------------------------------------------------------

# "datetime" is Python's built-in tool for representing a moment in time
# (a date AND a time together, e.g. 2026-08-21 14:00). We use it to record
# WHEN an account was created.
from datetime import datetime, timezone

# "Optional" comes from Python's "typing" toolbox. It marks a box as
# "allowed to be empty (None)". Optional[str] means "some text, OR nothing".
from typing import Optional

# From Pydantic (our strict receptionist) we borrow three tools:
#   - BaseModel : the thing we build every form on top of.
#   - EmailStr  : a special text type that ALSO checks the text looks like a
#                 real email address (must contain @, a domain, etc.).
#   - Field     : lets us attach extra rules/defaults to a single box.
from pydantic import BaseModel, EmailStr, Field

# We reuse the menu we built earlier. This is WHY enums.py had to exist first:
# IdentityRecord's "role" box will only accept a value from the AccountRole menu.
# The "." means "from the enums file, get AccountRole".
from .enums import AccountRole


# -----------------------------------------------------------------------------
# THE FORM: IdentityRecord
# -----------------------------------------------------------------------------
# "class IdentityRecord(BaseModel):" means:
#   "Define a new form named IdentityRecord, built on top of Pydantic's
#    BaseModel." Building on BaseModel is what gives us the automatic checking
#    (the receptionist) for free.
# -----------------------------------------------------------------------------
class IdentityRecord(BaseModel):

    # internal_patient_id: our OWN codename for the person, e.g. "P-001".
    # ": str" means this box must contain text.
    # We use an internal ID (not the real name) everywhere else in the system,
    # so that clinical data never has to carry an actual identity.
    internal_patient_id: str

    # cognito_user_id: the ID that the future login system (AWS Cognito) gives
    # each account. It links "someone who logged in" to our internal codename.
    # We store it as text.
    cognito_user_id: str

    # display_name: a friendly name to show in a screen, e.g. "Ava".
    # "Optional[str]" = text OR nothing.
    # "= None" sets the DEFAULT to nothing, so this box may be left empty.
    # We keep it optional because we do not always need to show a name.
    display_name: Optional[str] = None

    # email: contact / login email.
    # "EmailStr" makes Pydantic CHECK that the value looks like a real email.
    # If someone passes "not-an-email", the receptionist rejects it.
    # Optional + None means the email may be absent.
    email: Optional[EmailStr] = None

    # role: what KIND of account this is. It can ONLY be one of the choices on
    # the AccountRole menu (patient / therapist / caregiver). Anything else is
    # rejected. We give it a default of PATIENT so a plain account is a patient
    # unless we say otherwise.
    role: AccountRole = AccountRole.PATIENT

    # created_at: WHEN this account record was made.
    # "Field(default_factory=...)" is new — let me explain it:
    #   A normal default like "= 5" is a fixed value decided once.
    #   But "the time right now" changes every time we create a record, so we
    #   cannot bake in one fixed moment. "default_factory" says: "when a new
    #   record is created, CALL this little function to get a fresh value."
    #   The little function here makes the current time, in UTC (a global,
    #   timezone-neutral clock, so times are comparable no matter where we are).
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
