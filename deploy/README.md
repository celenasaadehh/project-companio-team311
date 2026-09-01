# Hosting the decision engine on AWS

During development the Python inference service runs on a laptop, and the
phone reaches it over the local network. That works for a demo but ties the
app to one room. This folder documents how to host the engine on AWS App
Runner instead, so the app works from anywhere.

Nothing here is wired into the app. The app runs unchanged without it; this
is the path to flip when we want the engine off the laptop.

## Steps

1. Push this repository to GitHub. The build configuration is already in the
   repo root as `apprunner.yaml` (Python 3.11, installs the engine's
   dependencies, starts uvicorn on port 8080).

2. In the AWS console: App Runner -> Create service -> Source: GitHub ->
   pick this repository and the `main` branch -> "Use a configuration file".
   App Runner finds `apprunner.yaml` on its own.

3. When the service is running, App Runner shows a default domain like
   `https://xxxxxxxx.us-east-1.awsapprunner.com`. Check it:

   ```bash
   curl https://<your-service>.awsapprunner.com/api/health/models
   ```

4. Point the app at it. In `mobile/.env`:

   ```
   EXPO_PUBLIC_THERAPIST_ENGINE_URL=https://<your-service>.awsapprunner.com
   ```

   Restart the Metro dev server so the value is picked up, and reload the
   app.

## What the hosted engine runs

The Watch risk model, the stage recommender, the intervention bandit, the
safety filter and the conditional-ban layer all ship in the repository and
run fully on App Runner. The DistilBERT text-distress weights are 255 MB
(above GitHub's file limit) and are not in the repo, so the hosted engine
starts without that one model: the health endpoint reports it honestly and
the gate fails closed. To run it hosted as well, upload
`model.safetensors` to S3 and download it into
`therapist_engine/ml/detector_bert/bert_model/` at startup, and add torch
and transformers to the install in `apprunner.yaml`.

## What does not change

The rest of the backend is already on AWS: Cognito for accounts, API
Gateway and Lambda for the API, DynamoDB for records, S3 (KMS-encrypted)
for media, Rekognition and Transcribe for perception. Only the decision
engine moves.
