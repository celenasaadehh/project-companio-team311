# Connect AWS — which file to edit for each service

> **Status update:** the mobile app's persistent-data backend (Cognito, API
> Gateway, DynamoDB, S3, Rekognition, Transcribe) is now LIVE — see
> `aws/lambda_function.py` (the complete Lambda source) and `FINAL_SETUP.md`
> at the repo root for exact deploy/test steps. The guidance below still
> applies to `therapist_engine/api/main.py`'s own SEPARATE, optional
> `USE_AWS` path (a local FastAPI service on your Mac) — do not confuse the
> two. That local path's `.env` template further down referenced the old
> accidental duplicate tables (`ptsd_clinical_profile`/`ptsd_therapist_rules`)
> — those are NOT the real backend; the real tables are `CompanioIdentity`,
> `CompanioClinicalProfiles`, `CompanioTherapistRules`, `CompanioDecisions`,
> `CompanioSessions`, `CompanioAssignments`, `CompanioNotes`.

Everything runs **locally and free** right now. When your AWS account is ready,
edit the files below. Nothing else needs to change. **First set a $1 budget alarm**
(AWS Console → Billing → Budgets) so you never get charged by surprise.

## 0. The one setting that turns AWS on
`therapist_engine/api/main.py` → the **CONFIG** block near the top:
```python
USE_AWS = os.getenv("USE_AWS", "false")   # set env USE_AWS=true when ready
AWS_REGION, DDB_*_TABLE, BEDROCK_MODEL_ID  # fill these in
```
Put the real values in a `.env` file (copy `.env.example`, never commit `.env`).

## The connection points (search the code for `CONNECT AWS`)

| AWS service | What it does | File → where | What to do |
|---|---|---|---|
| **Cognito** | login (patient vs therapist) | `mobile/App.js` (Login) + `api/main.py` `patient()` | verify the login token; map it → `P-001`. Free tier: 50k users. |
| **DynamoDB** | the database (replaces in-memory dicts) | `api/main.py` → `get_profile()` and `get_rules()` | read the patient's row / rules from DynamoDB with `boto3`. Free forever at demo scale. |
| **S3** | store the VA source PDFs | `knowledge/build_knowledge_base.py` | put source docs in an S3 bucket, read from there. ~free. |
| **Bedrock** (LLM) | the "wow" AI reasoning | `therapist_engine/src/engines/ai_reasoner.py` → `_draft_response()` | replace the placeholder body with a Bedrock call. ⚠️ pay-per-use (cents/demo) — optional. |
| **Bedrock Knowledge Base** | RAG at scale | `api/main.py` → `knowledge()` | swap the TF-IDF search for a Bedrock KB query. Optional (local RAG already works). |
| **Rekognition** | camera → object labels ("the eyes") | `perception/vision.py` → `analyze_image()` | already written — flip `USE_AWS=true` and it calls `detect_labels` (no faces). Free tier: 5k images/mo. |
| **Transcribe** | mic → patient's words ("the ears") | `perception/audio.py` → `analyze_audio()` | already written — fill the Transcribe result in the marked spot. Free tier: 60 min/mo. |
| **Lambda + API Gateway** | host the backend in the cloud | deploy `therapist_engine/api/` | package the API as a Lambda (or run it on a small server). Free tier: 1M req. |
| **IAM + KMS** | access control + encryption | AWS console | least-privilege roles; encrypt the DynamoDB tables. |

## The mobile app → backend
Config now lives in `mobile/src/config.js` (overridable via `mobile/.env`,
see the root `.env.example`), not `mobile/App.js`:
- `AWS_API_BASE_URL` — the deployed API Gateway URL (already live).
- `THERAPIST_ENGINE_URL` — your Mac's LAN IP, for the separate local FastAPI service.

## Suggested order (free first, paid last)
1. **DynamoDB** (free) — swap the in-memory dicts.
2. **Cognito** (free) — real login.
3. **S3** (≈free) — store VA docs.
4. **Rekognition** (free tier) — camera triggers.
5. **Bedrock** (cents) — only if you want the live LLM; the local AI works without it.

## The `.env` template
See `therapist_engine/api/` — create a `.env` with:
```
USE_AWS=true
AWS_REGION=us-east-1
DDB_PROFILE_TABLE=CompanioClinicalProfiles
DDB_RULES_TABLE=CompanioTherapistRules
```
Never put `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in a checked-in `.env`.
Run this locally with your own AWS CLI profile credentials (`aws configure`),
which `boto3` picks up automatically — the same rule the Lambda's execution
role follows in production (credentials come from the runtime, never from a
file). (You'll also need `pip install boto3`.)
