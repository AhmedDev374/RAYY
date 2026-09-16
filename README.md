# RAYY (رَيّ)

### Intelligent Greenhouse & Smart Agriculture Management Platform

RAYY is a full-stack platform for managing a multi-plant greenhouse: it combines real-time environmental monitoring, AI-based plant disease diagnosis, a conversational plant-care assistant, a bilingual plant encyclopedia, and a closed-loop irrigation/climate control engine into a single system.

The name *رَيّ* is the Arabic word for **irrigation**, and the platform's interface and content are Arabic-first.

<p align="center">
  <img src="docs/screenshots/landing-page.png" alt="RAYY landing page" width="850">
</p>

---

## Table of Contents

- [Overview](#overview)
- [The Agricultural Challenge](#the-agricultural-challenge)
- [The RAYY Solution](#the-rayy-solution)
- [Core Modules](#core-modules)
  - [Dashboard & Environmental Monitoring](#dashboard--environmental-monitoring)
  - [Plant Management](#plant-management)
  - [AI Plant Diagnosis](#ai-plant-diagnosis)
  - [Plant Encyclopedia](#plant-encyclopedia)
  - [AI Plant-Care Assistant](#ai-plant-care-assistant)
  - [Irrigation & Greenhouse Control](#irrigation--greenhouse-control)
  - [IoT Devices & Simulation Mode](#iot-devices--simulation-mode)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Current Implementation vs. Physical Integration](#current-implementation-vs-physical-integration)
- [License](#license)

---

## Overview

A greenhouse rarely holds a single crop. Different species need different soil moisture, temperature, humidity, and light, and their conditions change throughout the day and across seasons. Managing that manually — walking the rows, reading gauges, guessing at irrigation timing, and inspecting leaves by eye for disease — does not scale as the number of plants and beds grows.

RAYY addresses this by giving each plant its own profile and target thresholds, continuously comparing live sensor readings against those thresholds, and centralizing four things that are normally scattered across notebooks, spreadsheets, and intuition:

- **Monitoring** — live environmental data per plant (temperature, humidity, soil moisture, light, water level).
- **Diagnosis** — AI-based leaf disease screening from a photo.
- **Knowledge** — a structured, bilingual encyclopedia of plant care requirements.
- **Action** — an irrigation and climate control engine that can run automatically, on a schedule, or be operated manually, with hardware safety guards built in.

## The Agricultural Challenge

Greenhouse and multi-plant cultivation involves several recurring difficulties that RAYY is designed around:

| Challenge | Description |
|---|---|
| Continuous monitoring | Environmental conditions can drift outside a plant's safe range at any hour, not just when someone is present to check. |
| Species-specific requirements | A single set of watering or climate rules cannot serve roses, tomatoes, aloe vera, and turmeric equally well. |
| Manual intervention | Irrigation and ventilation decisions made by hand are inconsistent and easy to forget. |
| Disease detection | Early-stage disease symptoms are easy to miss without regular, careful visual inspection. |
| Fragmented information | Care guidelines, sensor history, diagnosis records, and control settings usually live in different places. |

## The RAYY Solution

RAYY is built around a closed monitor–analyze–decide–control loop rather than a passive dashboard:

```mermaid
flowchart LR
    A[Sensors] --> B[Environmental Data]
    B --> C[RAYY Platform]
    C --> D[Intelligent Analysis]
    D --> E[Decision]
    E --> F[Control Action]
    F --> G[Greenhouse Response]
    G --> A
```

Readings arrive through the ingestion API or the built-in simulator, are compared against each plant's target thresholds (from the encyclopedia or per-plant overrides), and the control engine turns that comparison into a proportional actuator decision — not a blind on/off switch — while enforcing safety rules such as pump-runtime limits, no-flow detection, and an emergency stop.

---

## Core Modules

### Dashboard & Environmental Monitoring

The dashboard is the central view of the greenhouse: live sensor readings, environmental trend charts, irrigation and device status, and per-plant condition summaries, delivered to the browser over a WebSocket connection for real-time updates.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/dashboard_1.png" alt="RAYY dashboard"></td>
<td width="50%"><img src="docs/screenshots/dashboard_2.png" alt="RAYY dashboard"></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/dashboard_3.png" alt="RAYY dashboard"></td>
<td width="50%"><img src="docs/screenshots/dashboard_4.png" alt="RAYY dashboard"></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/dashboard_5.png" alt="RAYY dashboard"></td>
<td width="50%"><img src="docs/screenshots/dashboard_6.png" alt="RAYY dashboard"></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/dashboard_7.png" alt="RAYY dashboard"></td>
<td width="50%"><img src="docs/screenshots/dashboard_8.png" alt="RAYY dashboard"></td>
</tr>
</table>

### Plant Management

Each plant in the greenhouse is registered individually — species, name, and location — which is what allows the platform to apply per-plant thresholds instead of a single global rule set.

<table>
<tr>
<td width="33%"><img src="docs/screenshots/add_plant_1.png" alt="Add plant flow"></td>
<td width="33%"><img src="docs/screenshots/add_plant_2.png" alt="Add plant flow"></td>
<td width="33%"><img src="docs/screenshots/add_plant_3.png" alt="Add plant flow"></td>
</tr>
</table>

### AI Plant Diagnosis

Users upload a close-up leaf photo and receive an AI-generated screening result: predicted condition, confidence score, and guidance on next steps. Diagnoses are stored per plant so a history of past results is available.

<p align="center">
  <img src="docs/screenshots/disease-detection.png" alt="AI disease detection" width="850">
</p>
<p align="center">
  <img src="docs/screenshots/disease-detection3.png" alt="AI disease detection result" width="850">
</p>

**Model details (as shipped in the repository):**

| Property | Value |
|---|---|
| Architecture | EfficientNet-B0 |
| Framework | PyTorch / TorchVision |
| Input | 224 × 224 RGB image |
| Classes | 39 (38 crop/disease combinations across 14 crops, plus a `Non_leaf_or_unknown` rejection class) |
| Supported crops | Apple, Blueberry, Cherry, Corn, Grape, Orange, Peach, Pepper, Potato, Raspberry, Soybean, Squash, Strawberry, Tomato |
| Reported top-1 accuracy | ≈ 99.6% on the held-out PlantVillage-style test split (8,215 images) |
| Confidence handling | Results below 0.70 confidence are reported as "unknown/unclear" rather than a forced diagnosis |

The model is explicitly scoped to **close-up single-leaf images**; the manifest shipped with the model documents that full field scenes, whole-plant shots from a distance, and unsupported crops are outside its intended input range, and flags that softmax confidence can still be overconfident on out-of-distribution images.

### Plant Encyclopedia

A structured, Arabic-first reference covering **20 species** across six categories (ornamental, houseplant, aromatic/medicinal, vegetable, fruit, and field crop), including roses, hibiscus, aloe vera, money plant, chrysanthemum, and turmeric alongside common greenhouse crops such as tomato, pepper, potato, and strawberry. Each entry defines watering, fertilization, greenhouse guidance, seasonal tips, common diseases, common pests, and nutrient-deficiency symptoms, and doubles as the source of the numeric thresholds (soil moisture, temperature, humidity, light) that the control engine targets for that species.

<table>
<tr>
<td width="33%"><img src="docs/screenshots/enclopedia_1.png" alt="Plant encyclopedia"></td>
<td width="33%"><img src="docs/screenshots/enclopedia_2.png" alt="Plant encyclopedia"></td>
<td width="33%"><img src="docs/screenshots/enclopedia_3.png" alt="Plant encyclopedia"></td>
</tr>
<tr>
<td width="33%"><img src="docs/screenshots/enclopedia_4.png" alt="Plant encyclopedia"></td>
<td width="33%"><img src="docs/screenshots/enclopedia_5.png" alt="Plant encyclopedia"></td>
<td width="33%"><img src="docs/screenshots/enclopedia_6.png" alt="Plant encyclopedia"></td>
</tr>
</table>

### AI Plant-Care Assistant

A chat interface, backed by Google's Gemini models, that can answer plant-care questions with streaming responses, giving users a conversational way to ask about watering, symptoms, or environmental conditions instead of searching through documentation.

<p align="center">
  <img src="docs/screenshots/chat.png" alt="RAYY AI assistant" width="850">
</p>

### Irrigation & Greenhouse Control

A dedicated control engine (independent of the API layer, so it can run from the sensor ingestion pipeline, the simulator, or a direct API call) turns sensor readings and per-plant thresholds into actuator decisions. It supports:

- **Automatic mode** — continuous evaluation against species thresholds and proportional actuator output (not simple on/off).
- **Manual mode** — direct operator control of irrigation and climate actuators.
- **Scheduled mode** — recurring control schedules per plant.
- **Safety guards** — pump-runtime limits, no-flow detection, repeated-irrigation protection, actuator debounce, and an emergency-stop / emergency-reset pair that can halt all actuation.
- A rule only fires on a sensor the connected device has actually declared and that is reporting fresh data; if a required sensor is missing, the engine holds rather than guessing a value.

### IoT Devices & Simulation Mode

Devices register and authenticate with the backend, report sensor data, and receive queued actuator commands. When physical hardware is not connected, a built-in simulation service generates realistic environmental readings through the same ingestion pipeline used by real devices, so the dashboard, control logic, and alerts can be demonstrated end-to-end without hardware.

---

## Architecture

```
┌─────────────────────────┐
│       Frontend           │
│  React + TypeScript      │
│  Vite · Tailwind CSS     │
│  TanStack Query          │
└────────────┬─────────────┘
             │ REST + WebSocket
┌────────────▼─────────────┐
│      FastAPI Backend      │
│  ─────────────────────    │
│  plants · care · chat     │
│  content (encyclopedia,   │
│    disease map)           │
│  control · devices        │
│  diagnosis · sensors      │
│  simulation · auth        │
└──┬───────────┬───────────┬┘
   │           │           │
┌──▼───┐  ┌────▼─────┐ ┌───▼────────┐
│ SQL   │  │ ML       │ │ ESP32 /    │
│ DB    │  │ Inference │ │ Simulated  │
│(Postgres│ │(EfficientNet│ Devices  │
│/SQLite)│ │ -B0, PyTorch)│           │
└───────┘  └──────────┘ └────────────┘
```

Authentication is handled by **Supabase Auth** (email/password and OAuth), with backend requests validated against Supabase's public JWKS. The `Non_leaf_or_unknown` rejection class and confidence thresholds in the diagnosis pipeline keep the AI screening result honest about its own uncertainty rather than always returning a confident label.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS |
| Data fetching / caching | TanStack Query |
| Charts | Recharts |
| Maps (disease map) | Leaflet / React-Leaflet |
| Markdown rendering | react-markdown + remark-gfm |
| Backend framework | FastAPI |
| ORM & migrations | SQLAlchemy + Alembic |
| Database | PostgreSQL (production) / SQLite (local dev) |
| Auth | Supabase Auth (JWKS-verified access tokens) |
| Machine learning | PyTorch / TorchVision, EfficientNet-B0 |
| Conversational AI | Google Gemini (`google-genai`) |
| Real-time transport | WebSockets |
| IoT firmware | ESP32 (PlatformIO, C++) |
| Containerization | Docker / Docker Compose |
| Deployment targets | Vercel (frontend), Railway / Render (backend) |

## API Reference

The backend exposes a REST + WebSocket API under FastAPI. Selected endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/auth/me` | Current authenticated user |
| GET / POST | `/plants` | List / create plants |
| GET / PATCH / DELETE | `/plants/{plant_id}` | Read, update, or remove a plant |
| POST / GET | `/plants/{plant_id}/care-events` | Log or list care events |
| POST | `/diagnose` | Run AI disease diagnosis on an uploaded image |
| GET | `/diagnose/history` | List past diagnoses |
| GET | `/encyclopedia` | List plant encyclopedia entries |
| GET | `/encyclopedia/{species}` | Single species profile |
| GET | `/disease-map` | Aggregated, geolocated disease reports |
| POST | `/chat`, `/chat/stream` | AI assistant response (standard / streamed) |
| GET / PUT | `/control/settings/{plant_id}` | Read / update control settings for a plant |
| POST | `/control/auto`, `/control/manual`, `/control/schedule` | Set control mode / create a schedule |
| POST | `/control/emergency-stop`, `/control/emergency-reset` | Halt or resume actuation |
| POST | `/devices/register`, `/devices/claim` | Register and claim an IoT device |
| POST | `/devices/{device_id}/report` | Device sensor report |
| WS | `/ws/plants/{plant_id}` | Live sensor stream for a plant |
| GET / POST | `/simulation/status`, `/simulation/start`, `/simulation/stop` | Control the demo simulation |

## Project Structure

```
RAYY/
├── backend/
│   ├── app/
│   │   ├── routers/          # auth, plants, care, diagnosis, chat, content,
│   │   │                     # control, devices, sensors, simulation
│   │   ├── services/         # control_engine, inference_service, llm_service,
│   │   │                     # simulation_service, device_adapter, alerts, ...
│   │   ├── ml/                # model inference, treatment knowledge base
│   │   ├── encyclopedia_data.py
│   │   ├── models.py / schemas.py / database.py
│   ├── alembic/               # database migrations
│   └── tests/
├── frontend/
│   └── src/
│       ├── pages/             # Landing, Dashboard, Plants, Diagnose, Chat,
│       │                     # Encyclopedia, DiseaseMap, CareLog, DeviceOnboard...
│       ├── components/control/ # Control Center UI (auto/manual/schedule)
│       ├── hooks/              # useWebSocket, useStreamingChat, useControl
│       └── lib/                # api client, supabase client, i18n labels
├── ai/                        # model export and training scripts
├── firmware/                  # ESP32 firmware (PlatformIO)
├── sensors data/               # additional sensor firmware / data
├── docs/
│   ├── screenshots/
│   └── demo.mp4
├── utils/                     # alerting, WhatsApp notifications, charts
├── app.py                     # Streamlit prototype (sensor + diagnosis demo)
├── docker-compose.yml / Dockerfile
├── railway.toml / render.yaml / vercel.json
└── requirements.txt
```

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- Git
- PlatformIO (only required to build/flash the ESP32 firmware)

### 1. Clone the repository

```bash
git clone https://github.com/AhmedDev374/RAYY.git
cd RAYY
```

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env             # then fill in the values you need
uvicorn app.main:app --reload --port 8000
```

Key backend environment variables (see `backend/.env.example`):

| Variable | Purpose |
|---|---|
| `AUTH_MODE` | `supabase` (default) or `legacy` local JWT auth |
| `SUPABASE_URL` | Required in `supabase` auth mode |
| `DATABASE_URL` | Defaults to local SQLite; set a PostgreSQL URL for production |
| `MODEL_PATH` | Path to the exported diagnosis model |
| `CONFIDENCE_THRESHOLD` | Minimum confidence before a diagnosis is treated as reliable |
| `GEMINI_API_KEY` | Enables the AI plant-care assistant |
| `CORS_ORIGINS` | Allowed frontend origins for local development |

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env             # set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_API_URL
npm run dev
```

The dev server runs at `http://localhost:5173` by default.

### 4. ESP32 firmware (optional, hardware only)

```bash
cd firmware
pio run -t upload
```

### Running without hardware

Start the simulation from the dashboard or via `POST /simulation/start` — it feeds realistic environmental readings through the same ingestion pipeline as a real device, so the dashboard, diagnosis, and control features can all be exercised without physical sensors.

---

## Current Implementation vs. Physical Integration

To keep this README accurate to the repository rather than aspirational:

**Implemented in this repository today:**
- FastAPI backend with the routers, control engine, and database models listed above.
- React/TypeScript frontend covering the dashboard, plant management, diagnosis, encyclopedia, chat, disease map, and control center pages.
- A trained EfficientNet-B0 leaf-disease classification model with an exported manifest and label set.
- A device registration/claim/report API and a WebSocket streaming path for live readings.
- A simulation service that can stand in for physical sensors end-to-end.
- ESP32 firmware source for physical sensor/actuator nodes.

**Architecture / physical integration:**
- The monitor → analyze → decide → control → monitor loop described above is fully implemented in software (control engine, thresholds, safety guards). Whether it is currently driving a physically deployed greenhouse, versus running against the simulator, depends on which hardware is connected and claimed through the device API at any given time — this README does not assume a specific physical deployment.

## License

MIT License — see the repository for the full license text.

---

<p align="center"><sub>RAYY — AhmedDev374</sub></p>
