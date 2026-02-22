import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Scene } from './scene/Scene';
import type { CameraState } from './scene/CameraRig';
import { GestureController } from './gestures/GestureController';
import { makeGestureTargets } from './gestures/gestureTypes';
import { VoiceInput } from './voice/VoiceInput';

export type LifeState = 'IDLE' | 'LISTENING' | 'SPEAKING';
export type AppMode   = 'ML_JARS' | 'CAD_VIEWER' | 'AI_ASSISTANT';

export interface VisemeKeyframe {
  time:      number;
  viseme:    string;
  intensity: number;
}

const API_BASE = '/api';
const WS_URL   = 'ws://localhost:3001/ws';

// ── Mode metadata ─────────────────────────────────────────────────────────────
const MODE_LABELS: Record<AppMode, string> = {
  ML_JARS:      '🫙 ML Jars',
  CAD_VIEWER:   '📐 CAD Viewer',
  AI_ASSISTANT: '🧙 AI Assistant',
};

const MODE_DESCRIPTIONS: Record<AppMode, string> = {
  ML_JARS:      'Logo / 3D jar viewer — no voice, no gesture.',
  CAD_VIEWER:   'CAD model viewer — gesture control enabled.',
  AI_ASSISTANT: 'Harry Potter AI avatar — voice + wake word active.',
};

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

