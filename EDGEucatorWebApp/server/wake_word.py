"""
wake_word.py
------------
Background thread that listens for the "Harry Potter" wake word using
Picovoice Porcupine.

Usage (started automatically by main.py):
    engine = WakeWordEngine(
        access_key = PICO_ACCESS_KEY,
        model_path  = "path/to/Harry-Potter_en_mac_v3_0_0.ppn",
        callback    = state_manager.trigger_wake_word,
        broadcast   = broadcast_fn,   # async coroutine to push event to WS clients
        loop        = asyncio_loop,
    )
    engine.start()
    ...
    engine.stop()
"""

import asyncio
import logging
import threading

logger = logging.getLogger(__name__)


class WakeWordEngine:
    """
    Runs Porcupine in a daemon thread.

    Parameters
    ----------
    access_key  : Picovoice console access key.
    model_path  : Absolute path to the .ppn keyword file.
    callback    : Synchronous callable invoked on each detection
                  (e.g. state_manager.trigger_wake_word).
    broadcast   : Optional async coroutine ``broadcast(payload: dict)``
                  for pushing wake-word events over WebSocket.
    loop        : The running asyncio event loop (needed to schedule
                  the async broadcast from the sync thread).
    """

    def __init__(
        self,
        access_key:  str,
        model_path:  str,
        callback,
        broadcast=None,
        loop: asyncio.AbstractEventLoop | None = None,
    ) -> None:
        self.access_key  = access_key
        self.model_path  = model_path
        self.callback    = callback
        self.broadcast   = broadcast
        self.loop        = loop
        self._stop       = threading.Event()
        self._thread: threading.Thread | None = None

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Spawn the background detection thread."""
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="wake-word")
        self._thread.start()
        logger.info("[wake_word] Engine started — listening for 'Harry Potter'")

    def stop(self) -> None:
        """Signal the thread to stop and wait for it."""
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
        logger.info("[wake_word] Engine stopped.")

    # ── Internal ──────────────────────────────────────────────────────────────

    def _run(self) -> None:
        try:
            import pvporcupine
            from pvrecorder import PvRecorder
        except ImportError:
            logger.error(
                "[wake_word] pvporcupine / pvrecorder not installed. "
                "Run: pip install pvporcupine pvrecorder"
            )
            return

        porcupine = None
        recorder  = None

        try:
            porcupine = pvporcupine.create(
                access_key=self.access_key,
                keyword_paths=[self.model_path],
            )
            recorder = PvRecorder(
                device_index=-1,
                frame_length=porcupine.frame_length,
            )
            recorder.start()
            logger.info("[wake_word] Microphone open — waiting for wake word…")

            while not self._stop.is_set():
                pcm    = recorder.read()
                result = porcupine.process(pcm)

                if result >= 0:
                    logger.info("[wake_word] 🧙 'Harry Potter' detected!")
                    self.callback()                    # sync: set state flag

                    if self.broadcast and self.loop:   # async: push WS event
                        asyncio.run_coroutine_threadsafe(
                            self.broadcast({"event": "wake_word", "keyword": "Harry Potter"}),
                            self.loop,
                        )

        except Exception:
            logger.exception("[wake_word] Error in detection loop")
        finally:
            if recorder:
                recorder.stop()
                recorder.delete()
            if porcupine:
                porcupine.delete()
