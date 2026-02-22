import { Suspense } from 'react';
import { RotationController } from './RotationController';
import { Avatar } from './Avatar';
import { ModelViewer } from './ModelViewer';
import { CameraRig, type CameraState } from './CameraRig';
import type { LifeState, AppMode } from '../App';
import type { GestureTargets } from '../gestures/gestureTypes';

// Which GLB each mode shows
const MODE_MODELS: Record<AppMode, string> = {
  ML_JARS:      '/avatar/mljar.glb',
  CAD_VIEWER:   '/avatar/cad_file.glb',
  AI_ASSISTANT: '/avatar/690eb2ad132e61458c0d2adb.glb',
};

interface SceneProps {
  appMode:      AppMode;
  lifeState:    LifeState;
  targetRPM:    number;
  cameraState:  CameraState;
  gestureRef:   React.MutableRefObject<GestureTargets>;
  visemesRef:   React.MutableRefObject<{ time: number; viseme: string; intensity: number }[]>;
  audioTimeRef: React.MutableRefObject<number>;
}

export function Scene({
  appMode,
  lifeState,
  targetRPM,
  cameraState,
  gestureRef,
  visemesRef,
  audioTimeRef,
}: SceneProps) {
  return (
    <>
      <CameraRig state={cameraState} gestureRef={gestureRef} />
      <color attach="background" args={['#0f172a']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]}  intensity={0.8} />
      <directionalLight position={[-5, 5, -5]} intensity={0.3} />

      <Suspense fallback={
        <mesh position={[0, 1.0, 0]}>
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshStandardMaterial color="#3b82f6" wireframe />
        </mesh>
      }>
        <RotationController targetRPM={targetRPM}>
          {appMode === 'AI_ASSISTANT' ? (
            // Full avatar with animations + lip-sync
            <Avatar
              lifeState={lifeState}
              visemesRef={visemesRef}
              audioTimeRef={audioTimeRef}
            />
          ) : (
            // Static GLB viewer for ML_JARS and CAD_VIEWER
            <ModelViewer
              key={appMode}               // remount when mode changes so autoScale reruns
              url={MODE_MODELS[appMode]}
              autoScale
              centerY
            />
          )}
        </RotationController>
      </Suspense>
    </>
  );
}
