import { Mesh, AnimationMixer } from 'three';

/**
 * Extended mesh type that includes morph target information
 */
export interface AvatarMesh extends Mesh {
  morphTargetDictionary?: { [key: string]: number };
  morphTargetInfluences?: number[];
}

/**
 * Oculus viseme standard (15 visemes)
 * Used for lip-sync animation mapping
 */
export type OculusViseme = 
  | 'sil'  // silence
  | 'PP'   // p, b, m
  | 'FF'   // f, v
  | 'TH'   // th
  | 'DD'   // t, d, s, z
  | 'kk'   // k, g
  | 'CH'   // ch, j
  | 'SS'   // s, z
  | 'nn'   // n, l
  | 'RR'   // r
  | 'aa'   // a
  | 'E'    // e
  | 'ih'   // i
  | 'oh'   // o
  | 'ou';  // u

/**
 * Viseme keyframe for viseme-based animation
 */
export interface VisemeKey {
  time: number;
  viseme: OculusViseme;
  intensity?: number; // 0-1, default 1
}

/**
 * Complete viseme timeline for audio synchronization
 */
export interface VisemeTimeline {
  visemes: VisemeKey[];
  duration: number;
}

/**
 * Avatar animation states
 */
export type AvatarState = 'idle' | 'listening' | 'talking';

/**
 * Bone pose definition for a specific animation state
 */
export interface BonePose {
  boneName: string;
  rotation: { x: number; y: number; z: number }; // Euler angles in radians
}

/**
 * Complete pose definition for an animation state
 */
export interface AvatarPose {
  state: AvatarState;
  bones: BonePose[];
}

/**
 * Avatar scene state and controls
 */
export interface AvatarSceneControls {
  setMouthOpen: (openness01: number) => void;
  setViseme: (viseme: OculusViseme, intensity: number) => void;
  setState: (state: AvatarState) => void;
  loadAnimation: (url: string, state: AvatarState) => Promise<void>;
  dispose: () => void;
}

