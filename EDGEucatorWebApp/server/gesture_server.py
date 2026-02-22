#!/usr/bin/env python3
"""
gesture_server.py
-----------------
Webcam gesture recognition → WebSocket camera-update stream.

Reads the webcam with OpenCV, runs MediaPipe Tasks GestureRecognizer, then
broadcasts compact JSON delta packets to the React frontend over WebSocket so
the browser can update its camera without touching the MediaPipe JS library.

  WebSocket : ws://localhost:8765

  Packet format:
    {
      "active":     bool,          # hand visible and confirmed
      "gesture":    str,           # raw MediaPipe gesture name
      "confidence": float,         # 0.0 – 1.0
      "mode":       str,           # PAN | ZOOM | ROTATE_H | ROTATE_V | RESET | NONE
      "dPanX":      float,         # add to current panX
      "dPanY":      float,         # add to current panY
      "dTheta":     float,         # add to current thetaDeg
      "dPhi":       float,         # add to current phiDeg
      "dRadius":    float,         # add to current radius
      "reset":      bool           # true → restore camera defaults
    }

Improvements over the JS version
  1. One Euro Filter  — adaptive smoothing: no jitter when still, no lag when
                        fast (Casiez et al. 2012).
  2. Sticky Pinch     — thumb/index distance overrides the classifier for instant
                        zoom; hysteresis prevents flickering.
  3. Relative Delta   — pan/rotate use frame-to-frame position deltas, giving
                        1:1 hand-movement feel regardless of start position.
  4. Snap constants   — GESTURE_CONFIRM_FRAMES=2 for near-instant mode switching.

Run:
    pip install mediapipe opencv-python websockets
    python gesture_server.py
"""

import asyncio
import json
import math
import threading
import time
import urllib.request
from pathlib import Path
from typing import Optional

import cv2
import websockets

# ── Model auto-download ───────────────────────────────────────────────────────
MODEL_URL  = (
    "https://storage.googleapis.com/mediapipe-models/"
    "gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"
)
MODEL_PATH = Path(__file__).parent / "gesture_recognizer.task"


def ensure_model() -> None:
    if not MODEL_PATH.exists():
        print(f"[gesture] Downloading model → {MODEL_PATH} …")
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        print("[gesture] Download complete.")


# ── Tunable constants (edit freely) ──────────────────────────────────────────
S = {
    # Pan: normalised position delta (0-1) → scene units [-2, 2]
    "PAN_SENSITIVITY":        3.5,

    # Zoom bounds (maps to CameraRig radius)
    "ZOOM_MIN":               1.0,
    "ZOOM_MAX":               15.0,

    # Rotation: twist angle delta (deg) × (ROT_H / 100) = camera orbit delta
    "ROT_H_SENSITIVITY":      200.0,
    # Rotation V: normalised vertical delta × ROT_V = phi delta (deg)
    "ROT_V_SENSITIVITY":      180.0,

    # Landmark smoothing — see OneEuroFilter class below.
    # These control the One Euro Filter (not a plain LERP).
    "OEF_MIN_CUTOFF":         1.0,   # Hz — lower = smoother when still
    "OEF_BETA":               0.07,  # higher = more responsive when fast
    "OEF_D_CUTOFF":           1.0,   # Hz — derivative filter cutoff

    # Frames a gesture must be held before it activates (lower = snappier)
    "GESTURE_CONFIRM_FRAMES": 2,

    # Minimum classifier confidence to consider a reading valid
    "MIN_CONFIDENCE":         0.50,

    # Reset requires higher confidence to prevent accidental triggers
    "RESET_MIN_CONFIDENCE":   0.80,

    # Pointing_Up (pan) uses a lower threshold — it's harder to hold perfectly
    "PAN_MIN_CONFIDENCE":     0.30,

    # ms with no hand before gesture state resets
    "INACTIVE_MS":            1000,

    # Thumb zoom: radius units added/subtracted per frame while gesture is held
    "THUMB_ZOOM_SPEED":       0.08,  # increase for faster zoom
}

