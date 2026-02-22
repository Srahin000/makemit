# EDGEucator — How It Works

A full-stack AI mentor avatar with voice chat, 3D animation, lip-sync, hand-gesture camera control, and voice input.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser (Vite / React)                     │
│                                                                     │
│  VoiceInput ──┐                                                     │
│               ├──▶ App.tsx ──▶ /api/chat ──▶ main.py (FastAPI)     │
│  Text input ──┘         ◀── reply + audio + visemes ──             │
│                                                                     │
│  Canvas (R3F)                                                       │
│  ├── CameraRig  ◀── sliders | GestureController ◀── gesture_server │
│  └── RotationController ▶ Avatar (animations + lip-sync)           │
└─────────────────────────────────────────────────────────────────────┘

gesture_server.py ─── WebSocket ws://localhost:8765 ───▶ GestureController.tsx
```

---

## How a Conversation Works

1. **User** speaks (hold 🎙️) or types a message and presses Send / Enter.
2. **Frontend** sets `lifeState = LISTENING`, sends `POST /api/chat` with `{ text }`.
3. **Backend** calls **Gemini** for a text reply (optionally includes an inline image).
4. **Backend** calls **ElevenLabs** with the reply → returns MP3 audio + per-character timestamps.
5. **Backend** converts timestamps to **viseme keyframes** and returns `{ reply, audioBase64, visemes, imageBase64?, imageMime? }`.
6. **Frontend** sets `lifeState = SPEAKING`, plays the audio via Web Audio API, drives avatar mouth shapes from visemes in real time.
7. When audio ends → `lifeState = IDLE`; avatar crossfades back to idle animation.

---

## Backend (`server/`)

### `main.py` — FastAPI

Single route: `POST /chat`

| Step | What happens |
|------|--------------|
| Validate | Expects `{ "text": "..." }` |
| Gemini | `google-genai` SDK, model `gemini-2.5-flash`. System prompt defines the mentor persona. Response is text ± inline image. |
| ElevenLabs | `POST .../text-to-speech/{voice_id}/with-timestamps` → MP3 base64 + character alignment |
| Visemes | `viseme_from_alignment.py` converts alignment → `[{ time, viseme, intensity }]` |
| Response | `{ reply, audioBase64, visemes, imageBase64?, imageMime? }` |

### `gesture_server.py` — WebSocket Gesture Server

Runs independently on `ws://localhost:8765`. Reads the webcam with **OpenCV**, runs **MediaPipe GestureRecognizer** in VIDEO mode, and broadcasts compact JSON delta packets to the frontend each frame.

**Gesture → action mapping:**

| Gesture | MediaPipe name | Action |
|---------|---------------|--------|
| ☝️ Index finger up | `Pointing_Up` | Pan X / Y (relative delta, 1:1) |
| 👍 Thumb up | `Thumb_Up` | Zoom in (held continuously) |
| 👎 Thumb down | `Thumb_Down` | Zoom out (held continuously) |
| ✌️ V-sign / victory | `Victory` | Rotate H (twist angle delta) |
| 🖐️ Open palm | `Open_Palm` | Rotate V (vertical drag) |
| ✊ Closed fist | `Closed_Fist` | Reset camera to defaults |

**Key algorithms:**

- **One Euro Filter** — adaptive landmark smoothing (no jitter when still, full speed when moving fast).
- **Relative delta** — pan/rotate are frame-to-frame deltas, giving 1:1 hand-to-camera feel.
- **Discrete confirmation** — a gesture must be held for `GESTURE_CONFIRM_FRAMES` (default 2) consecutive frames before activating, preventing false positives.
- **Per-gesture confidence thresholds** — Pointing_Up: 30%, others: 50%, Closed_Fist (reset): 80%.

**Packet format (JSON, sent every frame):**
```json
{
  "active": true,
  "gesture": "Pointing_Up",
  "confidence": 0.87,
  "mode": "PAN",
  "dPanX": -0.012,
  "dPanY": 0.003,
  "dTheta": 0,
  "dPhi": 0,
  "dRadius": 0,
  "reset": false
}
```

### Environment variables (`.env`)

```
GEMINI_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

---

## Frontend (`src/`)

### `App.tsx`

Central state manager. Holds:

| State | Description |
|-------|-------------|
| `lifeState` | `IDLE` \| `LISTENING` \| `SPEAKING` — drives avatar animations |
| `replyText` | Last AI text response |
| `replyImage` | Optional base64 image from Gemini |
| `loading` | True while request is in-flight |
| `inputText` | Text field value |
| `targetRPM` | Avatar spin speed (0–3600 RPM) |
| `cameraState` | Slider-driven camera (radius, thetaDeg, phiDeg, panX, panY) |
| `gestureEnabled` | Whether gesture control is active |
| `gestureRef` | Ref shared between `GestureController` and `CameraRig` — lives outside React state to avoid render churn |
| `visemesRef` | Viseme keyframe array for lip-sync |
| `audioTimeRef` | Current audio playback time (updated every rAF) |

### `voice/VoiceInput.tsx`

Hold-to-talk microphone button using the browser's **Web Speech API**.

- Press and hold 🎙️ → recognition starts; live partial transcript shown above the input bar.
- Release → final transcript is passed directly to `sendMessage()`, same path as typing.
- Spoken text is mirrored into the text input so the user can see what was recognised.
- Disabled while the AI is responding.
- Shows a pulsing red ring while listening, amber while processing.
- Falls back gracefully if the browser doesn't support `SpeechRecognition`.

### `gestures/GestureController.tsx`

Thin WebSocket client. Connects to `ws://localhost:8765` (gesture_server.py) and:

