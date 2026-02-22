"""
modes.py
--------
Defines the three application modes and a singleton state manager.

ML_JARS      – Logo / 3D ML-jar viewer; no voice, no gesture.
CAD_VIEWER   – CAD model viewer; gesture control enabled.
AI_ASSISTANT – Harry Potter AI avatar; voice + wake word enabled.
"""

from enum import Enum


class AppMode(Enum):
    ML_JARS      = "ML_JARS"
    CAD_VIEWER   = "CAD_VIEWER"
    AI_ASSISTANT = "AI_ASSISTANT"


# Which features each mode enables
MODE_FEATURES: dict[AppMode, dict] = {
    AppMode.ML_JARS: {
        "gesture": False,
        "voice":   False,
        "chat":    False,
        "avatar":  False,
    },
    AppMode.CAD_VIEWER: {
        "gesture": True,
        "voice":   False,
        "chat":    False,
        "avatar":  False,
    },
    AppMode.AI_ASSISTANT: {
        "gesture": True,
        "voice":   True,
        "chat":    True,
        "avatar":  True,
    },
}


class SystemState:
    def __init__(self) -> None:
        self.current_mode: AppMode = AppMode.ML_JARS
        # Set to True by WakeWordEngine when "Harry Potter" is heard.
        # Frontend polls /api/status or receives it via WebSocket.
        self.wake_word_triggered: bool = False

    # ── Mode switching ────────────────────────────────────────────────────────

    def set_mode(self, mode_str: str) -> dict:
        try:
            self.current_mode = AppMode(mode_str)
            # Clear any stale wake-word flag on mode change
            self.wake_word_triggered = False
            return {
                "status":   "success",
                "mode":     self.current_mode.value,
                "features": MODE_FEATURES[self.current_mode],
            }
        except ValueError:
            valid = [m.value for m in AppMode]
            return {
                "status":  "error",
                "message": f"Invalid mode '{mode_str}'. Valid: {valid}",
            }

    def get_status(self) -> dict:
        return {
            "mode":              self.current_mode.value,
            "features":          MODE_FEATURES[self.current_mode],
            "wake_word_pending": self.wake_word_triggered,
        }

    # ── Wake-word helpers ─────────────────────────────────────────────────────

    def trigger_wake_word(self) -> None:
        """Called by WakeWordEngine on detection."""
        self.wake_word_triggered = True

    def acknowledge_wake_word(self) -> None:
        """Called by the frontend after it has acted on the wake-word event."""
        self.wake_word_triggered = False


# Singleton — import this everywhere
state_manager = SystemState()
