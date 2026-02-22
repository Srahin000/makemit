#!/bin/bash

# Process a single audio file with Rhubarb Lip Sync (Mac/Linux)
# 
# Usage:
#   ./scripts/process-audio.sh <audio-file>
# 
# Example:
#   ./scripts/process-audio.sh public/audio/audio.wav

if [ -z "$1" ]; then
    echo "Error: No audio file specified"
    echo "Usage: ./scripts/process-audio.sh <audio-file>"
    echo "Example: ./scripts/process-audio.sh public/audio/audio.wav"
    exit 1
fi

AUDIO_FILE="$1"

if [ ! -f "$AUDIO_FILE" ]; then
    echo "Error: Audio file not found: $AUDIO_FILE"
    exit 1
fi

# Get directory and base name
AUDIO_DIR=$(dirname "$AUDIO_FILE")
AUDIO_NAME=$(basename "$AUDIO_FILE" | sed 's/\.[^.]*$//')
JSON_FILE="$AUDIO_DIR/$AUDIO_NAME.json"

echo "Processing: $AUDIO_FILE"
echo "Output: $JSON_FILE"

# Check if Rhubarb is available
if ! command -v rhubarb &> /dev/null; then
    echo "Error: Rhubarb CLI not found"
    echo "Please install Rhubarb Lip Sync:"
    echo "  macOS:   brew install rhubarb-lip-sync"
    echo "  Linux:   Download from https://github.com/DanielSWolf/rhubarb-lip-sync/releases"
    exit 1
fi

# Run Rhubarb
rhubarb -f json -o "$JSON_FILE" "$AUDIO_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Success! Rhubarb JSON created: $JSON_FILE"
    echo "The web app will automatically use this file for accurate lip-sync."
else
    echo ""
    echo "❌ Error processing audio file"
    exit 1
fi

