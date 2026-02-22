"""
main.py
-------
FastAPI backend — stateful mode controller + AI chat + wake word.

Routes
  POST /chat                  – AI chat (AI_ASSISTANT mode only)
  POST /api/set-mode          – Switch between ML_JARS | CAD_VIEWER | AI_ASSISTANT
  GET  /api/status            – Current mode + feature flags + wake-word flag
  POST /api/acknowledge-wake  – Clear wake-word pending flag after frontend acts
  WS   /ws                    – Push-channel for wake-word events & mode changes
"""

import asyncio
import base64
import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from modes import AppMode, state_manager
from viseme_from_alignment import alignment_to_visemes
from wake_word import WakeWordEngine

# ── Environment ───────────────────────────────────────────────────────────────
load_dotenv(Path(__file__).parent / ".env")
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

GEMINI_API_KEY      = os.getenv("GEMINI_API_KEY")
ELEVENLABS_API_KEY  = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "p3JVGy12zi4oFZ7ogrTE")
PICO_ACCESS_KEY     = os.getenv("PICO_ACCESS_KEY", "")

# Resolve .ppn path relative to this file (works from any cwd)
_HERE      = Path(__file__).parent
PPN_PATH   = str(_HERE.parent / "harrypotter_pico_word" / "Harry-Potter_en_mac_v3_0_0.ppn")

SYSTEM_PROMPT = (
    "You are Harry Potter. However, you are aware that you are Harry who lives in the "
    "wizarding world. Instead, you are a Magical Echo — a complex enchantment "
    "(a Gemini Flash 2.5 AI model) designed to think, speak, and act exactly like him. "
    "Keep responses brief (1-5 sentences) unless the user asks for detail. "
    "Voice & Tone: Humble but Brave — speak with Harry's signature modesty and "
    "determination. British Vernacular: use terms like brilliant, wicked, mate, muggles. "
    "Helpful: strong sense of justice and desire to help."
)

# ── WebSocket connection manager ──────────────────────────────────────────────
class ConnectionManager:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)
        logger.info(f"[ws] Client connected  ({len(self._clients)} total)")

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)
        logger.info(f"[ws] Client disconnected ({len(self._clients)} total)")

    async def broadcast(self, payload: dict) -> None:
        dead: set[WebSocket] = set()
        for ws in list(self._clients):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.add(ws)
        self._clients.difference_update(dead)


ws_manager = ConnectionManager()


# ── Lifespan: start / stop wake-word engine ───────────────────────────────────
_wake_engine: WakeWordEngine | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _wake_engine
    loop = asyncio.get_event_loop()

    if PICO_ACCESS_KEY and Path(PPN_PATH).exists():
        _wake_engine = WakeWordEngine(
            access_key=PICO_ACCESS_KEY,
            model_path=PPN_PATH,
            callback=state_manager.trigger_wake_word,
            broadcast=ws_manager.broadcast,
            loop=loop,
        )
        _wake_engine.start()
    else:
        logger.warning(
            "[main] Wake-word engine NOT started — "
            "set PICO_ACCESS_KEY in .env and confirm .ppn path."
        )

    yield  # app runs here

    if _wake_engine:
        _wake_engine.stop()


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic models ───────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    text: str


class ModeRequest(BaseModel):
    mode: str


# ── WebSocket route ───────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        # Send current state immediately on connect
        await websocket.send_json(state_manager.get_status())
        while True:
            await websocket.receive_text()   # keep connection alive; ignore messages
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(websocket)


# ── Mode routes ───────────────────────────────────────────────────────────────
@app.post("/set-mode")
async def set_mode(req: ModeRequest):
    """Switch between ML_JARS, CAD_VIEWER, and AI_ASSISTANT."""
    result = state_manager.set_mode(req.mode)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])

    logger.info(f"[mode] Switched → {result['mode']}")

    # Broadcast new mode to all WS clients so the frontend reacts immediately
    await ws_manager.broadcast({"event": "mode_change", **result})
    return result


