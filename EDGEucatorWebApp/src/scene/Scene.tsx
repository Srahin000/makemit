import { Suspense } from 'react';
import { RotationController } from './RotationController';
import { Avatar } from './Avatar';
import { CameraRig, type CameraState } from './CameraRig';
import type { LifeState } from '../App';
import type { GestureTargets } from '../gestures/gestureTypes';

interface SceneProps {
  lifeState:    LifeState;
  targetRPM:    number;
  cameraState:  CameraState;
  gestureRef:   React.MutableRefObject<GestureTargets>;
  visemesRef:   React.MutableRefObject<{ time: number; viseme: string; intensity: number }[]>;
  audioTimeRef: React.MutableRefObject<number>;
}

export function Scene({ lifeState, targetRPM, cameraState, gestureRef, visemesRef, audioTimeRef }: SceneProps) {
  return (
    <>
      <CameraRig state={cameraState} gestureRef={gestureRef} />
      <color attach="background" args={['#0f172a']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} />
      <directionalLight position={[-5, 5, -5]} intensity={0.3} />
      <Suspense fallback={
        <mesh position={[0, 1.6, 0]}>
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshStandardMaterial color="#3b82f6" wireframe />
        </mesh>
      }>
        <RotationController targetRPM={targetRPM}>
          <Avatar
            lifeState={lifeState}
            visemesRef={visemesRef}
            audioTimeRef={audioTimeRef}
          />
        </RotationController>
      </Suspense>
    </>
  );
}