1. Receives JSON delta packets every frame.
2. Accumulates deltas into `gestureRef.current` (clamps to valid ranges).
3. Applies reset when `reset: true` received.
4. Shows a status badge (`● Connected`) and live gesture name + confidence % in the UI.
5. When `active: false` (hand left frame), preserves last camera position — does not snap back.

### `gestures/gestureTypes.ts`

Shared types: `GestureMode`, `GestureTargets`, `GESTURE_DEFAULTS`, `makeGestureTargets()`.

Default camera position: `{ radius: 4.0, thetaDeg: 242°, phiDeg: 79°, panX: 0, panY: 0 }`.

### `scene/CameraRig.tsx`

Drives the Three.js camera each frame using spherical coordinates + lerping.

**Priority order:**
1. **Gesture active** → follow `gestureRef.current` at `LERP_SPEED = 8`.
2. **Gesture inactive, < 10 s** → hold last gesture position (no snap-back).
3. **Gesture inactive, ≥ 10 s** → smoothly lerp back to `GESTURE_DEFAULTS` at `RESET_LERP_SPEED = 2`.
4. **Gesture never used** → follow slider `cameraState` prop.

Uses frame-rate-independent exponential decay lerp (`1 - e^(-k·dt)`) and shortest-path theta interpolation (no spinning the long way round).

### `scene/Scene.tsx`

R3F scene: background colour, lights, `CameraRig`, and `RotationController` wrapping `Avatar`.

### `scene/RotationController.tsx`

`<group>` that applies `rotation.y += (targetRPM × 2π / 60) × delta` each frame. Independent of animations. Max 3600 RPM (60 rev/s).

### `scene/Avatar.tsx`

Loads a **Ready Player Me** GLB, clones it with `SkeletonUtils.clone` (required for skinned meshes), loads **Mixamo FBX animations**, remaps bone names, and manages a `THREE.AnimationMixer`.

- `IDLE` → idle clip; `SPEAKING` → talking clip; `LISTENING` reuses idle.
- Crossfades between clips on `lifeState` changes.
- **Lip-sync:** each frame reads `audioTimeRef` + `visemesRef` and applies mouth morph target weights.

---

## Camera Control — Full Picture

```
Sliders (cameraState)  ──┐
                          ├──▶ CameraRig.tsx ──▶ camera.position / lookAt
Gesture (gestureRef)  ───┘

gesture_server.py ──WS──▶ GestureController.tsx ──▶ gestureRef
```

| Control | Method |
|---------|--------|
| Zoom | Slider or 👍👎 gestures |
| Horizontal orbit | Slider or ✌️ twist |
| Vertical orbit | Slider or 🖐️ vertical drag |
| Pan X / Y | Slider or ☝️ finger drag |
| Reset | ✊ fist or auto-reset after 10 s idle |
| Avatar spin | RPM slider (0–3600) |

---

## Data Flow Summary

| # | Where | What |
|---|-------|------|
| 1 | User | Speaks (hold 🎙️) or types; releases / presses Send |
| 2 | App.tsx | `lifeState = LISTENING`; `POST /api/chat { text }` |
| 3 | main.py | Gemini → `reply` (+ optional image) |
| 4 | main.py | ElevenLabs → `audioBase64` + character alignment |
| 5 | viseme_from_alignment.py | Alignment → `[{ time, viseme, intensity }]` |
| 6 | main.py | Returns `{ reply, audioBase64, visemes, imageBase64?, imageMime? }` |
| 7 | App.tsx | `lifeState = SPEAKING`; decodes + plays audio; updates `audioTimeRef` each rAF |
| 8 | Avatar (useFrame) | Reads `audioTimeRef` + `visemesRef` → mouth morph targets; mixer plays SPEAKING clip |
| 9 | App.tsx (onended) | `lifeState = IDLE`; Avatar crossfades to idle |
| 10 | gesture_server.py | Webcam → MediaPipe → WebSocket delta packets → `GestureController` → `gestureRef` → `CameraRig` |

---

## Key Files

| Path | Role |
|------|------|
| `server/main.py` | FastAPI `/chat`: Gemini + ElevenLabs + visemes |
| `server/gesture_server.py` | WebSocket gesture server: OpenCV + MediaPipe + One Euro Filter |
| `server/viseme_from_alignment.py` | ElevenLabs alignment → viseme keyframes |
| `server/.env` | API keys |
| `src/App.tsx` | Root component: state, lifecycle, chat, canvas, UI |
| `src/voice/VoiceInput.tsx` | Hold-to-talk mic button (Web Speech API) |
| `src/gestures/GestureController.tsx` | WebSocket client; applies gesture deltas to `gestureRef` |
| `src/gestures/gestureTypes.ts` | Shared types and camera defaults |
| `src/scene/CameraRig.tsx` | Spherical camera with lerp, gesture priority, 10 s auto-reset |
| `src/scene/Scene.tsx` | R3F scene: lights, CameraRig, RotationController, Avatar |
| `src/scene/RotationController.tsx` | Avatar spin group |
| `src/scene/Avatar.tsx` | GLB + FBX, mixer, LifeState → animations, lip-sync |
| `vite.config.ts` | Proxies `/api` → `http://localhost:3001` |

---

## Running the App

```bash
# 1. Start the AI chat backend (port 3001)
cd server
pip install -r requirements.txt
python main.py

# 2. Start the gesture server (port 8765)
#    (new terminal, same server/ directory)
python gesture_server.py

# 3. Start the frontend (port 3000)
cd ..
npm install
npm run dev
```

Then open **http://localhost:3000**.

- Type or hold 🎙️ to speak a question.
- Click **🖐 Gesture ON** to enable hand controls (requires gesture_server.py running).
- Use the sliders (bottom-left) to manually adjust camera and spin speed.
- The avatar responds with voice + lip-sync; after 10 s with no gesture activity the camera auto-resets.
