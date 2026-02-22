# AI Mentor Avatar - Three.js + Ready Player Me

A browser-based 3D avatar experience using Three.js and Ready Player Me, designed to replace Unity-based avatars that don't work on Windows ARM. This project provides a pure web solution with no native plugins, making it compatible with all platforms and easy to integrate with AI/TTS pipelines.

## Unified flow (Gemini + ElevenLabs + React-Three-Fiber)

The app can run in a **unified mode** where the avatar responds to text input via Google Gemini, speaks with ElevenLabs (with alignment-based visemes for lip-sync), and automatically switches **Life State** (IDLE → LISTENING → SPEAKING) with no manual buttons.

### Run the full stack

1. **Backend** (Python: Gemini + ElevenLabs):
   ```bash
   cd server
   cp .env.example .env   # then set GEMINI_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
   python -m venv .venv
   source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   python main.py
   ```
   Server runs at `http://localhost:3001`.

2. **Frontend** (React + R3F):
   ```bash
   npm install && npm run dev
   ```
   App runs at `http://localhost:3000` and proxies `/api` to the backend.

3. **Usage**: Type a message and click Send. The backend calls Gemini for a reply, converts it to speech with ElevenLabs (with timestamps), and returns base64 audio + viseme keyframes. The 3D avatar plays the audio and drives lip-sync from the viseme timeline. **Life State** is automated: LISTENING while waiting, SPEAKING while audio plays, IDLE when done. A **RotationController** spins the model at a configurable `targetRPM` (default 2 RPM), independent of animation state.

---

## Features

- ✅ 3D avatar rendering using Three.js
- ✅ Ready Player Me avatar loading from GLB URL with full viseme morph targets
- ✅ Web Audio API integration for audio playback
- ✅ Real-time mouth/jaw animation driven by audio volume (morph targets)
- ✅ **Professional viseme-based lip-sync using Rhubarb Lip Sync (client-side)**
- ✅ Automatic fallback to browser-based extraction when Rhubarb JSON not available
- ✅ Smooth interpolation for natural mouth movement
- ✅ Modular architecture ready for TTS backend integration
- ✅ TypeScript for type safety and better developer experience

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Rhubarb Lip Sync CLI (optional, for accurate viseme extraction)

### Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Install Rhubarb Lip Sync (recommended for accurate lip-sync):**
   - **Windows**: Download from [Rhubarb Releases](https://github.com/DanielSWolf/rhubarb-lip-sync/releases) and add to PATH
   - **macOS**: `brew install rhubarb-lip-sync`
   - **Linux**: Download from [Rhubarb Releases](https://github.com/DanielSWolf/rhubarb-lip-sync/releases)
   
   Verify installation: `rhubarb -h`

3. **Add audio files:**
   - Place WAV or MP3 files in `/public/audio/` directory
   - Example: `/public/audio/audio.wav`

4. **Pre-process audio with Rhubarb (optional but recommended):**
```bash
# Process a single file
node scripts/process-audio.js public/audio/audio.wav

# Or use shell script (Mac/Linux)
./scripts/process-audio.sh public/audio/audio.wav

# Or batch process all files (Mac/Linux)
./scripts/process-all-audio.sh
```
   
   This creates JSON files (e.g., `audio.json`) that the app will automatically use for accurate lip-sync.

5. **Start the development server:**
```bash
npm run dev
```

6. **Open your browser** to the URL shown in the terminal (typically `http://localhost:3000`)

7. **Test the avatar:**
   - Click "Play Sample Audio (Volume-based)" for simple volume-based animation
   - Click "Analyze & Play with Visemes" for accurate viseme-based lip-sync
     - If Rhubarb JSON exists: Uses professional Rhubarb data
     - If no JSON: Falls back to browser-based analysis

## Project Structure

```
/
├── package.json          # Dependencies and scripts
├── vite.config.ts        # Vite configuration
├── tsconfig.json         # TypeScript configuration
├── index.html            # Main HTML file
├── README.md             # This file
├── scripts/              # Audio processing scripts
│   ├── process-audio.js  # Node.js script to process single file
│   ├── process-audio.sh  # Shell script (Mac/Linux)
│   ├── process-audio.bat # Batch script (Windows)
│   └── process-all-audio.sh # Batch process all files
├── public/
│   └── audio/            # Audio files directory
│       ├── audio.wav     # Audio file
│       └── audio.json    # Rhubarb JSON (pre-processed, optional)
└── src/
    ├── main.ts           # Application entry point
    ├── avatarScene.ts    # Three.js scene and avatar loading
    ├── audioLipSync.ts   # Web Audio and volume-based mouth movement
    ├── audioVisemeExtractor.ts # Browser-based viseme extraction (fallback)
    ├── rhubarbLoader.ts  # Load Rhubarb JSON files
    ├── rhubarbParser.ts  # Parse Rhubarb JSON format
    ├── visemePlayer.ts   # Viseme timeline player
    └── types.d.ts        # TypeScript type definitions
```

## Key Files Explained

### `src/avatarScene.ts`
- Creates and manages the Three.js scene
- Loads the Ready Player Me avatar from the GLB URL
- Detects morph targets for mouth animation
- Handles camera, lighting, and rendering

**Morph Target Detection:**
The `detectMouthMorphTarget()` function automatically searches for mouth/jaw morph targets by name. It looks for morph targets containing:
- "mouth"
- "jaw"
- "open"

If no match is found, it falls back to the first available morph target.

**To manually change the mouth morph target:**
1. Check the console logs after loading to see all available morph targets
2. Modify the `detectMouthMorphTarget()` function in `avatarScene.ts` to use a specific morph target index
3. Or set `this.mouthOpenIndex` directly after `loadAvatar()` completes

### `src/audioLipSync.ts`
- Handles audio loading and playback via Web Audio API
- Analyzes audio volume in real-time using RMS (Root Mean Square)
- Maps volume to mouth openness (0-1) with configurable sensitivity
- Provides smooth mouth movement through interpolation

**Sensitivity Tuning:**
The default sensitivity is `8`. To adjust how much the mouth opens:
- Increase sensitivity (e.g., `12`) for more pronounced movement
- Decrease sensitivity (e.g., `5`) for subtler movement

You can pass a custom config when calling `playAudioWithMouthMovement()`:
```typescript
await playAudioWithMouthMovement(audioUrl, onMouthOpenChange, {
  sensitivity: 10,
  smoothing: 0.8
});
```

### `src/main.ts`
- Wires everything together
- Sets up the UI button event handler
- Connects audio playback to avatar mouth movement

## Integrating with a Python TTS Backend

The code is structured to make TTS integration straightforward. Here's how to connect it to your Python backend:

### Step 1: Update `src/main.ts`

Replace the hardcoded audio URL with a fetch to your TTS endpoint:

```typescript
playButton.addEventListener('click', async () => {
  playButton.disabled = true;
  playButton.textContent = 'Generating speech...';

  try {
    // Call your Python TTS backend
    const response = await fetch('http://localhost:8000/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text: 'Hello, I am your AI mentor. How can I help you today?' 
      })
    });

    if (!response.ok) {
      throw new Error(`TTS request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const audioUrl = data.audioUrl; // or data.url, depending on your API

    // Play the generated audio
    await playAudioWithMouthMovement(audioUrl, avatarControls.setMouthOpen);
  } catch (error) {
    console.error('TTS error:', error);
    alert('Failed to generate speech. Please try again.');
  } finally {
    playButton.disabled = false;
    playButton.textContent = 'Play Sample Audio';
  }
});
```

### Step 2: Example Python FastAPI Backend

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import subprocess
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TTSRequest(BaseModel):
    text: str

@app.post("/tts")
async def generate_tts(request: TTSRequest):
    # Generate audio using your TTS engine (e.g., pyttsx3, gTTS, etc.)
    output_path = f"generated_{hash(request.text)}.wav"
    
    # Example using pyttsx3:
    # import pyttsx3
    # engine = pyttsx3.init()
    # engine.save_to_file(request.text, output_path)
    # engine.runAndWait()
    
    # Return the URL where the audio can be accessed
    return {"audioUrl": f"http://localhost:8000/audio/{output_path}"}
```

