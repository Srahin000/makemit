import type { OculusViseme, VisemeTimeline, VisemeKey } from './types';

/**
 * Rhubarb Lip Sync viseme mapping
 * Maps Rhubarb viseme names to Oculus visemes
 */
const RHUBARB_TO_OCULUS: { [key: string]: OculusViseme } = {
  'X': 'sil',  // silence
  'A': 'aa',   // a
  'B': 'PP',   // b, p, m
  'C': 'kk',   // k, g
  'D': 'DD',   // d, t
  'E': 'E',    // e
  'F': 'FF',   // f, v
  'G': 'kk',   // g, k
  'H': 'sil',  // h (often silent)
  'I': 'ih',   // i
  'K': 'kk',   // k
  'L': 'nn',   // l
  'M': 'PP',   // m
  'N': 'nn',   // n
  'O': 'oh',   // o
  'P': 'PP',   // p
  'Q': 'kk',   // q (kw sound)
  'R': 'RR',   // r
  'S': 'SS',   // s
  'T': 'DD',   // t
  'U': 'ou',   // u
  'V': 'FF',   // v
  'W': 'ou',   // w
  'Y': 'ih',   // y
  'Z': 'SS',   // z
};

/**
 * Parses Rhubarb Lip Sync JSON format into our VisemeTimeline format
 * 
 * Rhubarb JSON format example:
 * {
 *   "metadata": {
 *     "soundFile": "audio.wav",
 *     "duration": 5.2
 *   },
 *   "mouthCues": [
 *     {
 *       "start": 0.0,
 *       "end": 0.1,
 *       "value": "A"
 *     },
 *     ...
 *   ]
 * }
 * 
 * @param json - Rhubarb JSON data
 * @returns VisemeTimeline in our format
 */
export function parseRhubarbJSON(json: any): VisemeTimeline {
  if (!json.mouthCues || !Array.isArray(json.mouthCues)) {
    throw new Error('Invalid Rhubarb JSON: missing mouthCues array');
  }

  const visemes: VisemeKey[] = [];
  let duration = 0;

  // Extract duration from metadata or calculate from last cue
  if (json.metadata && json.metadata.duration) {
    duration = json.metadata.duration;
  } else if (json.mouthCues.length > 0) {
    const lastCue = json.mouthCues[json.mouthCues.length - 1];
    duration = lastCue.end || lastCue.start + 0.1;
  }

  // Convert Rhubarb cues to viseme keyframes
  for (const cue of json.mouthCues) {
    const rhubarbViseme = cue.value || cue.viseme || 'X';
    const oculusViseme = RHUBARB_TO_OCULUS[rhubarbViseme] || 'sil';

    // Rhubarb uses start/end, we use time points
    // Add start time
    visemes.push({
      time: cue.start || 0,
      viseme: oculusViseme,
      intensity: 1.0
    });
  }

  // Ensure we have a silence at the start if needed
  if (visemes.length === 0 || visemes[0].time > 0.1) {
    visemes.unshift({
      time: 0,
      viseme: 'sil',
      intensity: 0
    });
  }

  // Ensure we have a silence at the end
  if (visemes.length === 0 || visemes[visemes.length - 1].time < duration - 0.1) {
    visemes.push({
      time: Math.max(duration - 0.1, 0),
      viseme: 'sil',
      intensity: 0
    });
  }

  // Sort by time
  visemes.sort((a, b) => a.time - b.time);

  return {
    visemes,
    duration
  };
}

