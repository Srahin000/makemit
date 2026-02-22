import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { GestureTargets } from '../gestures/gestureTypes';
import { GESTURE_DEFAULTS } from '../gestures/gestureTypes';

export interface CameraState {
  radius:   number;
  thetaDeg: number;
  phiDeg:   number;
  panX:     number;
  panY:     number;
}

const TARGET_Y        = 1.6;
const LERP_SPEED      = 8;    // snappiness: higher = faster blend
const RESET_AFTER_S   = 10;   // seconds of no gesture before auto-reset
const RESET_LERP_SPEED = 2;   // slower lerp back to default so it feels graceful

export function CameraRig({
  state,
  gestureRef,
}: {
  state:       CameraState;
  gestureRef?: React.MutableRefObject<GestureTargets>;
}) {
  const { camera } = useThree();

  const cur          = useRef({ ...state });
  const lastGesture  = useRef<CameraState | null>(null);
  const lastActiveAt = useRef<number | null>(null); // timestamp (s) of last gesture frame
  const lookAt       = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const now = performance.now() / 1000;
    const g   = gestureRef?.current;

    // ── Decide target ────────────────────────────────────────────────────────
    let tgt: CameraState;
    let lerpSpeed = LERP_SPEED;

    if (g?.active) {
      // Hand is live — follow gesture, stamp timestamp, save position
      lastActiveAt.current = now;
      lastGesture.current  = {
        radius:   g.radius,
        thetaDeg: g.thetaDeg,
        phiDeg:   g.phiDeg,
        panX:     g.panX,
        panY:     g.panY,
      };
      tgt = g;

    } else if (
      lastGesture.current &&
      lastActiveAt.current !== null &&
      now - lastActiveAt.current >= RESET_AFTER_S
    ) {
      // 10 s of inactivity — smoothly glide back to defaults
      tgt        = GESTURE_DEFAULTS as CameraState;
      lerpSpeed  = RESET_LERP_SPEED;

      // Once we've effectively reached the defaults, clear the gesture memory
      // so sliders take over again (avoids re-triggering the reset every frame)
      const c = cur.current;
      const atDefault =
        Math.abs(c.radius   - GESTURE_DEFAULTS.radius)   < 0.01 &&
        Math.abs(c.phiDeg   - GESTURE_DEFAULTS.phiDeg)   < 0.1  &&
        Math.abs(c.panX     - GESTURE_DEFAULTS.panX)     < 0.01 &&
        Math.abs(c.panY     - GESTURE_DEFAULTS.panY)     < 0.01;

      if (atDefault) {
        lastGesture.current  = null;
        lastActiveAt.current = null;
        // Also sync gestureRef values so next gesture starts from default
        if (g) Object.assign(g, GESTURE_DEFAULTS);
      }

    } else if (lastGesture.current) {
      // Hand left frame but timeout not reached — hold last position
      tgt = lastGesture.current;

    } else {
      // No gesture ever used — sliders drive the camera
      tgt = state;
    }

    // ── Lerp current values toward target ───────────────────────────────────
    const t = 1 - Math.exp(-lerpSpeed * delta);
    const c = cur.current;

    c.radius += (tgt.radius - c.radius) * t;
    c.phiDeg += (tgt.phiDeg - c.phiDeg) * t;
    c.panX   += (tgt.panX   - c.panX)   * t;
    c.panY   += (tgt.panY   - c.panY)   * t;

    // Shortest-path lerp for theta
    let dTheta = tgt.thetaDeg - c.thetaDeg;
    if (dTheta >  180) dTheta -= 360;
    if (dTheta < -180) dTheta += 360;
    c.thetaDeg = ((c.thetaDeg + dTheta * t) % 360 + 360) % 360;

    // ── Spherical → Cartesian → camera ──────────────────────────────────────
    const theta = (c.thetaDeg * Math.PI) / 180;
    const phi   = (c.phiDeg   * Math.PI) / 180;

    lookAt.current.set(c.panX, TARGET_Y + c.panY, 0);
    camera.position.set(
      lookAt.current.x + c.radius * Math.sin(phi) * Math.cos(theta),
      lookAt.current.y + c.radius * Math.cos(phi),
      lookAt.current.z + c.radius * Math.sin(phi) * Math.sin(theta),
    );
    camera.lookAt(lookAt.current);
  });

  return null;
}
