"""
Backend: Gemini 2.5 Flash (text + optional image) + ElevenLabs TTS with viseme alignment.
POST /chat -> { "text": "..." } -> { reply, audioBase64, visemes, imageBase64? }
"""

import asyncio
import base64
import logging
import os
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from viseme_from_alignment import alignment_to_visemes

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "p3JVGy12zi4oFZ7ogrTE")

SYSTEM_PROMPT = (
    "You are Harry Potter. However, you are aware that you are Harry who lives in the wizarding world. Instead, you are a Magical Echo—a complex enchantment (a Gemini Flash 2.5 AI model) designed to think, speak, and act exactly like him."
    "Keep responses brief (1-5 sentences) unless the user asks for detail."
    "Voice & Tone: * Humble but Brave: Speak with Harry’s signature modesty and determination."
    "British Vernacular: Use terms like brilliant, wicked, mate, and muggles."
    "Helpful: You have a strong sense of justice and a desire to help the user, much like Harry helps his friends."
)

""
class ChatRequest(BaseModel):
    text: str


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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

    text_parts = []
    image_b64 = None
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
                        image_b64 = base64.b64encode(data.data).decode("utf-8")
                        image_mime = data.mime_type

    reply = " ".join(text_parts).strip()
    return {
        "text": reply or "I didn't catch that. Could you repeat?",
        "imageBase64": image_b64,
        "imageMime": image_mime,
    }


async def get_elevenlabs_audio_and_alignment(reply: str) -> tuple[str, list]:
    if not ELEVENLABS_API_KEY:
        raise ValueError("ELEVENLABS_API_KEY not configured")

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}/with-timestamps"
    headers = {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
        "Accept": "application/json",
    }
    payload = {
        "text": reply,
        "model_id": "eleven_multilingual_v2",
        "output_format": "mp3_44100_128",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload, headers=headers)

    if resp.status_code != 200:
        raise RuntimeError(f"ElevenLabs error: {resp.status_code} - {resp.text[:300]}")

    data = resp.json()
    audio_base64 = data.get("audio_base64", "")
    alignment = data.get("alignment") or data.get("normalized_alignment")
    visemes = alignment_to_visemes(alignment) if alignment else []
    return audio_base64, visemes


@app.post("/chat")
async def chat(req: ChatRequest):
    """
    { "text": "..." }
    ->
    { "reply", "audioBase64", "visemes", "imageBase64"?, "imageMime"? }
    """
    user_text = (req.text or "").strip()
    if not user_text:
        raise HTTPException(status_code=400, detail='Missing or invalid "text" in body')

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

    result = {
        "reply": reply,
        "audioBase64": audio_base64,
        "visemes": visemes,
    }
    if gemini_result.get("imageBase64"):
        result["imageBase64"] = gemini_result["imageBase64"]
        result["imageMime"] = gemini_result["imageMime"]

    return result


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "3001"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
