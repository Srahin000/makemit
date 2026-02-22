/**
 * VoiceInput.tsx
 * --------------
 * Hold-to-talk microphone button using the browser's Web Speech API.
 *
 * Usage:
 *   <VoiceInput onTranscript={(text) => sendMessage(text)} disabled={loading} />
 *
 * Works in Chrome and Edge out of the box.
 * Firefox requires the `media.webspeech.recognition.enable` flag.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// Extend the window type for vendor-prefixed SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition:       typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

interface VoiceInputProps {
  /** Called with the final transcript when the user stops speaking. */
  onTranscript: (text: string) => void;
  /** Disable the mic while the AI is responding. */
  disabled?: boolean;
  /** BCP-47 language tag, e.g. "en-US" */
  lang?: string;
}

type MicState = 'idle' | 'listening' | 'processing' | 'unsupported';

export function VoiceInput({
  onTranscript,
  disabled = false,
  lang = 'en-US',
}: VoiceInputProps) {
  const [micState, setMicState]     = useState<MicState>('idle');
  const [interim,  setInterim]      = useState('');   // live partial transcript
  const recogRef                    = useRef<SpeechRecognition | null>(null);
  const finalRef                    = useRef('');      // accumulates final segments

  // Check browser support once on mount
  useEffect(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) setMicState('unsupported');
  }, []);

  const start = useCallback(() => {
    if (disabled || micState === 'listening') return;

    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.lang            = lang;
    rec.interimResults  = true;   // show partial transcripts while speaking
    rec.maxAlternatives = 1;
    rec.continuous      = false;  // stop automatically after a pause
    recogRef.current    = rec;
    finalRef.current    = '';

    rec.onstart = () => {
      setMicState('listening');
      setInterim('');
    };

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interimText = '';
      let finalText   = '';

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalText += chunk;
        } else {
          interimText += chunk;
        }
      }

      if (finalText) finalRef.current += finalText;
      setInterim(interimText);
    };

    rec.onspeechend = () => {
      rec.stop();
    };

    rec.onend = () => {
      recogRef.current = null;
      setMicState('processing');
      setInterim('');

      const transcript = finalRef.current.trim();
      if (transcript) {
        onTranscript(transcript);
      }
      // Brief visual "processing" flash before returning to idle
      setTimeout(() => setMicState('idle'), 400);
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      console.warn('[VoiceInput] error:', e.error);
      recogRef.current = null;
      setMicState('idle');
      setInterim('');
    };

    rec.start();
  }, [disabled, lang, micState, onTranscript]);

  const stop = useCallback(() => {
    recogRef.current?.stop();
  }, []);

  if (micState === 'unsupported') {
    return (
      <button className="mic-btn mic-btn--unsupported" disabled title="Speech recognition not supported in this browser">
        🎙️
      </button>
    );
  }

  const isListening  = micState === 'listening';
  const isProcessing = micState === 'processing';

  return (
    <>
      <button
        className={`mic-btn ${isListening ? 'mic-btn--active' : ''} ${isProcessing ? 'mic-btn--processing' : ''}`}
        onMouseDown={start}
        onMouseUp={stop}
        onTouchStart={start}
        onTouchEnd={stop}
        disabled={disabled || micState === 'unsupported'}
        title={isListening ? 'Release to send' : 'Hold to speak'}
        aria-label="Voice input"
      >
        🎙️
      </button>

      {/* Live partial transcript displayed above input bar */}
      {(isListening || isProcessing) && (
        <div className="voice-interim">
          {isListening
            ? (interim || <span className="voice-interim__placeholder">Listening…</span>)
            : <span className="voice-interim__placeholder">Processing…</span>
          }
        </div>
      )}
    </>
  );
}
