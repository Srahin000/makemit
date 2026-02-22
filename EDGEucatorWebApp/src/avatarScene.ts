import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AvatarMesh, AvatarSceneControls, AvatarState, BonePose, OculusViseme } from './types';

const AVATAR_URL = '/avatar/690eb2ad132e61458c0d2adb.glb';

/**
 * Creates and manages the Three.js scene with the Ready Player Me avatar
 */
export class AvatarScene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls | null = null;
  private headMesh: AvatarMesh | null = null;
  private mouthOpenIndex: number | null = null;
  private currentMouthOpen: number = 0;
  private targetMouthOpen: number = 0;
  private visemeMorphTargets: Map<OculusViseme, number> = new Map();
  private targetViseme: OculusViseme | null = null;
  private targetVisemeIntensity: number = 0;
  private animationMixer: THREE.AnimationMixer | null = null;
  private clock: THREE.Clock;
  private container: HTMLElement;
  private avatar: THREE.Group | null = null;
  private bones: Map<string, THREE.Bone> = new Map();
  private boneInitialRotations: Map<string, THREE.Euler> = new Map();
  private currentState: AvatarState = 'idle';
  private targetState: AvatarState = 'idle';
  private stateTransitionProgress: number = 1.0;
  private idleTimer: number = 0;
  private readonly IDLE_TIMEOUT = 3.0;
  private isAudioPlaying: boolean = false;
  private animationActions: THREE.AnimationAction[] = [];
  private forceResetFrames: number = 10; // Force reset for first 10 frames
  private loadedAnimations: Map<AvatarState, THREE.AnimationClip> = new Map();
  private currentAnimationAction: THREE.AnimationAction | null = null;
  private previousAnimationAction: THREE.AnimationAction | null = null; // For crossfade cleanup

  constructor(container: HTMLElement) {
    this.container = container;
    this.clock = new THREE.Clock();

    // Create scene
    this.scene = new THREE.Scene();
    // Background will be set when image loads
    this.scene.background = new THREE.Color(0x0f172a);

    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 1.6, 3);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    // Add lights
    this.setupLights();

    // Load background image
    this.loadBackground();

    // Setup controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 1.6, 0);

    // Handle window resize
    window.addEventListener('resize', () => this.handleResize());

    // Start render loop
    this.animate();
  }

  private setupLights(): void {
    // Ambient light for overall illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    // Directional light (main light source)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = false;
    this.scene.add(directionalLight);

    // Additional fill light from the opposite side
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-5, 5, -5);
    this.scene.add(fillLight);
  }

  /**
   * Loads a Hogwarts background image and sets it as the scene background
   */
  private loadBackground(): void {
    const textureLoader = new THREE.TextureLoader();
    
    // Using the provided Hogwarts image
    const backgroundUrl = 'https://th.bing.com/th/id/R.20ba739779424a3957e6083bb91c6efd?rik=W6Nbcd0hZqOjhQ&riu=http%3a%2f%2fgetwallpapers.com%2fwallpaper%2ffull%2fb%2fa%2fd%2f17445.jpg&ehk=xjmrVgihKWOb2kSsEkDOUzN3iZjYDkmNcRw4d51p7pk%3d&risl=&pid=ImgRaw&r=0';
    
    textureLoader.load(
      backgroundUrl,
      (texture) => {
        // Set the texture as the scene background
        this.scene.background = texture;
        console.log('Background image loaded successfully');
      },
      undefined,
      (error) => {
        console.warn('Failed to load background image, using fallback color:', error);
        // Fallback to a nice dark blue color if image fails to load
        this.scene.background = new THREE.Color(0x0f172a);
      }
    );
  }

  /**
   * Loads the Ready Player Me avatar from the GLB URL
   */
  async loadAvatar(): Promise<void> {
    const loader = new GLTFLoader();

    try {
      const gltf = await loader.loadAsync(AVATAR_URL);
      
      // Add the avatar to the scene
      const avatar = gltf.scene;
      avatar.position.set(0, 0, 0);
      this.scene.add(avatar);

      // Find the head/face mesh with morph targets
      this.findHeadMesh(avatar);

      // Find and map skeleton bones
      this.findBones(avatar);
      
      // Store avatar reference
      this.avatar = avatar;

      // Setup animations if available
      if (gltf.animations && gltf.animations.length > 0) {
        this.animationMixer = new THREE.AnimationMixer(avatar);
        
        // Store any animations that came with the avatar
        for (const clip of gltf.animations) {
          const action = this.animationMixer.clipAction(clip);
          action.stop();
          action.enabled = false;
          this.animationActions.push(action);
        }
        
        console.log(`Loaded ${gltf.animations.length} animation(s) from avatar`);
      } else {
        // Create animation mixer even if no animations came with avatar
        // (we'll load Mixamo animations separately)
        this.animationMixer = new THREE.AnimationMixer(avatar);
      }

      // Reset bones again after animations are set up to ensure they're in neutral pose
      // This is important because animations might have affected bone rotations
      this.resetBonesToNeutralPose();

      console.log('Avatar loaded successfully');
    } catch (error) {
      console.error('Failed to load avatar:', error);
      throw error;
    }
  }

  /**
   * Traverses the avatar scene to find the head/face mesh with morph targets
   */
  private findHeadMesh(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mesh = child as AvatarMesh;
        
        // Check if this mesh has morph targets
        if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
          // Found mesh with morph targets (logging removed)

          // If we haven't found a head mesh yet, or if this one looks more like a head
          if (!this.headMesh || this.isLikelyHeadMesh(mesh)) {
            this.headMesh = mesh;
            this.detectMouthMorphTarget();
            this.detectAllVisemeMorphTargets();
          }
        }
      }
    });

    if (!this.headMesh) {
      console.warn('No mesh with morph targets found. Mouth animation may not work.');
    }
  }

  /**
   * Checks if a mesh is likely the head/face mesh based on its name
   */
  private isLikelyHeadMesh(mesh: AvatarMesh): boolean {
    const name = mesh.name.toLowerCase();
    return name.includes('head') || name.includes('face') || name.includes('skull');
  }

  /**
   * Finds and maps all bones in the avatar skeleton
   */
  private findBones(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.Bone) {
        this.bones.set(child.name, child);
        // Store the ACTUAL initial rotation from the model (before any reset)
        const initialRot = child.rotation.clone();
        this.boneInitialRotations.set(child.name, initialRot);
        
        // Store bone rotations (logging moved to logBoneStructure)
      }
    });
    
    // Log all bone names for debugging (especially to check leg bones)
    const allBoneNames = Array.from(this.bones.keys()).sort();
    const legBones = allBoneNames.filter(name => {
      const lower = name.toLowerCase();
      return lower.includes('leg') || lower.includes('foot') || lower.includes('toe') || lower.includes('hip');
    });
    if (legBones.length > 0) {
      console.log(`[Avatar] Found ${legBones.length} leg/hip bones: ${legBones.join(', ')}`);
    } else {
      console.log(`[Avatar] No leg bones found. Avatar may be half-body only. Total bones: ${allBoneNames.length}`);
    }
    
    // Reset bones to neutral pose after finding them
    this.resetBonesToNeutralPose();
  }

  /**
   * Resets bones to a neutral/rest pose (T-pose - original bind pose)
   * This ensures we start from a known good baseline
   * For Ready Player Me, we restore to the original bind pose rotations
   */
  private resetBonesToNeutralPose(): void {
    // Restore to original bind pose (T-pose)
    for (const [boneName, bone] of this.bones.entries()) {
      const initialRot = this.boneInitialRotations.get(boneName);
      if (initialRot) {
        // Restore to original bind pose
        bone.rotation.copy(initialRot);
      } else {
        // Fallback to zero if no initial rotation stored
        bone.rotation.set(0, 0, 0);
        this.boneInitialRotations.set(boneName, bone.rotation.clone());
      }
    }
    
    // Log detailed bone structure for analysis
    this.logBoneStructure();
  }

  /**
   * Logs detailed bone structure and angles for analysis
   */
  private logBoneStructure(): void {
    // Only log if we need to debug - check for arm/shoulder bones
    const armBones = ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
                      'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
                      'mixamorigLeftShoulder', 'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand',
                      'mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand'];
    
    const foundArmBones: string[] = [];
    for (const boneName of armBones) {
      if (this.bones.has(boneName)) {
        foundArmBones.push(boneName);
      }
    }
    
    if (foundArmBones.length > 0) {
      console.log(`[Avatar] Found ${foundArmBones.length} arm/shoulder bones (using: ${foundArmBones.slice(0, 4).join(', ')}...)`);
    } else {
      // Log all bone names to help identify naming convention
      const allBoneNames = Array.from(this.bones.keys());
      const armLikeBones = allBoneNames.filter(name => {
        const lower = name.toLowerCase();
        return lower.includes('arm') || lower.includes('shoulder');
      });
      console.log(`[Avatar] Bone naming: Found ${armLikeBones.length} arm-like bones:`, armLikeBones);
    }
  }

  /**
   * Defines pose configurations for each animation state
   * Uses common bone naming conventions (Ready Player Me typically uses Mixamo naming)
   */
  private getPoseForState(state: AvatarState): BonePose[] {
    const poses: { [key in AvatarState]: BonePose[] } = {
      idle: [
        // Revert to original bind pose (T-pose) - no offsets
        // This allows us to measure the actual bone structure
        { boneName: 'Spine', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'Spine1', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'Spine2', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'Neck', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'Head', rotation: { x: 0, y: 0, z: 0 } },
        // Left arm: use bind pose as-is (T-pose)
        { boneName: 'LeftShoulder', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'LeftArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'LeftForeArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'LeftHand', rotation: { x: 0, y: 0, z: 0 } },
        // Right arm: use bind pose as-is (T-pose)
        { boneName: 'RightShoulder', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'RightArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'RightForeArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'RightHand', rotation: { x: 0, y: 0, z: 0 } },
        // Also try mixamorig naming
        { boneName: 'mixamorigSpine', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigSpine1', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigSpine2', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigNeck', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigHead', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigLeftShoulder', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigLeftArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigLeftForeArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigLeftHand', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigRightShoulder', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigRightArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigRightForeArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigRightHand', rotation: { x: 0, y: 0, z: 0 } },
      ],
      
      listening: [
        // Lean forward, hand to ear, head tilt
        // All rotations are offsets from bind pose (T-pose)
        { boneName: 'Spine', rotation: { x: 0.15, y: 0, z: 0 } },
        { boneName: 'Spine1', rotation: { x: 0.1, y: 0, z: 0 } },
        { boneName: 'Spine2', rotation: { x: 0.05, y: 0, z: 0 } },
        { boneName: 'Neck', rotation: { x: 0.1, y: 0, z: 0 } },
        { boneName: 'Head', rotation: { x: 0, y: 0.2, z: -0.15 } },
        // Right hand to ear: from T-pose, adjust to ear position
        { boneName: 'RightShoulder', rotation: { x: -1.3, y: 0, z: -1.2 } },
        { boneName: 'RightArm', rotation: { x: -1.4, y: 0, z: 0.3 } },
        { boneName: 'RightForeArm', rotation: { x: -1.0, y: 0, z: 0 } },
        { boneName: 'RightHand', rotation: { x: -0.2, y: 0.15, z: 0 } },
        // Left arm: keep in T-pose (same as idle)
        { boneName: 'LeftShoulder', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'LeftArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'LeftForeArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'LeftHand', rotation: { x: 0, y: 0, z: 0 } },
        // mixamorig variants
        { boneName: 'mixamorigSpine', rotation: { x: 0.15, y: 0, z: 0 } },
        { boneName: 'mixamorigSpine1', rotation: { x: 0.1, y: 0, z: 0 } },
        { boneName: 'mixamorigSpine2', rotation: { x: 0.05, y: 0, z: 0 } },
        { boneName: 'mixamorigNeck', rotation: { x: 0.1, y: 0, z: 0 } },
        { boneName: 'mixamorigHead', rotation: { x: 0, y: 0.2, z: -0.15 } },
        { boneName: 'mixamorigRightShoulder', rotation: { x: 0.25, y: -0.2, z: 0.4 } },
        { boneName: 'mixamorigRightArm', rotation: { x: -0.4, y: 0, z: 0.2 } },
        { boneName: 'mixamorigRightForeArm', rotation: { x: -1.0, y: 0, z: 0 } },
        { boneName: 'mixamorigRightHand', rotation: { x: -0.2, y: 0.15, z: 0 } },
        { boneName: 'mixamorigLeftShoulder', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigLeftArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigLeftForeArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigLeftHand', rotation: { x: 0, y: 0, z: 0 } },
      ],
      
      talking: [
        // TEMPORARY: Set to zero offsets to match idle (T-pose) for debugging
        // This will help us see what the actual problem is
        { boneName: 'Spine', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'Spine1', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'Spine2', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'Neck', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'Head', rotation: { x: 0, y: 0, z: 0 } },
        // Right arm: TEMPORARY - zero offsets to debug
        { boneName: 'RightShoulder', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'RightArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'RightForeArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'RightHand', rotation: { x: 0, y: 0, z: 0 } },
        // Left arm: TEMPORARY - zero offsets to debug
        { boneName: 'LeftShoulder', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'LeftArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'LeftForeArm', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'LeftHand', rotation: { x: 0, y: 0, z: 0 } },
        // mixamorig variants
        { boneName: 'mixamorigSpine', rotation: { x: 0.05, y: 0, z: 0 } },
        { boneName: 'mixamorigSpine1', rotation: { x: 0.03, y: 0, z: 0 } },
        { boneName: 'mixamorigSpine2', rotation: { x: 0.02, y: 0, z: 0 } },
        { boneName: 'mixamorigNeck', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigHead', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigRightShoulder', rotation: { x: 0.15, y: -0.1, z: 0.2 } },
        { boneName: 'mixamorigRightArm', rotation: { x: -0.4, y: 0.1, z: 0.1 } },
        { boneName: 'mixamorigRightForeArm', rotation: { x: -0.6, y: 0, z: 0 } },
        { boneName: 'mixamorigRightHand', rotation: { x: 0, y: 0, z: 0 } },
        { boneName: 'mixamorigLeftShoulder', rotation: { x: 0.05, y: 0.05, z: -0.15 } },
        { boneName: 'mixamorigLeftArm', rotation: { x: -0.3, y: -0.05, z: -0.05 } },
        { boneName: 'mixamorigLeftForeArm', rotation: { x: -0.4, y: 0, z: 0 } },
        { boneName: 'mixamorigLeftHand', rotation: { x: 0, y: 0, z: 0 } },
      ],
    };
    
    return poses[state];
  }

  /**
   * Detects the mouth/jaw morph target from the morph target dictionary
   * 
   * This function searches for morph targets with names containing:
   * - "mouth"
   * - "jaw"
   * - "open"
   * 
   * If no match is found, it falls back to the first morph target.
   * 
   * To manually change which morph target is used, modify this function
   * or set mouthOpenIndex directly after loadAvatar() completes.
   */
  private detectMouthMorphTarget(): void {
    if (!this.headMesh || !this.headMesh.morphTargetDictionary) {
      return;
    }

    const dictionary = this.headMesh.morphTargetDictionary;
    const searchTerms = ['mouth', 'jaw', 'open'];

    // Search for a morph target matching our search terms
    for (const [name, index] of Object.entries(dictionary)) {
      const lowerName = name.toLowerCase();
      if (searchTerms.some(term => lowerName.includes(term))) {
        this.mouthOpenIndex = index;
        console.log(`Found mouth morph target: "${name}" at index ${index}`);
        return;
      }
    }

    // Fallback: use the first morph target
    const firstKey = Object.keys(dictionary)[0];
    if (firstKey !== undefined) {
      this.mouthOpenIndex = dictionary[firstKey];
      console.log(`Using fallback morph target: "${firstKey}" at index ${this.mouthOpenIndex}`);
    } else {
      console.warn('No morph targets available for mouth animation');
    }
  }

  /**
   * Detects all viseme-related morph targets from the avatar
   * 
   * Searches for morph targets matching Oculus viseme names and variations.
   * Handles different naming conventions (e.g., "viseme_aa", "mouthOpen", "Mouth_Open").
   */
  private detectAllVisemeMorphTargets(): void {
    if (!this.headMesh || !this.headMesh.morphTargetDictionary) {
      return;
    }

    const dictionary = this.headMesh.morphTargetDictionary;
    const visemeNames: OculusViseme[] = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'ih', 'oh', 'ou'];

    // Detecting viseme morph targets...

    // Clear existing mappings
    this.visemeMorphTargets.clear();

    // For each viseme, try to find a matching morph target
    for (const viseme of visemeNames) {
      const visemeLower = viseme.toLowerCase();
      
      // Try exact match first - be very specific to avoid false matches
      for (const [name, index] of Object.entries(dictionary)) {
        const nameLower = name.toLowerCase();
        
        // Exact viseme pattern matches only (no substring matching to avoid false positives)
        // Match patterns: "viseme_E", "visemeE", "viseme_e", "viseme_E", etc.
        const exactPattern1 = `viseme_${visemeLower}`;
        const exactPattern2 = `viseme${visemeLower}`;
        
        if (nameLower === exactPattern1 || nameLower === exactPattern2) {
          this.visemeMorphTargets.set(viseme, index);
          break;
        }
        
        // Handle specific case variations for single-letter visemes
        if (viseme === 'E' && (nameLower === 'viseme_e' || nameLower === 'visemee' || nameLower === 'viseme_e')) {
          this.visemeMorphTargets.set(viseme, index);
          break;
        }
        
        if (viseme === 'ih' && (nameLower === 'viseme_i' || nameLower === 'viseme_ih' || nameLower === 'visemeih')) {
          this.visemeMorphTargets.set(viseme, index);
          break;
        }
        
        if (viseme === 'oh' && (nameLower === 'viseme_o' || nameLower === 'viseme_oh' || nameLower === 'visemeoh')) {
          this.visemeMorphTargets.set(viseme, index);
          break;
        }
        
        if (viseme === 'ou' && (nameLower === 'viseme_u' || nameLower === 'viseme_ou' || nameLower === 'visemeou')) {
          this.visemeMorphTargets.set(viseme, index);
          break;
        }
      }
      
      // Individual viseme mapping logs removed for cleaner console
    }

    // Summary log only
    if (this.visemeMorphTargets.size >= 3) {
      console.log(`[Avatar] Viseme mapping: ${this.visemeMorphTargets.size}/${visemeNames.length} visemes detected`);
    } else {
      console.warn(`[Avatar] Only ${this.visemeMorphTargets.size} visemes detected - limited lip-sync capability`);
    }
  }

  /**
   * Sets the mouth openness (0 = closed, 1 = fully open)
   * Uses smooth interpolation for natural movement
   */
  setMouthOpen(openness01: number): void {
    this.targetMouthOpen = Math.max(0, Math.min(1, openness01));
  }

  /**
   * Sets the current viseme and intensity
   * Uses smooth interpolation for natural movement
   * 
   * @param viseme - The Oculus viseme to apply
   * @param intensity - Intensity of the viseme (0-1)
   */
  setViseme(viseme: OculusViseme, intensity: number): void {
    this.targetViseme = viseme;
    this.targetVisemeIntensity = Math.max(0, Math.min(1, intensity));
  }

  /**
   * Remaps animation clip bone names from mixamorig* to standard bone names
   * Ready Player Me avatars use standard names, but Mixamo animations use mixamorig* prefix
   */
  private remapAnimationBoneNames(clip: THREE.AnimationClip): THREE.AnimationClip {
    // Mapping from Mixamo bone names to Ready Player Me bone names
    // Ready Player Me avatars typically use standard Mixamo naming (without mixamorig prefix)
    const boneNameMap: { [key: string]: string } = {
      // Spine and head
      'mixamorigHips': 'Hips',
      'mixamorigSpine': 'Spine',
      'mixamorigSpine1': 'Spine1',
      'mixamorigSpine2': 'Spine2',
      'mixamorigNeck': 'Neck',
      'mixamorigHead': 'Head',
      // Left arm
      'mixamorigLeftShoulder': 'LeftShoulder',
      'mixamorigLeftArm': 'LeftArm',
      'mixamorigLeftForeArm': 'LeftForeArm',
      'mixamorigLeftHand': 'LeftHand',
      // Right arm
      'mixamorigRightShoulder': 'RightShoulder',
      'mixamorigRightArm': 'RightArm',
      'mixamorigRightForeArm': 'RightForeArm',
      'mixamorigRightHand': 'RightHand',
      // Left leg
      'mixamorigLeftUpLeg': 'LeftUpLeg',
      'mixamorigLeftLeg': 'LeftLeg',
      'mixamorigLeftFoot': 'LeftFoot',
      'mixamorigLeftToeBase': 'LeftToeBase',
      // Right leg
      'mixamorigRightUpLeg': 'RightUpLeg',
      'mixamorigRightLeg': 'RightLeg',
      'mixamorigRightFoot': 'RightFoot',
      'mixamorigRightToeBase': 'RightToeBase',
    };

    // Create new tracks with remapped bone names
    const remappedTracks: THREE.KeyframeTrack[] = [];
    let skippedTracks = 0;

    for (const track of clip.tracks) {
      // Extract bone name from track name (format: "boneName.property")
      const trackNameParts = track.name.split('.');
      if (trackNameParts.length < 2) {
        continue; // Skip invalid tracks
      }

      const originalBoneName = trackNameParts[0];
      const property = trackNameParts.slice(1).join('.'); // Handle nested properties

      // CRITICAL: Only allow rotation tracks - filter out position and scale
      // Position/scale tracks can move the avatar off-screen or cause other issues
      if (property !== 'quaternion' && property !== 'rotation[x]' && property !== 'rotation[y]' && property !== 'rotation[z]') {
        skippedTracks++;
        continue; // Skip position, scale, and other non-rotation tracks
      }

      // Check if we have a mapping for this bone
      const mappedBoneName = boneNameMap[originalBoneName];
      
      if (mappedBoneName) {
        // Check if the bone exists in our avatar
        if (this.bones.has(mappedBoneName)) {
          // Create new track with remapped name
          const newTrackName = `${mappedBoneName}.${property}`;
          const remappedTrack = track.clone();
          remappedTrack.name = newTrackName;
          remappedTracks.push(remappedTrack);
        } else {
          skippedTracks++;
        }
      } else {
        // Try direct match (bone might already be in correct format)
        if (this.bones.has(originalBoneName)) {
          remappedTracks.push(track.clone());
        } else {
          skippedTracks++;
        }
      }
    }

    // Create new clip with remapped tracks
    const remappedClip = new THREE.AnimationClip(
      clip.name,
      clip.duration,
      remappedTracks,
      clip.blendMode
    );

    // Log which bones were successfully remapped (for debugging)
    const remappedBones = new Set<string>();
    remappedTracks.forEach(track => {
      const boneName = track.name.split('.')[0];
      remappedBones.add(boneName);
    });

    if (skippedTracks > 0 || remappedBones.size > 0) {
      const boneList = Array.from(remappedBones).sort().join(', ');
      console.log(`[Avatar] Remapped ${remappedTracks.length} tracks (${remappedBones.size} bones: ${boneList}), skipped ${skippedTracks} tracks`);
    }

    return remappedClip;
  }

  /**
   * Loads a Mixamo animation from an FBX or GLB/GLTF file
   * @param url - URL or path to the animation file (FBX, GLB, or GLTF)
   * @param state - The state this animation should be associated with
   */
  async loadAnimation(url: string, state: AvatarState): Promise<void> {
    if (!this.avatar || !this.animationMixer) {
      throw new Error('Avatar must be loaded before loading animations');
    }

    try {
      // Determine file type from extension
      const urlLower = url.toLowerCase();
      let clip: THREE.AnimationClip | null = null;

      if (urlLower.endsWith('.fbx')) {
        // Load FBX file (Mixamo format)
        // Note: FBX support in Three.js can be limited. GLB/GLTF is recommended.
        try {
          const fbxLoader = new FBXLoader();
          const fbx = await fbxLoader.loadAsync(url);
          
          if (fbx.animations && fbx.animations.length > 0) {
            clip = fbx.animations[0];
          } else {
            // Sometimes FBX animations are in the scene itself
            fbx.traverse((child) => {
              if (child instanceof THREE.SkinnedMesh && child.animations) {
                if (child.animations.length > 0 && !clip) {
                  clip = child.animations[0];
                }
              }
            });
          }
        } catch (fbxError) {
          throw new Error(`FBX loading failed. Consider converting to GLB format. Original error: ${fbxError instanceof Error ? fbxError.message : 'Unknown error'}`);
        }
      } else if (urlLower.endsWith('.glb') || urlLower.endsWith('.gltf')) {
        // Load GLB/GLTF file
        const gltfLoader = new GLTFLoader();
        const gltf = await gltfLoader.loadAsync(url);
        
        if (gltf.animations && gltf.animations.length > 0) {
          clip = gltf.animations[0];
        }
      } else {
        throw new Error(`Unsupported file format. Use .fbx, .glb, or .gltf`);
      }

      if (clip) {
        // Remap bone names from mixamorig* to standard names
        const remappedClip = this.remapAnimationBoneNames(clip);
        this.loadedAnimations.set(state, remappedClip);
        console.log(`[Avatar] Loaded ${state} animation: ${clip.name} (${clip.duration.toFixed(2)}s, ${remappedClip.tracks.length} tracks)`);
      } else {
        console.warn(`[Avatar] No animations found in ${url}`);
      }
    } catch (error) {
      console.error(`[Avatar] Failed to load animation from ${url}:`, error);
      throw error;
    }
  }

  /**
   * Sets the avatar animation state
   */
  setState(state: AvatarState): void {
    if (this.currentState === state && this.stateTransitionProgress >= 1.0) {
      return; // Already in this state
    }
    
    // State transition (logging removed for cleaner console)
    this.targetState = state;
    this.stateTransitionProgress = 0.0;
    this.idleTimer = 0;
    
    // Update isAudioPlaying flag based on state
    if (state === 'talking' || state === 'listening') {
      this.isAudioPlaying = true; // Audio is active, keep talking/listening state
    } else if (state === 'idle') {
      this.isAudioPlaying = false; // No audio
    }

    // Play animation if available, otherwise use manual poses
    this.playAnimationForState(state);
  }

  /**
   * Plays the animation for the given state if available
   * Uses smooth crossfading for seamless transitions between animations
   */
  private playAnimationForState(state: AvatarState): void {
    if (!this.animationMixer) {
      return;
    }

    const clip = this.loadedAnimations.get(state);
    
    if (clip) {
      // Smooth crossfade between animations
      const fadeDuration = 0.5; // Half second fade for smooth blending
      
      // If there's a current animation, fade it out (but keep it playing for crossfade)
      if (this.currentAnimationAction && this.currentAnimationAction.isRunning()) {
        this.previousAnimationAction = this.currentAnimationAction;
        this.currentAnimationAction.fadeOut(fadeDuration);
        // Schedule cleanup of previous action after fade completes
        setTimeout(() => {
          if (this.previousAnimationAction && this.previousAnimationAction !== this.currentAnimationAction) {
            this.previousAnimationAction.stop();
            this.previousAnimationAction.enabled = false;
            this.previousAnimationAction = null;
          }
        }, fadeDuration * 1000);
      }

      // Create and play new animation with fade in
      const action = this.animationMixer.clipAction(clip);
      action.reset();
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.enabled = true;
      action.fadeIn(fadeDuration);
      action.play();
      this.currentAnimationAction = action;
    } else {
      // No animation loaded for this state, use manual poses
      // Fade out current animation smoothly
      if (this.currentAnimationAction) {
        this.currentAnimationAction.fadeOut(0.5);
        // Stop after fade completes
        setTimeout(() => {
          if (this.currentAnimationAction) {
            this.currentAnimationAction.stop();
            this.currentAnimationAction = null;
          }
        }, 500);
      }
    }
  }

  /**
   * Updates viseme morph targets with smooth blending
   * Fades out previous visemes and fades in the target viseme
   */
  private updateVisemeMorph(): void {
    if (!this.headMesh || !this.headMesh.morphTargetInfluences || !this.targetViseme) {
      return;
    }

    // Smooth transition speed (higher = faster, lower = smoother)
    // Using a moderate speed for natural-looking transitions
    const transitionSpeed = 0.2;

    // Fade out all visemes that are not the target
    for (const [viseme, index] of this.visemeMorphTargets.entries()) {
      if (index < this.headMesh.morphTargetInfluences.length) {
        if (viseme !== this.targetViseme) {
          // Smoothly fade out non-target visemes
          const current = this.headMesh.morphTargetInfluences[index];
          this.headMesh.morphTargetInfluences[index] = current * (1 - transitionSpeed);
        } else {
          // Smoothly fade in target viseme
          const current = this.headMesh.morphTargetInfluences[index];
          const target = this.targetVisemeIntensity;
          this.headMesh.morphTargetInfluences[index] = current + (target - current) * transitionSpeed;
        }
      }
    }

    // Fallback: if target viseme not found, try to use mouthOpenIndex for open visemes
    const morphIndex = this.visemeMorphTargets.get(this.targetViseme);
    if (morphIndex === undefined) {
      if (this.mouthOpenIndex !== null && 
          (this.targetViseme === 'aa' || this.targetViseme === 'E' || 
           this.targetViseme === 'ih' || this.targetViseme === 'oh' || 
           this.targetViseme === 'ou')) {
        if (this.mouthOpenIndex < this.headMesh.morphTargetInfluences.length) {
          const current = this.headMesh.morphTargetInfluences[this.mouthOpenIndex];
          const target = this.targetVisemeIntensity * 0.7; // Slightly reduced for fallback
          this.headMesh.morphTargetInfluences[this.mouthOpenIndex] = current + (target - current) * transitionSpeed;
        }
      }
    }
  }

  /**
   * Updates the mouth morph target based on current interpolation
   */
  private updateMouthMorph(): void {
    if (!this.headMesh || this.mouthOpenIndex === null) {
      return;
    }

    // Smooth interpolation (lerp) toward target
    const lerpSpeed = 0.15;
    this.currentMouthOpen += (this.targetMouthOpen - this.currentMouthOpen) * lerpSpeed;

    // Apply to morph target
    if (this.headMesh.morphTargetInfluences) {
      this.headMesh.morphTargetInfluences[this.mouthOpenIndex] = this.currentMouthOpen;
    }
  }

  /**
   * Updates bone rotations to match current pose with smooth interpolation
   */
  private updateBodyPose(): void {
    if (this.bones.size === 0) {
      return; // No bones found
    }

    // If an animation is playing, don't apply manual poses
    if (this.currentAnimationAction && this.currentAnimationAction.isRunning()) {
      return;
    }

    // Force reset all arm bones to bind pose for first few frames to ensure they stay neutral
    // Skip pose updates during force reset to prevent any interference
    if (this.forceResetFrames > 0) {
      for (const [boneName, bone] of this.bones.entries()) {
        // Reset ALL arm/shoulder/hand bones to their bind pose
        const lowerName = boneName.toLowerCase();
        if (lowerName.includes('arm') || lowerName.includes('shoulder') || 
            (lowerName.includes('hand') && !lowerName.includes('thumb') && 
             !lowerName.includes('index') && !lowerName.includes('middle') && 
             !lowerName.includes('ring') && !lowerName.includes('pinky'))) {
          const initialRot = this.boneInitialRotations.get(boneName);
          if (initialRot) {
            bone.rotation.copy(initialRot);
          } else {
            bone.rotation.set(0, 0, 0);
          }
        }
      }
      this.forceResetFrames--;
      // Force reset complete (logging removed)
      // Skip the rest of pose update during force reset
      return;
    }

    const transitionSpeed = 0.08; // Smooth transition speed
    
    // Update transition progress
    if (this.stateTransitionProgress < 1.0) {
      this.stateTransitionProgress = Math.min(1.0, this.stateTransitionProgress + transitionSpeed);
    } else if (this.currentState !== this.targetState) {
      // Transition complete
      this.currentState = this.targetState;
    }

    // Get source and target poses
    const sourcePose = this.getPoseForState(this.currentState);
    const targetPose = this.getPoseForState(this.targetState);
    
    // Create a map for quick lookup
    const sourcePoseMap = new Map(sourcePose.map(p => [p.boneName, p]));

    // Apply interpolated rotations to all bones in target pose
    for (const targetBonePose of targetPose) {
      const bone = this.bones.get(targetBonePose.boneName);
      if (!bone) {
        continue; // Bone not found, skip
      }

      const sourceBonePose = sourcePoseMap.get(targetBonePose.boneName);
      const initialRotation = this.boneInitialRotations.get(targetBonePose.boneName);
      
      if (!initialRotation) {
        continue;
      }

      // Calculate target rotation (relative to bind pose)
      // Pose definitions are offsets from bind pose, so add them to initial rotation
      const targetRot = new THREE.Euler(
        initialRotation.x + targetBonePose.rotation.x,
        initialRotation.y + targetBonePose.rotation.y,
        initialRotation.z + targetBonePose.rotation.z
      );

      // Calculate source rotation (current state or bind pose)
      let sourceRot: THREE.Euler;
      if (sourceBonePose && this.stateTransitionProgress < 1.0) {
        // Source is also relative to bind pose
        sourceRot = new THREE.Euler(
          initialRotation.x + sourceBonePose.rotation.x,
          initialRotation.y + sourceBonePose.rotation.y,
          initialRotation.z + sourceBonePose.rotation.z
        );
      } else {
        // No source pose, use bind pose directly
        sourceRot = initialRotation.clone();
      }

      // Interpolate between source and target
      const t = this.stateTransitionProgress;
      bone.rotation.x = THREE.MathUtils.lerp(sourceRot.x, targetRot.x, t);
      bone.rotation.y = THREE.MathUtils.lerp(sourceRot.y, targetRot.y, t);
      bone.rotation.z = THREE.MathUtils.lerp(sourceRot.z, targetRot.z, t);
      
      // Debug logging removed - was too verbose. Enable only when needed for debugging.
    }

    // Handle idle breathing animation (subtle spine movement)
    if (this.currentState === 'idle' && this.stateTransitionProgress >= 1.0) {
      const time = this.clock.getElapsedTime();
      const breathingAmount = Math.sin(time * 0.8) * 0.02; // Subtle breathing
      
      const spineBone = this.bones.get('Spine2');
      if (spineBone) {
        const initialRot = this.boneInitialRotations.get('Spine2');
        if (initialRot) {
          spineBone.rotation.x = initialRot.x + breathingAmount;
        }
      }
    }
  }

  /**
   * Updates idle timer and auto-transitions to idle state
   */
  private updateIdleTimer(delta: number): void {
    // Check isAudioPlaying flag: if true, reset timer and return early (audio is active, stay in talking/listening)
    if (this.isAudioPlaying) {
      this.idleTimer = 0;
      return;
    }

    // If isAudioPlaying === false, increment idleTimer
    this.idleTimer += delta;
    
    // Auto-transition to idle after timeout
    if (this.idleTimer >= this.IDLE_TIMEOUT && this.currentState !== 'idle') {
      this.setState('idle');
    }
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();

    // Update animation mixer if present
    if (this.animationMixer) {
      // Update animation mixer with delta time
      this.animationMixer.update(delta);
      
      // If we're using manual poses (no animation playing), ensure animations don't interfere
      if (!this.currentAnimationAction || !this.currentAnimationAction.isRunning()) {
        // Make sure old actions are stopped
        for (const action of this.animationActions) {
          if (action.isRunning()) {
            action.stop();
            action.enabled = false;
          }
        }
      }
    }

    // Update controls
    if (this.controls) {
      this.controls.update();
    }

    // Update mouth morph
    this.updateMouthMorph();

    // Update viseme morph with smooth blending
    this.updateVisemeMorph();

    // Update body pose animations
    this.updateBodyPose();
    
    // Update idle timer
    this.updateIdleTimer(delta);

    // Render
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Returns controls for external interaction with the avatar
   */
  getControls(): AvatarSceneControls {
    return {
      setMouthOpen: (openness01: number) => this.setMouthOpen(openness01),
      setViseme: (viseme: OculusViseme, intensity: number) => this.setViseme(viseme, intensity),
      setState: (state: AvatarState) => this.setState(state),
      loadAnimation: (url: string, state: AvatarState) => this.loadAnimation(url, state),
      dispose: () => this.dispose()
    };
  }

  /**
   * Cleans up resources
   */
  dispose(): void {
    window.removeEventListener('resize', () => this.handleResize());
    this.renderer.dispose();
    if (this.controls) {
      this.controls.dispose();
    }
  }
}

