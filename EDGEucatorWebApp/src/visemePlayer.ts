import type { OculusViseme, VisemeTimeline } from './types';

/**
 * Plays a viseme timeline synchronized with audio playback
 * 
 * @param audioUrl - URL of the audio file to play
 * @param timeline - Viseme timeline to synchronize with audio
 * @param onVisemeChange - Callback called when viseme changes (viseme, intensity)
 * @returns Promise that resolves when audio playback completes
 */
export async function playVisemeTimeline(
  audioUrl: string,
  timeline: VisemeTimeline,
  onVisemeChange: (viseme: OculusViseme, intensity: number) => void
): Promise<void> {
  // Create audio context
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

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
    source.connect(audioContext.destination);

    // Start playback
    const startTime = audioContext.currentTime;
    source.start(0);
    // Audio playback started

    // Animation loop for viseme synchronization
    let animationFrameId: number;
    let isPlaying = true;
    let resolvePromise: () => void;

    const updateVisemes = (): void => {
      if (!isPlaying) {
        return;
      }

      // Calculate current playback time
      const currentTime = audioContext.currentTime - startTime;

      // Check if audio has finished
      if (currentTime >= audioBuffer.duration) {
        isPlaying = false;
        cancelAnimationFrame(animationFrameId);
        onVisemeChange('sil', 0);
        // Audio playback finished
        if (resolvePromise) {
          resolvePromise();
        }
        return;
      }

      // Find current viseme from timeline
      const currentViseme = getCurrentViseme(timeline, currentTime);
      
      // Call callback with current viseme
      onVisemeChange(currentViseme.viseme, currentViseme.intensity || 1.0);

      // Continue animation loop
      animationFrameId = requestAnimationFrame(updateVisemes);
    };

    // Handle audio end
    source.onended = () => {
      isPlaying = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      onVisemeChange('sil', 0);
      // Audio playback finished
      if (resolvePromise) {
        resolvePromise();
      }
    };

    // Start viseme update loop
    updateVisemes();

    // Wait for audio to finish
    await new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

  } catch (error) {
    console.error('Error playing audio with visemes:', error);
    throw error;
  }
}

/**
 * Gets the current viseme at a given time from the timeline
 * Interpolates between visemes for smooth transitions
 * 
 * @param timeline - Viseme timeline
 * @param currentTime - Current playback time
 * @returns Current viseme key with interpolated intensity
 */
function getCurrentViseme(
  timeline: VisemeTimeline,
  currentTime: number
): { viseme: OculusViseme; intensity: number } {
  const { visemes } = timeline;

  // If before first viseme, return silence
  if (visemes.length === 0 || currentTime < visemes[0].time) {
    return { viseme: 'sil', intensity: 0 };
  }

  // If after last viseme, return last viseme or silence
  if (currentTime >= visemes[visemes.length - 1].time) {
    const lastViseme = visemes[visemes.length - 1];
    return {
      viseme: lastViseme.viseme,
      intensity: lastViseme.intensity || 1.0
    };
  }

  // Find the current viseme segment
  for (let i = 0; i < visemes.length - 1; i++) {
    const current = visemes[i];
    const next = visemes[i + 1];

    if (currentTime >= current.time && currentTime < next.time) {
      // Calculate interpolation factor
      const segmentDuration = next.time - current.time;
      const timeInSegment = currentTime - current.time;
      const t = segmentDuration > 0 ? timeInSegment / segmentDuration : 0;

      // Interpolate intensity
      const currentIntensity = current.intensity || 1.0;
      const nextIntensity = next.intensity || 1.0;
      const intensity = currentIntensity + (nextIntensity - currentIntensity) * t;

      // For smooth transitions, blend between visemes
      // Use current viseme with interpolated intensity
      return {
        viseme: current.viseme,
        intensity: Math.max(0, Math.min(1, intensity))
      };
    }
  }

  // Fallback to last viseme
  const lastViseme = visemes[visemes.length - 1];
  return {
    viseme: lastViseme.viseme,
    intensity: lastViseme.intensity || 1.0
  };
}

/**
 * Creates a simple test viseme timeline for testing
 * 
 * @param duration - Duration of the timeline in seconds
 * @returns Test viseme timeline
 */
export function createTestVisemeTimeline(duration: number): VisemeTimeline {
  const visemes = [
    { time: 0.0, viseme: 'sil' as OculusViseme, intensity: 0 },
    { time: 0.1, viseme: 'aa' as OculusViseme, intensity: 1.0 },
    { time: 0.3, viseme: 'E' as OculusViseme, intensity: 1.0 },
    { time: 0.5, viseme: 'ih' as OculusViseme, intensity: 1.0 },
    { time: 0.7, viseme: 'oh' as OculusViseme, intensity: 1.0 },
    { time: 0.9, viseme: 'ou' as OculusViseme, intensity: 1.0 },
    { time: duration - 0.1, viseme: 'sil' as OculusViseme, intensity: 0 },
  ];

  return {
    visemes,
    duration
  };
}

