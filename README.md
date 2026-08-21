# Companio

Companio is an AI-assisted wearable support platform designed to help people with PTSD-related distress receive timely, personalized grounding support.

The project combines wearable physiological sensing, a machine-learning risk engine, a backend service, and a future smart-glasses/mobile interface.

## Main idea

Companio continuously receives physiological signals from a wearable device, analyzes short windows of sensor data, and estimates whether the user's current physiological pattern looks more baseline-like or stress-like.

When the distress score rises, the system can offer a grounding intervention through the user interface instead of requiring the user to recognize the escalation and manually search for help.

The current project is a **proof of concept**. It does **not** diagnose PTSD and does **not** predict the probability of a PTSD attack.

## High-level architecture

```text
Wearable / Smartwatch
        ↓
Sensor data
        ↓
Main Companio backend
        ↓
AI Risk Engine (Python + FastAPI)
        ↓
Physiological distress score
        ↓
Support decision
        ↓
Mobile app / future smart glasses
        ↓
Grounding support when needed
```

## Main project components

### 1. AI Risk Engine

The current working MVP lives in:

```text
ai-risk-engine/
```

It includes:
- preprocessing of wearable sensor data;
- 30-second feature extraction;
- a Random Forest model;
- leave-one-subject-out evaluation;
- a FastAPI prediction endpoint.

See `ai-risk-engine/README.md` for full technical details.

### 2. Main backend

The broader Companio backend is intended to manage:
- users and authentication;
- patient profiles;
- sensor-data intake;
- therapist/caregiver information;
- alerts and intervention history;
- communication with the AI risk engine;
- dashboard data.

### 3. Mobile / smart-glasses interface

The user-facing system is intended to:
- receive support decisions from the backend;
- discreetly offer grounding support;
- present calming visual/audio guidance;
- later integrate with smart glasses and wearable-device APIs.

### 4. Caregiver / therapist dashboard

The planned dashboard can show:
- distress events;
- trends over time;
- alerts;
- intervention history;
- therapist/caregiver notes.

## Current status

Working:
- physiological stress/distress ML proof of concept;
- model trained on WESAD subjects S2, S3, and S4;
- leave-one-subject-out evaluation;
- saved Random Forest model;
- FastAPI `/health` endpoint;
- FastAPI `/predict-distress` endpoint;
- end-to-end API test using synchronized sensor data.

Still to be integrated:
- main application backend;
- live wearable data streaming;
- mobile app / smart-glasses UI;
- grounding workflow;
- dashboard persistence and alerts.

## Important limitation

The current model uses the WESAD stress/affect dataset as a physiological stress proxy.

Therefore:
- the score is **not** a PTSD diagnosis;
- the score is **not** the probability of a PTSD attack;
- the current thresholds are prototype product thresholds, not clinical cutoffs;
- PTSD-specific data and clinical validation would be required before any medical use.

## Repository structure

```text
project-companio-team311/
├── README.md
└── ai-risk-engine/
    ├── README.md
    ├── API_HANDOFF.md
    ├── api.py
    ├── train_model.py
    ├── test_api.py
    ├── requirements.txt
    ├── src/
    ├── models/
    └── data/
```

More modules can be added as the backend, app, dashboard, and hardware integration are developed.
