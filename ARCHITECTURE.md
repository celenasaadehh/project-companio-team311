# tatainaamazonchat Architecture

## Core decision contract

`wearable/context/text signals -> physiological distress + context -> patient profile -> therapist rules first -> bounded AI only if no rule matches -> deterministic safety gate -> patient-facing support -> audit/provenance`

### Trust hierarchy
1. Therapist rule (highest authority)
2. Bounded AI reasoning for an unseen situation
3. Safe fallback when AI/rules cannot act safely
4. Safety gate can veto AI wording at any time

The physiological model estimates stress/distress patterns only. It is not a PTSD diagnostic system.

## Local components
- `risk_engine/`: 30-second physiological window -> 16 features -> WESAD Random Forest -> support band.
- `therapist_engine/src/engines/`: deterministic rule matching, bounded unseen-situation reasoning, safety gate and risk bridge.
- `therapist_engine/knowledge/`: provenance-carrying VA knowledge records.
- `therapist_engine/perception/`: privacy-minded scene/audio context contract. Low confidence becomes `unknown`.
- `therapist_engine/ml/`: text-distress/recommender experiments. DistilBERT is the selected text detector based on the current metrics artifact; other approaches are baselines.
- `mobile/`: React Native/Expo patient + therapist experiences and deterministic offline demo.

## Privacy boundary
Identity and clinical data are separate concepts. Clinical data uses the internal patient ID only. `CompanioIdentity` maps a Cognito `sub` to a patient_id; no other table stores a real name/email.

## AWS backend (live)
- **Auth**: Amazon Cognito user pool, JWT-authorized via API Gateway (`CompanioCognitoAuthorizer`). See `mobile/src/services/auth.js`.
- **API**: API Gateway HTTP API `companio-api`, `ANY /{proxy+}` -> one Lambda. Complete source: `aws/lambda_function.py`.
- **Data**: 7 DynamoDB tables (`CompanioIdentity`, `CompanioClinicalProfiles`, `CompanioTherapistRules`, `CompanioDecisions`, `CompanioSessions`, `CompanioAssignments`, `CompanioNotes`), all customer-managed-KMS encrypted.
- **Media**: private, KMS-encrypted S3 bucket, accessed only via short-lived presigned URLs (`POST /media-upload-url`, `POST /media-url`) — never a public link.
- **Vision/speech**: Amazon Rekognition (`POST /recognize`) and Amazon Transcribe (`POST /transcription` + polling), both driven from the Lambda.
- How to run and test everything: `README.md` at the repo root.

## Real-hardware boundary (still open)
Real Apple Watch/HealthKit data IS wired (`mobile/src/services/health.js`, native entitlements in `mobile/ios/`). Smart-glasses hardware is NOT — see `mobile/src/services/cameraProvider.js` for the clean interface a real vendor SDK plugs into; the phone camera is the fully-working default.
