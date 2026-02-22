import { AvatarScene } from './avatarScene';
import { playAudioWithMouthMovement } from './audioLipSync';
import { extractVisemesFromAudioUrlWithRhubarb } from './audioVisemeExtractor';
import { playVisemeTimeline } from './visemePlayer';

/**
 * Main application entry point
 * 
 * Initializes the Three.js scene, loads the avatar, and wires up
 * the audio playback buttons to drive mouth movement.
 */

// Initialize the avatar scene
const container = document.getElementById('avatar-container');
if (!container) {
  throw new Error('Avatar container not found');
}

const avatarScene = new AvatarScene(container);
const avatarControls = avatarScene.getControls();

// Track current state for UI (unused but kept for potential future use)
// let currentState: 'idle' | 'talking' | 'listening' = 'idle';

// Load the avatar and animations
avatarScene.loadAvatar().then(async () => {
  try {
    // Load Mixamo animations for each state
    // NOTE: GLB/GLTF format is recommended over FBX for better compatibility
    // If you have FBX files, convert them to GLB using:
    // - Blender (File > Import > FBX, then File > Export > glTF 2.0)
    // - Online converter: https://products.aspose.app/3d/conversion/fbx-to-gltf
    // - Or use Mixamo's GLB export if available
    
    // Animation file mappings:
    // - idle: Happy Idle (1).fbx
    // - talking: Talking (1).fbx
    // - listening: Talking On Phone (1).fbx
    const animationPaths = {
      idle: [
        '/animations/idle.glb',
        '/animations/idle.fbx',
        '/animations/Happy Idle (1).fbx' // Idle animation
      ],
      talking: [
        '/animations/talking.glb',
        '/animations/talking.fbx',
        '/animations/Talking (1).fbx' // Talking animation
      ],
      listening: [
        '/animations/listening.glb',
        '/animations/listening.fbx',
        '/animations/Talking On Phone (1).fbx' // Listening animation
      ]
    };

    for (const [state, paths] of Object.entries(animationPaths)) {
      let loaded = false;
      for (const path of paths) {
        try {
          await avatarControls.loadAnimation(path, state as 'idle' | 'talking' | 'listening');
          console.log(`[Avatar] Loaded ${state} animation from ${path}`);
          loaded = true;
          break;
        } catch (error) {
          // Try next format
          continue;
        }
      }
      if (!loaded) {
        console.warn(`[Avatar] Could not load ${state} animation. Will use manual poses.`);
      }
    }
    
    console.log('[Avatar] Animation loading complete');
  } catch (error) {
    console.warn('[Avatar] Animation loading failed. Using manual poses as fallback:', error);
    // Continue anyway - manual poses will be used as fallback
  }
}).catch((error) => {
  console.error('Failed to initialize avatar:', error);
  alert('Failed to load avatar. Please check the console for details.');
});

// Setup volume-based audio playback button
const playButton = document.getElementById('play-audio') as HTMLButtonElement;
if (!playButton) {
  throw new Error('Play audio button not found');
}

playButton.addEventListener('click', async () => {
  // Disable button during playback
  playButton.disabled = true;
  playButton.textContent = 'Playing...';
  
  // Set avatar to talking state
  avatarControls.setState('talking');

  try {
    // Play audio and drive mouth movement using volume analysis
    // 
    // FUTURE: Replace '/audio/audio.wav' with a dynamic URL from your Python TTS backend
    // Example:
    // const response = await fetch('http://localhost:8000/tts', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ text: userInputText })
    // });
    // const { audioUrl } = await response.json();
    // await playAudioWithMouthMovement(audioUrl, avatarControls.setMouthOpen);
    
    await playAudioWithMouthMovement(
      '/audio/audio.wav',
      avatarControls.setMouthOpen
    );
    
    // Audio finished - switch back to idle
    avatarControls.setState('idle');
    updateStateButtons('idle');
  } catch (error) {
    console.error('Error playing audio:', error);
    alert('Failed to play audio. Please check the console for details.');
    // On error, also switch back to idle
    avatarControls.setState('idle');
    updateStateButtons('idle');
  } finally {
    // Re-enable button
    playButton.disabled = false;
    playButton.textContent = 'Play Sample Audio (Volume-based)';
  }
});

// Setup viseme-based audio playback button
const analyzeButton = document.getElementById('analyze-visemes') as HTMLButtonElement;
if (!analyzeButton) {
  throw new Error('Analyze visemes button not found');
}

analyzeButton.addEventListener('click', async () => {
  // Disable button during analysis and playback
  analyzeButton.disabled = true;
  analyzeButton.textContent = 'Loading Rhubarb data...';
  
  // Set avatar to talking state
  avatarControls.setState('talking');

  try {
    const audioUrl = '/audio/audio.wav';
    
    // Step 1: Extract visemes (tries Rhubarb JSON first, falls back to browser analysis)
    const timeline = await extractVisemesFromAudioUrlWithRhubarb(audioUrl);
    
    // Log summary only
    console.log(`[Audio] Extracted ${timeline.visemes.length} viseme keyframes`);
    
    // Step 2: Play audio with viseme animation
    analyzeButton.textContent = 'Playing with visemes...';
    
    await playVisemeTimeline(
      audioUrl,
      timeline,
      (viseme, intensity) => {
        avatarControls.setViseme(viseme, intensity);
      }
    );
    
    // Audio finished - switch back to idle
    avatarControls.setState('idle');
    updateStateButtons('idle');
  } catch (error) {
    console.error('Error analyzing/playing audio with visemes:', error);
    alert('Failed to analyze or play audio with visemes. Please check the console for details.');
    // On error, also switch back to idle
    avatarControls.setState('idle');
    updateStateButtons('idle');
  } finally {
    // Re-enable button
    analyzeButton.disabled = false;
    analyzeButton.textContent = 'Analyze & Play with Visemes';
  }
});

// Setup state toggle buttons
const stateButtons = {
  idle: document.getElementById('state-idle'),
  talking: document.getElementById('state-talking'),
  listening: document.getElementById('state-listening')
};

// Update button active states
function updateStateButtons(activeState: 'idle' | 'talking' | 'listening') {
  Object.entries(stateButtons).forEach(([state, button]) => {
    if (button) {
      if (state === activeState) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    }
  });
}

// Wire up state buttons
stateButtons.idle?.addEventListener('click', () => {
  avatarControls.setState('idle');
  updateStateButtons('idle');
});

stateButtons.talking?.addEventListener('click', () => {
  avatarControls.setState('talking');
  updateStateButtons('talking');
});

stateButtons.listening?.addEventListener('click', () => {
  avatarControls.setState('listening');
  updateStateButtons('listening');
});

// Initialize UI
updateStateButtons('idle');

console.log('AI Mentor Avatar initialized');

