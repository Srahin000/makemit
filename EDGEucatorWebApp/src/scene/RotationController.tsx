import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const TAU = 2 * Math.PI;
const SECONDS_PER_MINUTE = 60;

interface RotationControllerProps {
  targetRPM: number;
  children: React.ReactNode;
}

/**
 * Rotates the group around Y at targetRPM (revolutions per minute).
 * Formula: radians per second = targetRPM * TAU / 60; per frame = that * delta.
 */
export function RotationController({ targetRPM, children }: RotationControllerProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const radiansPerSecond = (targetRPM * TAU) / SECONDS_PER_MINUTE;
    group.rotation.y += radiansPerSecond * delta;
  });

  return <group ref={groupRef}>{children}</group>;
}