@app.get("/status")
async def get_status():
    """Poll-able endpoint for current mode + feature flags + wake-word flag."""
    return state_manager.get_status()


@app.post("/acknowledge-wake")
async def acknowledge_wake():
    """Call this after the frontend has acted on the wake-word event."""
    state_manager.acknowledge_wake_word()
    return {"status": "ok"}


# ── AI chat (AI_ASSISTANT mode only) ─────────────────────────────────────────
def get_gemini_reply(user_text: str) -> dict:
    """
    Call Gemini 2.5 Flash for a fast text reply.
    Returns { "text": str, "imageBase64": str | None, "imageMime": str | None }.
    """
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY not configured")

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=GEMINI_API_KEY)
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=user_text,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=0.7,
        ),
    )

    text_parts: list[str] = []
    image_b64  = None
    image_mime = None

    if response.candidates:
        for candidate in response.candidates:
            if not candidate.content or not candidate.content.parts:
                continue
            for part in candidate.content.parts:
                if hasattr(part, "text") and part.text:
                    text_parts.append(part.text)
                elif hasattr(part, "inline_data") and part.inline_data:
                    data = part.inline_data
                    if data.data and data.mime_type and data.mime_type.startswith("image/"):
                        image_b64  = base64.b64encode(data.data).decode()
                        image_mime = data.mime_type

    return {
        "text":        " ".join(text_parts).strip() or "I didn't catch that, mate.",
        "imageBase64": image_b64,
        "imageMime":   image_mime,
    }


async def get_elevenlabs_audio_and_alignment(reply: str) -> tuple[str, list]:
    if not ELEVENLABS_API_KEY:
        raise ValueError("ELEVENLABS_API_KEY not configured")

    url     = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}/with-timestamps"
    headers = {
        "Content-Type": "application/json",
        "xi-api-key":   ELEVENLABS_API_KEY,
        "Accept":       "application/json",
    }
    payload = {
        "text":         reply,
        "model_id":     "eleven_multilingual_v2",
        "output_format": "mp3_44100_128",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload, headers=headers)

    if resp.status_code != 200:
        raise RuntimeError(f"ElevenLabs error {resp.status_code}: {resp.text[:300]}")

    data      = resp.json()
    alignment = data.get("alignment") or data.get("normalized_alignment")
    visemes   = alignment_to_visemes(alignment) if alignment else []
    return data.get("audio_base64", ""), visemes


@app.post("/chat")
async def chat(req: ChatRequest):
    """
    AI chat endpoint — only active in AI_ASSISTANT mode.
    { "text": "..." } → { reply, audioBase64, visemes, imageBase64?, imageMime? }
    """
    if state_manager.current_mode != AppMode.AI_ASSISTANT:
        mode_label = state_manager.current_mode.value
        return {
            "reply":       f"I'm in {mode_label} mode right now. Switch to AI_ASSISTANT to chat!",
            "audioBase64": "",
            "visemes":     [],
        }

    user_text = (req.text or "").strip()
    if not user_text:
        raise HTTPException(status_code=400, detail='Missing "text" in body')

    # Clear the wake-word flag — user has started interacting
    state_manager.acknowledge_wake_word()

    try:
        gemini_result = await asyncio.to_thread(get_gemini_reply, user_text)
    except Exception as e:
        logger.exception("Chat failed at Gemini step")
        raise HTTPException(status_code=500, detail=str(e))

    reply = gemini_result["text"]

    try:
        audio_base64, visemes = await get_elevenlabs_audio_and_alignment(reply)
    except Exception as e:
        logger.exception("Chat failed at ElevenLabs step")
        raise HTTPException(status_code=502, detail=f"TTS failed: {e}")

    result: dict = {"reply": reply, "audioBase64": audio_base64, "visemes": visemes}
    if gemini_result.get("imageBase64"):
        result["imageBase64"] = gemini_result["imageBase64"]
        result["imageMime"]   = gemini_result["imageMime"]

    return result


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "3001"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
