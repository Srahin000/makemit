import type { OculusViseme, VisemeKey, VisemeTimeline } from './types';

// Note: Phoneme to viseme mappings are not currently used in the implementation
// but kept for potential future use in more sophisticated phoneme detection

/**
 * Analyzes audio buffer to extract viseme timeline
 * 
 * This is a simplified implementation that uses audio analysis
 * to estimate phonemes and map them to visemes. For production use,
 * consider using a more sophisticated phoneme recognition system
 * or pre-processed data from tools like Rhubarb Lip Sync.
 * 
 * @param audioBuffer - Decoded audio buffer from Web Audio API
 * @returns Promise resolving to viseme timeline
 */
export async function extractVisemesFromAudio(
  audioBuffer: AudioBuffer
): Promise<VisemeTimeline> {
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const channelData = audioBuffer.getChannelData(0); // Use first channel
  
  // Analyze audio in time windows
  const windowSize = 0.1; // 100ms windows
  const windowSamples = Math.floor(windowSize * sampleRate);
  const numWindows = Math.ceil(channelData.length / windowSamples);
  
  const visemes: VisemeKey[] = [];
  let currentViseme: OculusViseme = 'sil';
  let currentStartTime = 0;
  
  // Process each window
  for (let i = 0; i < numWindows; i++) {
    const start = i * windowSamples;
    const end = Math.min(start + windowSamples, channelData.length);
    const window = channelData.slice(start, end);
    const time = (start / sampleRate);
    
    // Analyze this window
    const detectedViseme = analyzeAudioWindow(window, sampleRate, time);
    
    // If viseme changed, add a keyframe
    if (detectedViseme !== currentViseme) {
      // End previous viseme
      if (currentViseme !== 'sil' || i > 0) {
        visemes.push({
          time: currentStartTime,
          viseme: currentViseme,
          intensity: 1.0
        });
      }
      
      // Start new viseme
      currentViseme = detectedViseme;
      currentStartTime = time;
    }
  }
  
  // Add final viseme
  if (currentViseme !== 'sil') {
    visemes.push({
      time: currentStartTime,
      viseme: currentViseme,
      intensity: 1.0
    });
  }
  
  // Add silence at the end if needed
  if (visemes.length > 0 && visemes[visemes.length - 1].time < duration - 0.1) {
    visemes.push({
      time: duration - 0.1,
      viseme: 'sil',
      intensity: 0.0
    });
  }
  
  return {
    visemes,
    duration
  };
}

/**
 * Analyzes a window of audio samples to detect viseme
 * 
 * This is a simplified phoneme detection based on:
 * - Energy/volume (for silence detection)
 * - Frequency analysis (formants) for vowel detection
 * - Spectral characteristics for consonant detection
 * 
 * @param samples - Audio samples for this window
 * @param sampleRate - Audio sample rate
 * @param time - Current time in audio
 * @returns Detected viseme
 */
function analyzeAudioWindow(
  samples: Float32Array,
  sampleRate: number,
  time: number
): OculusViseme {
  // Calculate RMS energy
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);
  
  // Silence detection
  if (rms < 0.01) {
    return 'sil';
  }
  
  // Perform FFT for frequency analysis
  const fftSize = Math.pow(2, Math.ceil(Math.log2(samples.length)));
  const fft = performFFT(samples, fftSize);
  
  // Find formants (peaks in frequency spectrum)
  const formants = findFormants(fft, sampleRate);
  
  // Classify based on formants and energy
  return classifyViseme(formants, rms, time);
}

/**
 * Performs frequency analysis on audio samples using autocorrelation
 * This is a simplified implementation - for production, use a proper FFT library
 */
function performFFT(samples: Float32Array, size: number): Float32Array {
  // Use autocorrelation to estimate frequency content
  const output = new Float32Array(size);
  const minPeriod = 2;
  const maxPeriod = Math.min(size / 2, samples.length / 2);
  
  // Simple frequency analysis using autocorrelation
  for (let period = minPeriod; period < maxPeriod; period++) {
    let correlation = 0;
    const numSamples = Math.min(samples.length - period, size);
    
    for (let i = 0; i < numSamples; i++) {
      correlation += samples[i] * samples[i + period];
    }
    
    if (numSamples > 0) {
      correlation /= numSamples;
      const freqIndex = Math.floor(period);
      if (freqIndex < size) {
        output[freqIndex] = Math.abs(correlation);
      }
    }
  }
  
  // Also include amplitude information
  for (let i = 0; i < Math.min(samples.length, size); i++) {
    output[i] = Math.max(output[i], Math.abs(samples[i]) * 0.5);
  }
  
  return output;
}

/**
 * Finds formants (F1, F2, F3) from frequency spectrum
 */
