export type GestureMode =
  | 'PAN'       // ☝️  Pointing_Up  → index tip moves → pan X/Y
  | 'ZOOM_IN'   // 👍 Thumb_Up    → zoom in (decrease radius) while held
  | 'ZOOM_OUT'  // 👎 Thumb_Down  → zoom out (increase radius) while held
  | 'ROTATE_H'  // ✌️  Victory     → V-sign twist angle → horizontal rotation
  | 'ROTATE_V'  // 🖐️  Open_Palm   → vertical drag → vertical rotation
  | 'RESET'     // ✊  Closed_Fist → reset all to defaults
  | 'NONE';

export interface GestureTargets {
  radius:   number;   // camera distance [ZOOM_MIN, ZOOM_MAX]
  thetaDeg: number;   // horizontal orbit angle [0, 360]
  phiDeg:   number;   // vertical orbit angle [10, 170]
  panX:     number;   // horizontal pan [-2, 2]
  panY:     number;   // vertical pan [-2, 2]
  active:   boolean;  // true = gesture is controlling camera
  mode:     GestureMode;
}

/** Default/reset camera position */
export const GESTURE_DEFAULTS = {
  radius:   4.0,
  thetaDeg: 242,
  phiDeg:   79,
  panX:     0,
  panY:     0,
};

export function makeGestureTargets(): GestureTargets {
  return { ...GESTURE_DEFAULTS, active: false, mode: 'NONE' };
}
