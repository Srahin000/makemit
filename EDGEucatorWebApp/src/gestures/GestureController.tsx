/**
 * GestureController.tsx
 * ---------------------
 * Thin WebSocket client that connects to the Python gesture_server.py
 * (ws://localhost:8765) and applies incoming delta packets to gestureRef.
 *
 * All detection logic (MediaPipe, One Euro Filter, sticky pinch, etc.) lives
 * in server/gesture_server.py.  This component only:
 *   1. Opens / closes the WebSocket when `enabled` changes.
 *   2. Clamps & accumulates delta values into gestureRef.current.
 *   3. Shows a small status + confidence readout in the UI.
 */

import { useEffect, useRef, useState } from 'react';
import type { GestureTargets, GestureMode } from './gestureTypes';
import { GESTURE_DEFAULTS } from './gestureTypes';

const WS_URL = 'ws://localhost:8765';

// Must match ZOOM_MIN / ZOOM_MAX in gesture_server.py
const ZOOM_MIN =  1.0;
const ZOOM_MAX = 15.0;

const MODE_LABELS: Record<string, string> = {
  PAN:      '☝️  Pan',
  ZOOM_IN:  '👍 Zoom In',
  ZOOM_OUT: '👎 Zoom Out',
  ROTATE_H: '✌️  Rotate H',
  ROTATE_V: '🖐️  Rotate V',
  RESET:    '✊  Reset',
  NONE:     '—',
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

interface GesturePacket {
  active:     boolean;
  gesture:    string;
  confidence: number;
  mode:       string;
  dPanX:      number;
  dPanY:      number;
  dTheta:     number;
  dPhi:       number;
  dRadius:    number;
  reset:      boolean;
}

interface GestureControllerProps {
  gestureRef: React.MutableRefObject<GestureTargets>;
  enabled:    boolean;
}

type WsStatus = 'idle' | 'connecting' | 'connected' | 'error';

export function GestureController({ gestureRef, enabled }: GestureControllerProps) {
  const wsRef    = useRef<WebSocket | null>(null);
  const uiFrame  = useRef(0);

  const [status, setStatus]   = useState<WsStatus>('idle');
  const [info,   setInfo]     = useState<{ gesture: string; confidence: number; mode: string } | null>(null);

  useEffect(() => {
    if (!enabled) {
      wsRef.current?.close();
      gestureRef.current.active = false;
      gestureRef.current.mode   = 'NONE';
      setStatus('idle');
      setInfo(null);
      return;
    }

    setStatus('connecting');
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      console.log('[GestureController] Connected to gesture_server.py');
    };

    ws.onmessage = ({ data }: MessageEvent) => {
      const pkt = JSON.parse(data) as GesturePacket;
      const g   = gestureRef.current;

      g.mode = pkt.mode as GestureMode;

      if (pkt.active) {
        // Hand visible — gesture is controlling the camera
        g.active = true;

        if (pkt.reset) {
          Object.assign(g, GESTURE_DEFAULTS);
        } else {
          // Accumulate deltas — clamped to valid ranges
          g.panX     = clamp(g.panX     + pkt.dPanX,   -2,       2);
          g.panY     = clamp(g.panY     + pkt.dPanY,   -2,       2);
          g.thetaDeg = ((g.thetaDeg + pkt.dTheta) % 360 + 360) % 360;
          g.phiDeg   = clamp(g.phiDeg   + pkt.dPhi,    10,     170);
          g.radius   = clamp(g.radius   + pkt.dRadius, ZOOM_MIN, ZOOM_MAX);
        }

        // Throttle React state update to ~10 fps to avoid render churn
        uiFrame.current += 1;
        if (uiFrame.current % 6 === 0) {
          setInfo({ gesture: pkt.gesture, confidence: pkt.confidence, mode: pkt.mode });
        }
      } else {
        // Hand left frame — mark inactive so CameraRig holds its last position.
        // We intentionally do NOT change g.radius/panX/etc. here; the camera
        // stays exactly where it was when the hand disappeared.
        g.active = false;
        setInfo(null);
      }
    };

    ws.onerror = () => {
      setStatus('error');
      console.error('[GestureController] WebSocket error — is gesture_server.py running?');
    };

    ws.onclose = () => {
      gestureRef.current.active = false;
      setStatus((s) => (s === 'idle' ? 'idle' : 'error'));
    };

    return () => {
      ws.close();
      gestureRef.current.active = false;
      setStatus('idle');
    };
  }, [enabled, gestureRef]);

  if (!enabled) return null;

  return (
    <div className="gesture-panel">
      <div className="gesture-info">
        <span className={`gesture-status gesture-status--${status}`}>
          {{
            idle:       '○ Off',
            connecting: '○ Connecting…',
            connected:  '● Connected',
            error:      '● Error',
          }[status]}
        </span>

        {status === 'connected' && info && (
          <>
            <span className="gesture-mode-label">
              {MODE_LABELS[info.mode] ?? info.mode}
            </span>
            <div className="gesture-raw-info">
              <span className="gesture-raw-name">{info.gesture}</span>
              <span
                className="gesture-raw-conf"
                style={{ color: info.confidence >= 0.75 ? '#10b981' : '#f59e0b' }}
              >
                {(info.confidence * 100).toFixed(1)}%
              </span>
            </div>
          </>
        )}

        {status === 'error' && (
          <div className="gesture-loading-msg" style={{ color: '#ef4444' }}>
            Run: python gesture_server.py
          </div>
        )}
      </div>
    </div>
  );
}
