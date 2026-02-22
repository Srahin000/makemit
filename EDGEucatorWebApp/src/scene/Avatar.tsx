import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import type { LifeState } from '../App';

const AVATAR_URL = '/avatar/690eb2ad132e61458c0d2adb.glb';

const ANIM_FILES: Partial<Record<LifeState, string>> = {
  IDLE:      '/animations/Happy Idle (1).fbx',
  SPEAKING:  '/animations/Talking (1).fbx',
};

// Mixamo → RPM plain bone names
const MIXAMO_TO_RPM: Record<string, string> = {
  mixamorigHips:          'Hips',
  mixamorigSpine:         'Spine',
  mixamorigSpine1:        'Spine1',
  mixamorigSpine2:        'Spine2',
  mixamorigNeck:          'Neck',
  mixamorigHead:          'Head',
  mixamorigLeftShoulder:  'LeftShoulder',
  mixamorigLeftArm:       'LeftArm',
  mixamorigLeftForeArm:   'LeftForeArm',
  mixamorigLeftHand:      'LeftHand',
  mixamorigRightShoulder: 'RightShoulder',
  mixamorigRightArm:      'RightArm',
  mixamorigRightForeArm:  'RightForeArm',
  mixamorigRightHand:     'RightHand',
  mixamorigLeftUpLeg:     'LeftUpLeg',
  mixamorigLeftLeg:       'LeftLeg',
  mixamorigLeftFoot:      'LeftFoot',
  mixamorigLeftToeBase:   'LeftToeBase',
  mixamorigRightUpLeg:    'RightUpLeg',
  mixamorigRightLeg:      'RightLeg',
  mixamorigRightFoot:     'RightFoot',
  mixamorigRightToeBase:  'RightToeBase',
};

/** Build a reverse map too (plain → mixamorig) for when avatar has mixamorig names */
const RPM_TO_MIXAMO: Record<string, string> = {};
for (const [k, v] of Object.entries(MIXAMO_TO_RPM)) RPM_TO_MIXAMO[v] = k;

/**
 * Remap FBX clip tracks to match the avatar skeleton.
 * Tries multiple strategies to find the right bone name.
 */
function remapClip(clip: THREE.AnimationClip, avatarBones: Set<string>): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  let matched = 0, skipped = 0;

  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot === -1) { skipped++; continue; }
    const fbxBone = track.name.slice(0, dot);
    const prop    = track.name.slice(dot + 1);
    if (prop !== 'quaternion') { skipped++; continue; }

    // Try multiple names to find a match in the avatar
    const candidates = [
      fbxBone,                        // exact (mixamorigHips)
      MIXAMO_TO_RPM[fbxBone],         // mixamorig → plain (Hips)
      RPM_TO_MIXAMO[fbxBone],         // plain → mixamorig (if FBX uses plain names)
    ].filter(Boolean) as string[];

    let found: string | null = null;
    for (const name of candidates) {
      if (avatarBones.has(name)) { found = name; break; }
    }

    if (!found) { skipped++; continue; }

    const t = track.clone();
    t.name  = `${found}.quaternion`;
    tracks.push(t);
    matched++;
  }

  console.log(`[Avatar] remapClip "${clip.name}": ${matched} matched, ${skipped} skipped`);
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// ── Oculus viseme types ───────────────────────────────────────────────────────
type OculusViseme =
  | 'sil'|'PP'|'FF'|'TH'|'DD'|'kk'|'CH'|'SS'|'nn'|'RR'
  | 'aa'|'E'|'ih'|'oh'|'ou';

interface AvatarProps {
  lifeState: LifeState;
  visemesRef: React.MutableRefObject<{ time: number; viseme: string; intensity: number }[]>;
  audioTimeRef: React.MutableRefObject<number>;
}