function findFormants(fft: Float32Array, sampleRate: number): { f1: number; f2: number; f3: number } {
  const nyquist = sampleRate / 2;
  const binSize = nyquist / fft.length;
  
  // Find peaks in frequency spectrum
  const peaks: { freq: number; magnitude: number }[] = [];
  
  for (let i = 1; i < fft.length - 1; i++) {
    if (fft[i] > fft[i - 1] && fft[i] > fft[i + 1] && fft[i] > 0.1) {
      peaks.push({
        freq: i * binSize,
        magnitude: fft[i]
      });
    }
  }
  
  // Sort by magnitude and take top 3
  peaks.sort((a, b) => b.magnitude - a.magnitude);
  
  return {
    f1: peaks[0]?.freq || 0,
    f2: peaks[1]?.freq || 0,
    f3: peaks[2]?.freq || 0
  };
}

/**
 * Classifies viseme based on formants and energy
 * 
 * This is a simplified classification. Real phoneme detection
 * would use more sophisticated analysis including:
 * - Formant tracking over time
 * - Spectral envelope analysis
 * - Machine learning models
 */
function classifyViseme(
  formants: { f1: number; f2: number; f3: number },
  rms: number,
  _time: number
): OculusViseme {
  const { f1, f2 } = formants;
  
  // Vowel classification based on formants
  if (f1 > 0 && f2 > 0) {
    // High F1, low F2 = back vowels (oh, ou)
    if (f1 > 500 && f2 < 1200) {
      return f2 < 800 ? 'ou' : 'oh';
    }
    
    // High F1, high F2 = front vowels (aa, E, ih)
    if (f1 > 500 && f2 > 1200) {
      if (f2 > 2000) return 'ih';
      if (f2 > 1600) return 'E';
      return 'aa';
    }
    
    // Low F1 = closed vowels (ih, E)
    if (f1 < 500) {
      return f2 > 2000 ? 'ih' : 'E';
    }
  }
  
  // Consonant classification (simplified)
  // High frequency energy = fricatives (FF, TH, SS)
  if (f2 > 3000) {
    if (f1 < 200) return 'TH';
    if (f1 < 400) return 'FF';
    return 'SS';
  }
  
  // Low frequency energy = stops/plosives (PP, DD, kk)
  if (f1 < 300 && f2 < 1500) {
    if (f2 < 800) return 'kk';
    if (f2 < 1200) return 'DD';
    return 'PP';
  }
  
  // Medium frequency = nasals/liquids (nn, RR)
  if (f1 > 200 && f1 < 500 && f2 > 1000 && f2 < 2000) {
    return f2 > 1500 ? 'RR' : 'nn';
  }
  
  // Default based on energy
  if (rms > 0.1) {
    return 'aa'; // Open mouth for high energy
  }
  
  return 'sil';
}

/**
 * Loads audio from URL and extracts visemes using browser-based analysis
 * This is a fallback method when Rhubarb JSON is not available.
 * 
 * @param audioUrl - URL of the audio file
 * @returns Promise resolving to viseme timeline
 */
export async function extractVisemesFromAudioUrl(
  audioUrl: string
): Promise<VisemeTimeline> {
  // Fetch and decode audio
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.statusText}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  return extractVisemesFromAudio(audioBuffer);
}

/**
 * Extracts visemes from audio URL, trying Rhubarb JSON first, then falling back to browser-based extraction
 * 
 * This function:
 * 1. First attempts to load a pre-processed Rhubarb JSON file (same name as audio, .json extension)
 * 2. If Rhubarb JSON is not found, falls back to browser-based audio analysis
 * 
 * For best results, pre-process audio files with Rhubarb CLI:
 * ```bash
 * rhubarb -f json -o public/audio/audio.json public/audio/audio.wav
 * ```
 * 
 * @param audioUrl - URL of the audio file (e.g., `/audio/audio.wav`)
 * @returns Promise resolving to viseme timeline
 */
export async function extractVisemesFromAudioUrlWithRhubarb(
  audioUrl: string
): Promise<VisemeTimeline> {
  // Import dynamically to avoid circular dependencies
  const { loadRhubarbJSONForAudio } = await import('./rhubarbLoader');
  
  // Try to load Rhubarb JSON first
  const rhubarbTimeline = await loadRhubarbJSONForAudio(audioUrl);
  
  if (rhubarbTimeline !== null) {
    console.log('Using Rhubarb Lip Sync data for accurate viseme extraction');
    return rhubarbTimeline;
  }
  
  // Fallback to browser-based extraction
  console.log('Rhubarb JSON not found, using browser-based audio analysis');
  return await extractVisemesFromAudioUrl(audioUrl);
}