### Step 3: Future Extension - Viseme-Based Animation

For more accurate lip-sync, you can extend the system to use viseme timing data from your TTS backend. The structure is already in place:

1. Your TTS backend would return both audio URL and viseme timeline:
```json
{
  "audioUrl": "...",
  "visemes": [
    { "time": 0.0, "mouth": 0.0 },
    { "time": 0.1, "mouth": 0.8 },
    { "time": 0.3, "mouth": 0.5 },
    ...
  ]
}
```

2. Implement `applyVisemeTimeline()` in `audioLipSync.ts` (see comments in the file)

3. Use the timeline instead of volume-based movement for precise lip-sync

## Using Rhubarb Lip Sync

### Pre-Processing Audio Files

For the most accurate lip-sync, pre-process your audio files with Rhubarb:

1. **Install Rhubarb CLI** (see Prerequisites above)

2. **Process a single file:**
```bash
# Using Node.js script
node scripts/process-audio.js public/audio/your-file.wav

# Or using shell script (Mac/Linux)
./scripts/process-audio.sh public/audio/your-file.wav

# Or using batch script (Windows)
scripts\process-audio.bat public\audio\your-file.wav
```

3. **Batch process all files:**
```bash
./scripts/process-all-audio.sh
```

4. **Manual processing:**
```bash
rhubarb -f json -o public/audio/audio.json public/audio/audio.wav
```

### File Naming Convention

- Audio file: `audio.wav` → JSON file: `audio.json`
- Audio file: `speech.mp3` → JSON file: `speech.json`
- JSON file must be in the same directory as the audio file
- JSON file name = audio file name (without extension) + `.json`

### How It Works

1. When you click "Analyze & Play with Visemes", the app:
   - First tries to load `audio.json` (if `audio.wav` is the audio file)
   - If JSON found: Uses Rhubarb's accurate viseme data
   - If JSON not found: Falls back to browser-based audio analysis

2. The app automatically detects which method to use - no configuration needed!

## Building for Production

```bash
npm run build
```

The built files will be in the `dist/` directory, ready to be served by any static file server.

## Troubleshooting

### Avatar doesn't load
- Check the browser console for CORS errors
- Verify the Ready Player Me GLB URL is accessible
- Ensure you have an internet connection

### Mouth doesn't move
- Check the console for morph target detection logs
- Verify the audio file exists in `/public/audio`
- Check that the audio file format is supported (WAV, MP3, etc.)
- Try adjusting the sensitivity in `audioLipSync.ts`

### Audio doesn't play
- Ensure the audio file path is correct
- Check browser console for audio context errors
- Some browsers require user interaction before playing audio (click the button)

### Rhubarb processing fails
- Verify Rhubarb is installed: `rhubarb -h`
- Check that Rhubarb is in your PATH
- On Windows, you may need to use the full path: `C:\path\to\rhubarb.exe`
- Ensure audio file is in a supported format (WAV, MP3, etc.)

### Viseme animation not accurate
- Make sure you've pre-processed the audio with Rhubarb
- Check that the JSON file exists alongside the audio file
- Verify the JSON file is valid (check browser console for errors)
- If no JSON file, the app falls back to browser-based extraction (less accurate)

## License

This project is provided as-is for your use case.

## Credits

- [Three.js](https://threejs.org/) - 3D graphics library
- [Ready Player Me](https://readyplayer.me/) - Avatar platform
- [Vite](https://vitejs.dev/) - Build tool