function getCurrentViseme(
  visemes: { time: number; viseme: string; intensity: number }[],
  t: number,
): { viseme: OculusViseme; intensity: number } {
  if (!visemes.length || t < 0) return { viseme: 'sil', intensity: 0 };
  if (t <= visemes[0].time)
    return { viseme: visemes[0].viseme as OculusViseme, intensity: visemes[0].intensity ?? 1 };
  for (let i = 0; i < visemes.length - 1; i++) {
    const a = visemes[i], b = visemes[i + 1];
    if (t >= a.time && t < b.time) {
      const x   = (b.time - a.time) > 0 ? (t - a.time) / (b.time - a.time) : 0;
      const int = (a.intensity ?? 1) + ((b.intensity ?? 1) - (a.intensity ?? 1)) * x;
      return { viseme: a.viseme as OculusViseme, intensity: Math.max(0, Math.min(1, int)) };
    }
  }
  const last = visemes[visemes.length - 1];
  return { viseme: last.viseme as OculusViseme, intensity: last.intensity ?? 1 };
}

// ── Component ─────────────────────────────────────────────────────────────────
export function Avatar({ lifeState, visemesRef, audioTimeRef }: AvatarProps) {
  const { scene } = useGLTF(AVATAR_URL);

  // Use SkeletonUtils.clone — the standard clone() breaks skinned mesh bone bindings
  const avatar = useMemo(() => {
    const c = skeletonClone(scene) as THREE.Group;
    console.log('[Avatar] SkeletonUtils.clone created');
    return c;
  }, [scene]);

  const mixerRef         = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef       = useRef<Partial<Record<LifeState, THREE.AnimationAction>>>({});
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const lifeStateRef     = useRef<LifeState>(lifeState);

  useEffect(() => { lifeStateRef.current = lifeState; }, [lifeState]);

  // ── Load FBX animations ──────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    // Collect all named objects (bones, meshes, etc.) that the mixer can bind to
    const avatarBones = new Set<string>();
    avatar.traverse((c) => {
      if (c.name) avatarBones.add(c.name);
    });
    console.log('[Avatar] Avatar nodes:', avatarBones.size, '| Sample bones:',
      [...avatarBones].filter(n => /hips|spine|arm|head|leg/i.test(n)).sort().join(', '));

    // Log first FBX track names for debugging
    const logFirstFbx = (label: string, fbx: THREE.Group) => {
      const clip = fbx.animations[0];
      if (!clip) return;
      const trackNames = clip.tracks.slice(0, 5).map(t => t.name);
      console.log(`[Avatar] ${label} FBX tracks sample:`, trackNames);
    };

    const mixer = new THREE.AnimationMixer(avatar);
    mixerRef.current         = mixer;
    actionsRef.current       = {};
    currentActionRef.current = null;

    const loader   = new FBXLoader();
    const entries  = Object.entries(ANIM_FILES) as [LifeState, string][];

    Promise.allSettled(
      entries.map(([state, path]) =>
        loader.loadAsync(path).then((fbx) => {
          if (!mounted) return;
          logFirstFbx(state, fbx);

          const clip = fbx.animations[0];
          if (!clip) { console.warn(`[Avatar] No animation clip in ${path}`); return; }

          const remapped = remapClip(clip, avatarBones);
          if (remapped.tracks.length === 0) {
            console.error(`[Avatar] ${state}: 0 tracks after remap — animation won't play!`);
            return;
          }

          const action = mixer.clipAction(remapped);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
          actionsRef.current[state] = action;
        }).catch((e) => console.warn(`[Avatar] Failed ${state}:`, e))
      )
    ).then(() => {
      if (!mounted) return;
      const loaded = Object.keys(actionsRef.current);
      console.log('[Avatar] FBX loading done. States:', loaded);

      const startAction = actionsRef.current[lifeStateRef.current] ?? actionsRef.current['IDLE'];
      if (startAction) {
        startAction.reset().play();
        currentActionRef.current = startAction;
        console.log('[Avatar] Playing initial animation');
      } else {
        console.error('[Avatar] No animation action available to play!');
      }
    });

    return () => {
      mounted = false;
      mixer.stopAllAction();
      mixer.uncacheRoot(avatar);
      if (mixerRef.current === mixer) mixerRef.current = null;
    };
  }, [avatar]);

  // ── Crossfade on lifeState change ─────────────────────────────────────────
  useEffect(() => {
    const next = actionsRef.current[lifeState] ?? actionsRef.current['IDLE'];
    const prev = currentActionRef.current;
    if (!next || next === prev) return;
    console.log('[Avatar] Crossfade →', lifeState);
    next.reset().fadeIn(0.4).play();
    prev?.fadeOut(0.4);
    currentActionRef.current = next;
  }, [lifeState]);

  // ── Lip-sync morph targets ───────────────────────────────────────────────
  const mouthOpenIdx = useRef<number | null>(null);
  const visemeToIdx  = useRef<Map<string, number>>(new Map());
  const headMeshRef  = useRef<THREE.Mesh | null>(null);
  const curMouth     = useRef(0);
  const tgtMouth     = useRef(0);
  const tgtViseme    = useRef<OculusViseme | null>(null);
  const tgtIntensity = useRef(0);

  useEffect(() => {
    const VISEMES: OculusViseme[] = ['sil','PP','FF','TH','DD','kk','CH','SS','nn','RR','aa','E','ih','oh','ou'];
    avatar.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mesh = child as THREE.Mesh & {
        morphTargetDictionary?: Record<string, number>;
        morphTargetInfluences?: number[];
      };
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
      if (headMeshRef.current && !/head|face|skull/i.test(mesh.name)) return;

      headMeshRef.current = mesh;
      const dict = mesh.morphTargetDictionary;

      mouthOpenIdx.current = null;
      for (const [n, idx] of Object.entries(dict))
        if (/mouth|jaw|open/i.test(n)) { mouthOpenIdx.current = idx; break; }
      if (mouthOpenIdx.current === null && Object.keys(dict).length)
        mouthOpenIdx.current = dict[Object.keys(dict)[0]];

      visemeToIdx.current = new Map();
      for (const v of VISEMES) {
        const vl = v.toLowerCase();
        for (const [n, idx] of Object.entries(dict)) {
          const nl = n.toLowerCase();
          if (nl === `viseme_${vl}` || nl === `viseme${vl}`) {
            visemeToIdx.current.set(v, idx); break;
          }
        }
      }
      console.log(`[Avatar] Head mesh "${mesh.name}", ${visemeToIdx.current.size} visemes`);
    });
  }, [avatar]);

  // ── Per-frame: tick mixer + lip-sync ─────────────────────────────────────
  useFrame((_, delta) => {
    mixerRef.current?.update(delta);

    const head = headMeshRef.current;
    if (!head?.morphTargetInfluences) return;

    const speaking = lifeState === 'SPEAKING' && visemesRef.current.length > 0;
    if (speaking) {
      const { viseme, intensity } = getCurrentViseme(visemesRef.current, audioTimeRef.current);
      tgtViseme.current    = viseme;
      tgtIntensity.current = intensity;
    } else {
      tgtViseme.current    = 'sil';
      tgtIntensity.current = 0;
      tgtMouth.current     = 0;
    }

    const lerp = 0.2;
    for (const [v, idx] of visemeToIdx.current) {
      if (idx >= head.morphTargetInfluences.length) continue;
      const tgt = v === tgtViseme.current ? tgtIntensity.current : 0;
      head.morphTargetInfluences[idx] += (tgt - head.morphTargetInfluences[idx]) * lerp;
    }

    const VOWELS: OculusViseme[] = ['aa','E','ih','oh','ou'];
    if (mouthOpenIdx.current !== null && tgtViseme.current && VOWELS.includes(tgtViseme.current))
      tgtMouth.current = tgtIntensity.current * 0.8;

    if (mouthOpenIdx.current !== null) {
      curMouth.current += (tgtMouth.current - curMouth.current) * 0.15;
      head.morphTargetInfluences[mouthOpenIdx.current] = curMouth.current;
    }
  });

  return <primitive object={avatar} />;
}

useGLTF.preload(AVATAR_URL);
