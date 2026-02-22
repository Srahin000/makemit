#!/bin/bash

# Batch process all audio files in public/audio/ directory with Rhubarb Lip Sync
# 
# Usage:
#   ./scripts/process-all-audio.sh
# 
# This script processes all .wav, .mp3, .m4a, and .ogg files in public/audio/

AUDIO_DIR="public/audio"

if [ ! -d "$AUDIO_DIR" ]; then
    echo "Error: Audio directory not found: $AUDIO_DIR"
    exit 1
fi

# Check if Rhubarb is available
if ! command -v rhubarb &> /dev/null; then
    echo "Error: Rhubarb CLI not found"
    echo "Please install Rhubarb Lip Sync:"
    echo "  macOS:   brew install rhubarb-lip-sync"
    echo "  Linux:   Download from https://github.com/DanielSWolf/rhubarb-lip-sync/releases"
    exit 1
fi

echo "Processing all audio files in $AUDIO_DIR..."
echo ""

# Find all audio files
AUDIO_FILES=$(find "$AUDIO_DIR" -type f \( -name "*.wav" -o -name "*.mp3" -o -name "*.m4a" -o -name "*.ogg" \))

if [ -z "$AUDIO_FILES" ]; then
    echo "No audio files found in $AUDIO_DIR"
    exit 0
fi

PROCESSED=0
FAILED=0

while IFS= read -r AUDIO_FILE; do
    AUDIO_NAME=$(basename "$AUDIO_FILE" | sed 's/\.[^.]*$//')
    JSON_FILE="$(dirname "$AUDIO_FILE")/$AUDIO_NAME.json"
    
    # Skip if JSON already exists
    if [ -f "$JSON_FILE" ]; then
        echo "⏭️  Skipping $AUDIO_FILE (JSON already exists)"
        continue
    fi
    
    echo "Processing: $AUDIO_FILE"
    
    if rhubarb -f json -o "$JSON_FILE" "$AUDIO_FILE" 2>/dev/null; then
        echo "  ✅ Created: $JSON_FILE"
        ((PROCESSED++))
    else
        echo "  ❌ Failed: $AUDIO_FILE"
        ((FAILED++))
    fi
    echo ""
done <<< "$AUDIO_FILES"

echo "=========================================="
echo "Processed: $PROCESSED files"
if [ $FAILED -gt 0 ]; then
    echo "Failed: $FAILED files"
fi
echo "=========================================="