// ── Component ─────────────────────────────────────────────────────────────────
export default function App() {
  const [lifeState,   setLifeState]   = useState<LifeState>('IDLE');
  const [appMode,     setAppMode]     = useState<AppMode>('ML_JARS');
  const [wakeWord,    setWakeWord]    = useState(false);   // "Harry Potter" heard
  const [replyText,   setReplyText]   = useState('');
  const [replyImage,  setReplyImage]  = useState<string | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [inputText,   setInputText]   = useState('');
  const [targetRPM,   setTargetRPM]   = useState(24);
  const [gestureEnabled, setGesture]  = useState(false);

  const [cameraState, setCameraState] = useState<CameraState>({
    radius: 3, thetaDeg: 90, phiDeg: 80, panX: 0, panY: 0,
  });

  const visemesRef      = useRef<VisemeKeyframe[]>([]);
  const audioTimeRef    = useRef(0);
  const audioPlayingRef = useRef(false);
  const gestureRef      = useRef(makeGestureTargets());

  // ── Backend WebSocket (mode changes + wake word events) ───────────────────
  useEffect(() => {
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => console.log('[App] WS connected to backend');

      ws.onmessage = ({ data }) => {
        try {
          const msg = JSON.parse(data);

          if (msg.event === 'wake_word') {
            setWakeWord(true);
            console.log('[App] 🧙 Wake word detected!');
          }

          if (msg.event === 'mode_change' || msg.mode) {
            const newMode = (msg.mode as AppMode) ?? appMode;
            setAppMode(newMode);
            // Gesture auto-enable on modes that use it
            setGesture(newMode === 'CAD_VIEWER' || newMode === 'AI_ASSISTANT');
            console.log('[App] Mode →', newMode);
          }
        } catch {/* ignore non-JSON */ }
      };

      ws.onclose = () => {
        retryTimer = setTimeout(connect, 3000);  // auto-reconnect
      };
    }

    connect();
    return () => {
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mode switch ───────────────────────────────────────────────────────────
  const switchMode = useCallback(async (mode: AppMode) => {
    try {
      const res = await fetch(`${API_BASE}/set-mode`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mode }),
      });
      if (res.ok) {
        setAppMode(mode);
        setGesture(mode === 'CAD_VIEWER' || mode === 'AI_ASSISTANT');
      }
    } catch (e) {
      console.error('[App] switchMode failed:', e);
    }
  }, []);

  // ── Acknowledge wake word (clear banner + tell server) ────────────────────
  const acknowledgeWakeWord = useCallback(async () => {
    setWakeWord(false);
    await fetch(`${API_BASE}/acknowledge-wake`, { method: 'POST' }).catch(() => {});
  }, []);

  // ── Send message (text or voice) ──────────────────────────────────────────
  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim();
    if (!text || loading) return;
    if (overrideText) setInputText(overrideText);

    // Dismiss the wake-word banner if it's still showing
    if (wakeWord) acknowledgeWakeWord();

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

      if (!audioBase64) { setLifeState('IDLE'); return; }

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
  }, [inputText, loading, wakeWord, acknowledgeWakeWord]);

  const isAssistant = appMode === 'AI_ASSISTANT';

  return (
    <>
      {/* ── State badge ────────────────────────────────────────────────────── */}
      <div className="state-badge" style={{ color: STATE_COLORS[lifeState] }}>
        {STATE_LABELS[lifeState]}
      </div>

      {/* ── Mode selector ──────────────────────────────────────────────────── */}
      <div className="mode-selector">
        {(Object.keys(MODE_LABELS) as AppMode[]).map((m) => (
          <button
            key={m}
            className={`mode-btn ${appMode === m ? 'mode-btn--active' : ''}`}
            onClick={() => switchMode(m)}
            title={MODE_DESCRIPTIONS[m]}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* ── Wake-word banner ────────────────────────────────────────────────── */}
      {wakeWord && (
        <div className="wake-banner" onClick={acknowledgeWakeWord}>
          🧙 <strong>Harry Potter</strong> heard — speak your question!
          <span className="wake-banner__dismiss">tap to dismiss</span>
        </div>
      )}

      {/* ── Gesture toggle ──────────────────────────────────────────────────── */}
      <button
        className={`gesture-toggle-btn ${gestureEnabled ? 'gesture-toggle-btn--active' : ''}`}
        onClick={() => setGesture((v) => !v)}
        title={gestureEnabled ? 'Disable gesture control' : 'Enable gesture control'}
      >
        {gestureEnabled ? '🖐 Gesture ON' : '🖐 Gesture OFF'}
      </button>

      {/* ── Reply panel ─────────────────────────────────────────────────────── */}
      <div className={`reply-text ${replyText ? '' : 'empty'}`}>
        {replyText || (loading ? 'Thinking…' : isAssistant
          ? 'Say "Harry Potter" or type to wake the avatar…'
          : appMode === 'CAD_VIEWER'
            ? 'Use gestures to explore the CAD model.'
            : 'Select a mode above to get started.'
        )}
        {replyImage && (
          <img
            src={replyImage}
            alt="Gemini response"
            style={{ display: 'block', maxWidth: '100%', marginTop: '0.5rem', borderRadius: 8 }}
          />
        )}
      </div>

      {/* ── Camera + spin controls ──────────────────────────────────────────── */}
      <div className="camera-controls">
        {[
          { label: 'Zoom',     key: 'radius',   min: 1,   max: 10,   step: 0.5, fmt: (v: number) => v.toFixed(1) },
          { label: 'Rotate H', key: 'thetaDeg', min: 0,   max: 360,  step: 1,   fmt: (v: number) => `${v}°` },
          { label: 'Rotate V', key: 'phiDeg',   min: 10,  max: 170,  step: 1,   fmt: (v: number) => `${v}°` },
          { label: 'Pan X',    key: 'panX',     min: -2,  max: 2,    step: 0.1, fmt: (v: number) => v.toFixed(1) },
          { label: 'Pan Y',    key: 'panY',     min: -2,  max: 2,    step: 0.1, fmt: (v: number) => v.toFixed(1) },
        ].map(({ label, key, min, max, step, fmt }) => (
          <div className="control-group" key={key}>
            <label>{label}</label>
            <input
              type="range" min={min} max={max} step={step}
              value={(cameraState as any)[key]}
              onChange={(e) => setCameraState((s) => ({ ...s, [key]: Number(e.target.value) }))}
            />
            <span className="control-value">{fmt((cameraState as any)[key])}</span>
          </div>
        ))}
      </div>

      {/* ── RPM control ─────────────────────────────────────────────────────── */}
      <div className="rpm-control">
        <label>Spin&nbsp;<span className="rpm-value">{targetRPM} RPM</span></label>
        <input
          type="range" min={0} max={3600} step={1}
          value={targetRPM}
          onChange={(e) => setTargetRPM(Number(e.target.value))}
        />
      </div>

      {/* ── 3D Canvas ───────────────────────────────────────────────────────── */}
      <Canvas
        camera={{ position: [0, 1.6, 3], fov: 50 }}
        gl={{ antialias: true }}
        style={{ width: '100%', height: '100vh' }}
      >
        <Scene
          appMode={appMode}
          lifeState={lifeState}
          targetRPM={targetRPM}
          cameraState={cameraState}
          gestureRef={gestureRef}
          visemesRef={visemesRef}
          audioTimeRef={audioTimeRef}
        />
      </Canvas>

      {/* ── Gesture controller ──────────────────────────────────────────────── */}
      {gestureEnabled && (
        <GestureController gestureRef={gestureRef} enabled={gestureEnabled} />
      )}

      {/* ── Input bar (AI_ASSISTANT mode only) ─────────────────────────────── */}
      {isAssistant && (
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
            {loading ? 'Sending…' : 'Send'}
          </button>
        </div>
      )}
    </>
  );
}
