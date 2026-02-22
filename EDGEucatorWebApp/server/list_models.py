"""List Gemini models. Run: python list_models.py"""
import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from google import genai
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

print("Models supporting generateContent:\n")
for m in client.models.list():
    if any(a == "generateContent" for a in (m.supported_actions or [])):
        print(m.name)
print("\nDone.")
