/**
 * Web Audio API integration for audio playback and mouth movement
 * 
 * This module provides audio playback with real-time volume analysis
 * to drive mouth morph targets. In the future, this can be extended
 * to use viseme timing data from a TTS backend instead of volume-based movement.
 */

/**
 * Configuration for audio analysis
 */
interface AudioConfig {
  /** Sensitivity multiplier for RMS to openness mapping (higher = more sensitive) */
  sensitivity: number;
  /** Smoothing factor for RMS values (0-1, higher = smoother) */
  smoothing: number;
}

const DEFAULT_CONFIG: AudioConfig = {
  sensitivity: 8,
  smoothing: 0.8
};

/**
 * Plays an audio file and provides real-time mouth openness values based on audio volume
 * 
 * @param audioUrl - URL of the audio file to play (e.g., '/sample-audio.wav')
 * @param onMouthOpenChange - Callback function that receives mouth openness (0-1) each frame
 * @param config - Optional configuration for audio analysis
 * 
 * @example
 * ```typescript
 * await playAudioWithMouthMovement('/sample-audio.wav', (openness) => {
 *   avatarControls.setMouthOpen(openness);
 * });
 * ```
 * 
 * FUTURE EXTENSION: Replace audioUrl with a dynamic URL from your Python TTS backend:
 * ```typescript
 * // In your main.ts or wherever you handle TTS requests:
 * const response = await fetch('http://localhost:8000/tts', {
 *   method: 'POST',
 *   body: JSON.stringify({ text: 'Hello, I am your AI mentor.' })
 * });
 * const { audioUrl } = await response.json();
 * await playAudioWithMouthMovement(audioUrl, onMouthOpenChange);
 * ```
 */
export async function playAudioWithMouthMovement(
  audioUrl: string,
  onMouthOpenChange: (openness01: number) => void,
  config: Partial<AudioConfig> = {}
): Promise<void> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // Create audio context
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  // Create analyser node for audio analysis
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = finalConfig.smoothing;

  // Buffer for time domain data
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  try {
    // Fetch and decode audio
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Create buffer source
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    // Start playback
    source.start(0);
    // Audio playback started

    // Animation loop for real-time analysis
    let animationFrameId: number;
    let smoothedRms = 0;
    let isPlaying = true;

    const analyzeAudio = (): void => {
      if (!isPlaying) {
        return;
      }

      // Get time domain data (waveform samples)
      analyser.getByteTimeDomainData(dataArray);

      // Calculate RMS (Root Mean Square) for loudness
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        // Convert byte (0-255) to normalized value (-1 to 1)
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / bufferLength);

      // Smooth the RMS value
      smoothedRms = smoothedRms * 0.7 + rms * 0.3;

      // Map RMS to mouth openness (0-1)
      // RMS is typically in range 0-1, but we multiply by sensitivity
      // to make the movement more pronounced
      const openness = Math.min(1, smoothedRms * finalConfig.sensitivity);

      // Call the callback with the current openness value
      onMouthOpenChange(openness);

      // Continue analysis loop
      animationFrameId = requestAnimationFrame(analyzeAudio);
    };

    // Wait for audio to finish
    await new Promise<void>((resolve) => {
      // Handle audio end
      source.onended = () => {
        isPlaying = false;
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
        onMouthOpenChange(0);
        // Audio playback finished
        resolve();
      };
      
      // Start analysis loop (must be after setting up onended handler)
      analyzeAudio();
    });

  } catch (error) {
    console.error('Error playing audio:', error);
    throw error;
  }
}

/**
 * FUTURE EXTENSION: Viseme-based mouth animation
 * 
 * This function structure is ready for when you want to switch from
 * volume-based movement to precise viseme timing from your TTS backend.
 * 
 * @example
 * ```typescript
 * // Your TTS backend would return something like:
 * // {
 * //   audioUrl: '...',
 * //   visemes: [
 * //     { time: 0.0, mouth: 0.0 },
 * //     { time: 0.1, mouth: 0.8 },
 * //     { time: 0.3, mouth: 0.5 },
 * //     ...
 * //   ]
 * // }
 * 
 * function applyVisemeTimeline(
 *   currentTime: number,
 *   timeline: VisemeKey[]
 * ): void {
 *   // Find the current viseme based on timeline
 *   // Interpolate between keyframes
 *   // Apply to avatar mouth morph target
 * }
 * ```
 */