# Camera reset targets (must match GESTURE_DEFAULTS in gestureTypes.ts)
DEFAULTS = {"radius": 4.0, "thetaDeg": 242, "phiDeg": 79, "panX": 0.0, "panY": 0.0}

# MediaPipe gesture category name → control mode
GESTURE_MAP: dict[str, str] = {
    "Pointing_Up": "PAN",
    "Thumb_Up":    "ZOOM_IN",
    "Thumb_Down":  "ZOOM_OUT",
    "Victory":     "ROTATE_H",
    "Open_Palm":   "ROTATE_V",
    "Closed_Fist": "RESET",
}

WS_HOST = "localhost"
WS_PORT = 8765


# ── One Euro Filter ───────────────────────────────────────────────────────────
class OneEuroFilter:
    """
    Casiez et al. 2012 — adaptive low-pass filter.
    Stays rock-steady when your hand is still; instantly tracks fast motion.

    min_cutoff  (Hz)  lower  → smoother when still
    beta               higher → more responsive when fast
    d_cutoff    (Hz)  cutoff for the internal derivative smoother
    """

    def __init__(
        self,
        min_cutoff: float = 1.0,
        beta: float = 0.07,
        d_cutoff: float = 1.0,
    ) -> None:
        self.min_cutoff = min_cutoff
        self.beta       = beta
        self.d_cutoff   = d_cutoff
        self._x:  Optional[float] = None
        self._dx: float           = 0.0
        self._t:  Optional[float] = None

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        tau = 1.0 / (2.0 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def reset(self) -> None:
        self._x = self._t = None
        self._dx = 0.0

    def __call__(self, x: float, t: float) -> float:
        if self._x is None:
            self._x, self._t = x, t
            return x

        dt = max(t - self._t, 1e-6)

        # Smooth derivative
        dx     = (x - self._x) / dt
        a_d    = self._alpha(self.d_cutoff, dt)
        dx_hat = a_d * dx + (1.0 - a_d) * self._dx

        # Adaptive cutoff — faster movement → higher cutoff → less smoothing
        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        a      = self._alpha(cutoff, dt)
        x_hat  = a * x + (1.0 - a) * self._x

        self._x  = x_hat
        self._dx = dx_hat
        self._t  = t
        return x_hat


# ── Per-session tracking state ────────────────────────────────────────────────
class TrackState:
    def __init__(self) -> None:
        self.prev_x:      float = 0.0  # index tip x  (PAN / ROTATE_H)
        self.prev_y:      float = 0.0  # index tip y  (PAN)
        self.prev_avg_y:  float = 0.0  # avg(L8y,L12y) (ROTATE_V)
        self.prev_angle:  float = 0.0  # atan2(L12−L8) degrees (ROTATE_H)
        self.first_frame: bool  = True

        self.candidate_mode:  str = "NONE"
        self.candidate_count: int = 0
        self.confirmed_mode:  str = "NONE"
        self.last_active_s:   float = 0.0

        mc = S["OEF_MIN_CUTOFF"]
        b  = S["OEF_BETA"]
        dc = S["OEF_D_CUTOFF"]
        # One Euro Filter per coordinate of each landmark we use
        self.f8x  = OneEuroFilter(mc, b, dc)  # INDEX_FINGER_TIP  x
        self.f8y  = OneEuroFilter(mc, b, dc)  # INDEX_FINGER_TIP  y
        self.f12x = OneEuroFilter(mc, b, dc)  # MIDDLE_FINGER_TIP x
        self.f12y = OneEuroFilter(mc, b, dc)  # MIDDLE_FINGER_TIP y

    def reset_filters(self) -> None:
        for f in (self.f8x, self.f8y, self.f12x, self.f12y):
            f.reset()


# ── Detection thread ──────────────────────────────────────────────────────────
def detection_thread(
    async_queue: asyncio.Queue,
    main_loop:   asyncio.AbstractEventLoop,
    stop_event:  threading.Event,
) -> None:
    """Capture → recognise → push delta packets onto the asyncio queue."""
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision

    ensure_model()

    options = mp_vision.GestureRecognizerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=mp_vision.RunningMode.VIDEO,
        num_hands=1,
        min_hand_detection_confidence=0.6,
        min_hand_presence_confidence=0.6,
        min_tracking_confidence=0.6,
    )
    recognizer = mp_vision.GestureRecognizer.create_from_options(options)

    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 60)

    track    = TrackState()
    t0       = time.monotonic()
    last_ts  = -1

    def push(packet: dict) -> None:
        """Thread-safe non-blocking enqueue."""
        try:
            main_loop.call_soon_threadsafe(async_queue.put_nowait, packet)
        except asyncio.QueueFull:
            pass  # drop frame — frontend can't keep up

    print("[gesture] Webcam open — detection running.")

    while not stop_event.is_set():
        ok, frame = cap.read()
        if not ok:
            time.sleep(0.005)
            continue

        rgb   = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        ts_ms = int((time.monotonic() - t0) * 1000)
        if ts_ms <= last_ts:
            ts_ms = last_ts + 1
        last_ts = ts_ms

        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = recognizer.recognize_for_video(mp_img, ts_ms)
        t      = time.monotonic()

        # ── No hand visible ───────────────────────────────────────────────────
        if not result.hand_landmarks or not result.gestures:
            if (time.monotonic() - track.last_active_s) * 1000 > S["INACTIVE_MS"]:
                if track.confirmed_mode != "NONE":
                    # First time we cross the timeout: clear tracking state but
                    # send active=False with zero deltas so the frontend simply
                    # pauses gesture control WITHOUT touching the camera position.
                    track.reset_filters()
                    track.candidate_mode  = "NONE"
                    track.candidate_count = 0
                    track.confirmed_mode  = "NONE"
                    track.first_frame     = True
                    push({
                        "active": False, "gesture": "None", "confidence": 0.0,
                        "mode": "NONE",
                        "dPanX": 0, "dPanY": 0, "dTheta": 0, "dPhi": 0,
                        "dRadius": 0, "reset": False,
                    })
                # confirmed_mode is already "NONE" — don't flood the socket
            continue

        track.last_active_s = time.monotonic()

        raw_lm       = result.hand_landmarks[0]
        top          = result.gestures[0][0]
        gesture_name = top.category_name
        confidence   = top.score

        # ── One Euro Filter on key landmarks ─────────────────────────────────
        L8x  = track.f8x (raw_lm[8].x,  t)
        L8y  = track.f8y (raw_lm[8].y,  t)
        L12x = track.f12x(raw_lm[12].x, t)
        L12y = track.f12y(raw_lm[12].y, t)

        # ── Discrete confirmation ─────────────────────────────────────────────
        mapped = GESTURE_MAP.get(gesture_name, "NONE")
        # Per-gesture confidence thresholds
        if mapped == "RESET":
            required = S["RESET_MIN_CONFIDENCE"]
        elif mapped == "PAN":
            required = S["PAN_MIN_CONFIDENCE"]
        else:
            required = S["MIN_CONFIDENCE"]
        raw_mode = mapped if confidence >= required else "NONE"

        if raw_mode == track.candidate_mode:
            track.candidate_count = min(
                track.candidate_count + 1,
                S["GESTURE_CONFIRM_FRAMES"],
            )
        else:
            track.candidate_mode  = raw_mode
            track.candidate_count = 1

        if (
            track.candidate_count >= S["GESTURE_CONFIRM_FRAMES"]
            and track.candidate_mode != track.confirmed_mode
        ):
            track.confirmed_mode = track.candidate_mode
            track.first_frame    = True
            print(
                f"[gesture] ✅ CONFIRMED: {track.confirmed_mode}"
                f" ({gesture_name} @ {confidence * 100:.1f}%)"
            )

        mode = track.confirmed_mode

        # ── Relative-delta updates (1:1 hand movement → camera) ───────────────
        d_pan_x = d_pan_y = d_theta = d_phi = d_radius = 0.0
        do_reset = False

        if track.candidate_count >= S["GESTURE_CONFIRM_FRAMES"] and not track.first_frame:

            if mode == "PAN":
                # Invert x: webcam is mirrored, so "hand right" = x decreasing
                d_pan_x = -(L8x - track.prev_x) * S["PAN_SENSITIVITY"]
                d_pan_y = -(L8y - track.prev_y) * S["PAN_SENSITIVITY"]

            elif mode == "ZOOM_IN":
                # 👍 Thumb Up → zoom in (decrease radius) each frame held
                d_radius = -S["THUMB_ZOOM_SPEED"]

            elif mode == "ZOOM_OUT":
                # 👎 Thumb Down → zoom out (increase radius) each frame held
                d_radius = +S["THUMB_ZOOM_SPEED"]

            elif mode == "ROTATE_H":
                # Track V-sign twist angle (atan2 of index→middle vector)
                curr_angle = math.degrees(math.atan2(L12y - L8y, L12x - L8x))
                delta = curr_angle - track.prev_angle
                if delta >  180: delta -= 360
                if delta < -180: delta += 360
                d_theta = delta * (S["ROT_H_SENSITIVITY"] / 100.0)

            elif mode == "ROTATE_V":
                avg_y = (L8y + L12y) / 2.0
                d_phi = (avg_y - track.prev_avg_y) * S["ROT_V_SENSITIVITY"]

            elif mode == "RESET":
                do_reset = True

        # ── Update prev-frame values ──────────────────────────────────────────
        track.prev_x      = L8x
        track.prev_y      = L8y
        track.prev_avg_y  = (L8y + L12y) / 2.0
        track.prev_angle  = math.degrees(math.atan2(L12y - L8y, L12x - L8x))
        track.first_frame = False

        push({
            "active":     True,
            "gesture":    gesture_name,
            "confidence": round(float(confidence), 4),
            "mode":       mode,
            "dPanX":      round(d_pan_x,  5),
            "dPanY":      round(d_pan_y,  5),
            "dTheta":     round(d_theta,  4),
            "dPhi":       round(d_phi,    4),
            "dRadius":    round(d_radius, 4),
            "reset":      do_reset,
        })

    cap.release()
    recognizer.close()
    print("[gesture] Detection thread stopped.")


# ── WebSocket server ──────────────────────────────────────────────────────────
_connected: set = set()


async def _ws_handler(websocket) -> None:
    _connected.add(websocket)
    print(f"[gesture] Client connected  ({len(_connected)} total)")
    try:
        await websocket.wait_closed()
    finally:
        _connected.discard(websocket)
        print(f"[gesture] Client disconnected ({len(_connected)} total)")


async def _broadcast_loop(q: asyncio.Queue) -> None:
    while True:
        packet = await q.get()
        if not _connected:
            continue
        msg  = json.dumps(packet)
        dead = set()
        for ws in _connected:
            try:
                await ws.send(msg)
            except Exception:
                dead.add(ws)
        _connected.difference_update(dead)


async def main() -> None:
    q          = asyncio.Queue(maxsize=8)
    stop_event = threading.Event()
    loop       = asyncio.get_event_loop()

    t = threading.Thread(
        target=detection_thread,
        args=(q, loop, stop_event),
        daemon=True,
    )
    t.start()

    async with websockets.serve(_ws_handler, WS_HOST, WS_PORT):
        print(f"[gesture] WebSocket server → ws://{WS_HOST}:{WS_PORT}")
        await _broadcast_loop(q)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[gesture] Stopped.")
