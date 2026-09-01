# Privacy & Security Design

## Local guarantees implemented
- Clinical models use internal patient IDs rather than direct identity fields.
- Therapist rules are checked before AI reasoning.
- AI can abstain and falls back safely.
- Safety messages fail closed rather than being rewritten into uncertain advice.
- Camera contract is scene/object context only; no face identity or emotion inference.
- Low-confidence visual context becomes `unknown` and does not create a definite trigger.
- Raw camera retention is not performed by the local perception module.
- Demo/live states should be visually distinguished.

## Threat model to enforce during external integration
- Authentication bypass / stolen token
- IDOR (patient fetching another patient's record)
- Therapist access to unassigned patient
- Prompt injection in messages/knowledge records
- Malicious document upload
- Model/API timeout or malformed response
- Duplicate sensor events causing repeated interventions
- Audit tampering
- PHI/PII leakage into logs
- Stolen/unlocked phone

## Required external controls
These require real infrastructure and are intentionally left for the AWS/database phase:
- Cognito authentication and group/role claims
- Secure token storage/refresh on mobile
- Object-level authorization
- HTTPS-only hosted endpoints
- Encryption at rest + KMS policy
- Append-only/tamper-resistant audit persistence
- S3 MIME/size/malware controls and presigned URLs
- IAM least privilege
- Secrets Manager/Parameter Store
- CloudWatch redaction and alarms
- Retention/export/deletion workflows
- Explicit patient/device consent persistence
