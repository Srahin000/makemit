import { useCallback, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Scene } from './scene/Scene';
import type { CameraState } from './scene/CameraRig';
import { GestureController } from './gestures/GestureController';
import { makeGestureTargets } from './gestures/gestureTypes';
import { VoiceInput } from './voice/VoiceInput';

export type LifeState = 'IDLE' | 'LISTENING' | 'SPEAKING';

export interface VisemeKeyframe {
  time:      number;
  viseme:    string;
  intensity: number;
}

const API_BASE = '/api';

const STATE_COLORS: Record<LifeState, string> = {
  IDLE:      '#64748b',
  LISTENING: '#f59e0b',
  SPEAKING:  '#10b981',
};

const STATE_LABELS: Record<LifeState, string> = {
  IDLE:      '● Idle',
  LISTENING: '● Listening',
  SPEAKING:  '● Speaking',
};

export default function App() {
  const [lifeState, setLifeState]     = useState<LifeState>('IDLE');
  const [replyText, setReplyText]     = useState('');
  const [replyImage, setReplyImage]   = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);
  const [inputText, setInputText]     = useState('');
  const [targetRPM, setTargetRPM]     = useState(24);
  const [gestureEnabled, setGesture]  = useState(false);

  const [cameraState, setCameraState] = useState<CameraState>({
    radius:   3,
    thetaDeg: 90,
    phiDeg:   80,
    panX:     0,
    panY:     0,
  });

  const visemesRef      = useRef<VisemeKeyframe[]>([]);
  const audioTimeRef    = useRef(0);
  const audioPlayingRef = useRef(false);

  // Stable ref that GestureController writes to and CameraRig reads from.
  // Using a ref (not state) keeps gesture updates off the React render cycle.
  const gestureRef = useRef(makeGestureTargets());

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim();
    if (!text || loading) return;
    // If voice provided the text, mirror it in the input box so the user can see it
    if (overrideText) setInputText(overrideText);

    setLoading(true);
    setReplyText('');
    setReplyImage(null);
    setLifeState('LISTENING');

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err.detail || err.error || `Request failed: ${res.status}`;
        throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
      }

      const data = await res.json();
      const { reply, audioBase64, visemes, imageBase64, imageMime } = data;

      setReplyText(reply);
      if (imageBase64 && imageMime) {
        setReplyImage(`data:${imageMime};base64,${imageBase64}`);
      }
      visemesRef.current      = Array.isArray(visemes) ? visemes : [];
      setLifeState('SPEAKING');
      audioPlayingRef.current = true;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const binary       = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
      const buffer       = await audioContext.decodeAudioData(binary.buffer);

      const source       = audioContext.createBufferSource();
      source.buffer      = buffer;
      source.connect(audioContext.destination);

      const startTime = audioContext.currentTime;
      source.start(0);

      const updateTime = () => {
        if (!audioPlayingRef.current) return;
        audioTimeRef.current = audioContext.currentTime - startTime;
        if (audioTimeRef.current < buffer.duration) {
          requestAnimationFrame(updateTime);
        } else {
          audioPlayingRef.current = false;
          audioTimeRef.current    = 0;
          setLifeState('IDLE');
        }
      };
      source.onended = () => {
        audioPlayingRef.current = false;
        audioTimeRef.current    = 0;
        setLifeState('IDLE');
      };
      updateTime();
    } catch (err) {
      setReplyText(err instanceof Error ? err.message : 'Something went wrong.');
      setLifeState('IDLE');
    } finally {
      setLoading(false);
    }
  }, [inputText, loading, setInputText]);

  return (
    <>
      {/* ── State badge ──────────────────────────────────────────────────────── */}
      <div className="state-badge" style={{ color: STATE_COLORS[lifeState] }}>
        {STATE_LABELS[lifeState]}
      </div>

      {/* ── Gesture toggle button ─────────────────────────────────────────────── */}
      <button
        className={`gesture-toggle-btn ${gestureEnabled ? 'gesture-toggle-btn--active' : ''}`}
        onClick={() => setGesture((v) => !v)}
        title={gestureEnabled ? 'Disable gesture control' : 'Enable gesture control'}
      >
        {gestureEnabled ? '🖐 Gesture ON' : '🖐 Gesture OFF'}
      </button>

      {/* ── Reply panel ──────────────────────────────────────────────────────── */}
      <div className={`reply-text ${replyText ? '' : 'empty'}`}>
        {replyText || (loading ? 'Thinking...' : 'Ask your AI mentor anything.')}
        {replyImage && (
          <img
            src={replyImage}
            alt="Gemini response"
            style={{ display: 'block', maxWidth: '100%', marginTop: '0.5rem', borderRadius: 8 }}
          />
        )}
      </div>

      {/* ── Camera + spin controls ────────────────────────────────────────────── */}
      <div className="camera-controls">
        <div className="control-group">
          <label>Zoom</label>
          <input
            type="range" min={1} max={10} step={0.5}
            value={cameraState.radius}
            onChange={(e) => setCameraState((s) => ({ ...s, radius: Number(e.target.value) }))}
          />
          <span className="control-value">{cameraState.radius.toFixed(1)}</span>
        </div>
        <div className="control-group">
          <label>Rotate H</label>
          <input
            type="range" min={0} max={360}
            value={cameraState.thetaDeg}
            onChange={(e) => setCameraState((s) => ({ ...s, thetaDeg: Number(e.target.value) }))}
          />
          <span className="control-value">{cameraState.thetaDeg}°</span>
        </div>
        <div className="control-group">
          <label>Rotate V</label>
          <input
            type="range" min={10} max={170}
            value={cameraState.phiDeg}
            onChange={(e) => setCameraState((s) => ({ ...s, phiDeg: Number(e.target.value) }))}
          />
          <span className="control-value">{cameraState.phiDeg}°</span>
        </div>
        <div className="control-group">
          <label>Pan X</label>
          <input
            type="range" min={-2} max={2} step={0.1}
            value={cameraState.panX}
            onChange={(e) => setCameraState((s) => ({ ...s, panX: Number(e.target.value) }))}
          />
          <span className="control-value">{cameraState.panX.toFixed(1)}</span>
        </div>
        <div className="control-group">
          <label>Pan Y</label>
          <input
            type="range" min={-2} max={2} step={0.1}
            value={cameraState.panY}
            onChange={(e) => setCameraState((s) => ({ ...s, panY: Number(e.target.value) }))}
          />
          <span className="control-value">{cameraState.panY.toFixed(1)}</span>
        </div>
      </div>

      {/* ── RPM control ──────────────────────────────────────────────────────── */}
      <div className="rpm-control">
        <label>
          Spin&nbsp;<span className="rpm-value">{targetRPM} RPM</span>
        </label>
        <input
          type="range" min={0} max={3600} step={1}
          value={targetRPM}
          onChange={(e) => setTargetRPM(Number(e.target.value))}
        />
      </div>

      {/* ── 3D Canvas ────────────────────────────────────────────────────────── */}
      <Canvas
        camera={{ position: [0, 1.6, 3], fov: 50 }}
        gl={{ antialias: true }}
        style={{ width: '100%', height: '100vh' }}
      >
        <Scene
          lifeState={lifeState}
          targetRPM={targetRPM}
          cameraState={cameraState}
          gestureRef={gestureRef}
          visemesRef={visemesRef}
          audioTimeRef={audioTimeRef}
        />
      </Canvas>

      {/* ── Gesture controller (webcam + MediaPipe) ──────────────────────────── */}
      {gestureEnabled && (
        <GestureController
          gestureRef={gestureRef}
          enabled={gestureEnabled}
        />
      )}

      {/* ── Input bar ────────────────────────────────────────────────────────── */}
      <div className="input-area">
        <VoiceInput
          onTranscript={(text) => sendMessage(text)}
          disabled={loading}
        />
        <input
          type="text"
          placeholder="Type or hold 🎙️ to speak…"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          disabled={loading}
        />
        <button onClick={() => sendMessage()} disabled={loading}>
          {loading ? 'Sending...' : 'Send'}
        </button>
      </div>
    </>
  );
}
