/**
 * ModelViewer.tsx
 * ---------------
 * Renders a static GLB file (no animations, no morph-target logic).
 * Used for ML_JARS and CAD_VIEWER modes.
 */
import { useEffect, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ModelViewerProps {
  url:        string;
  /** Auto-fit scale so the model fills roughly the same screen space as the avatar */
  autoScale?: boolean;
  /** Y-axis offset to vertically centre the model */
  centerY?:   boolean;
}

// Re-use a shared Box3 / Vector3 to avoid per-frame allocations
const _box    = new THREE.Box3();
const _center = new THREE.Vector3();
const _size   = new THREE.Vector3();

export function ModelViewer({ url, autoScale = true, centerY = true }: ModelViewerProps) {
  const { scene } = useGLTF(url);
  const groupRef  = useRef<THREE.Group>(null!);
  const ready     = useRef(false);

  useEffect(() => {
    ready.current = false;   // recalculate whenever URL changes
  }, [url]);

  useFrame(() => {
    if (ready.current || !groupRef.current) return;

    // Compute bounding box of the loaded scene
    _box.setFromObject(groupRef.current);
    _box.getCenter(_center);
    _box.getSize(_size);

    const maxDim = Math.max(_size.x, _size.y, _size.z);
    if (maxDim === 0) return;

    // Scale so the longest axis fits inside ~2 units
    const targetSize = 2.0;
    const scale      = autoScale ? targetSize / maxDim : 1;
    groupRef.current.scale.setScalar(scale);

    // Re-centre after scaling
    if (centerY) {
      _box.setFromObject(groupRef.current);
      _box.getCenter(_center);
      groupRef.current.position.set(-_center.x, -_center.y + 1.0, -_center.z);
    }

    ready.current = true;
  });

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}

// Pre-warm the cache for all three models so switching feels instant
useGLTF.preload('/avatar/mljar.glb');
useGLTF.preload('/avatar/cad_file.glb');
useGLTF.preload('/avatar/690eb2ad132e61458c0d2adb.glb');
