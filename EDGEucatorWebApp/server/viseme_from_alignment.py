"""
Convert ElevenLabs character alignment to Oculus-style viseme keyframes.
Maps characters to visemes for lip-sync (mouthOpen/jaw driven from intensity).
"""

VISEME_SIL = "sil"
VISEMES = [
    "sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR",
    "aa", "E", "ih", "oh", "ou",
]


def _char_to_viseme(c: str) -> str:
    if not c or c == " ":
        return VISEME_SIL
    ch = c.lower()
    # Vowels
    if ch in "aàáâäæãåā":
        return "aa"
    if ch in "eèéêëēė":
        return "E"
    if ch in "iìíîïī":
        return "ih"
    if ch in "oòóôöōõ":
        return "oh"
    if ch in "uùúûüū":
        return "ou"
    # Consonants
    if ch in "pbm":
        return "PP"
    if ch in "fv":
        return "FF"
    if ch in "ðþ":
        return "TH"
    if ch in "tdnszl":
        return "DD"
    if ch in "kgŋ":
        return "kk"
    if ch in "j" or ch in "tʃdʒj":
        return "CH"
    if ch in "sz":
        return "SS"
    if ch in "nl":
        return "nn"
    if ch == "r":
        return "RR"
    if ch == "θ":
        return "TH"
    return VISEME_SIL


def alignment_to_visemes(alignment: dict) -> list[dict]:
    """
    Build viseme keyframes from ElevenLabs alignment.

    alignment: dict with keys:
        - characters: list[str]
        - character_start_times_seconds: list[float]
        - character_end_times_seconds: list[float]

    Returns list of { "time": float, "viseme": str, "intensity": float }.
    """
    if not alignment or not alignment.get("characters"):
        return []

    characters = alignment["characters"]
    starts = alignment.get("character_start_times_seconds") or []
    ends = alignment.get("character_end_times_seconds") or []

    seen: dict[float, dict] = {}

    for i, c in enumerate(characters):
        viseme = _char_to_viseme(c)
        start = starts[i] if i < len(starts) else 0.0
        end = ends[i] if i < len(ends) else start + 0.05
        intensity = 0 if viseme == VISEME_SIL else 1.0

        if start not in seen:
            seen[start] = {"viseme": viseme, "intensity": intensity}
        elif viseme != VISEME_SIL:
            seen[start] = {"viseme": viseme, "intensity": intensity}

        mid = (start + end) / 2
        if mid not in seen:
            seen[mid] = {"viseme": viseme, "intensity": intensity}

    keyframes = [{"time": t, "viseme": v["viseme"], "intensity": v["intensity"]} for t, v in sorted(seen.items())]

    if keyframes and keyframes[0]["time"] > 0:
        keyframes.insert(0, {"time": 0.0, "viseme": VISEME_SIL, "intensity": 0.0})
    if keyframes:
        last = keyframes[-1]
        keyframes.append({"time": last["time"] + 0.1, "viseme": VISEME_SIL, "intensity": 0.0})

    return sorted(keyframes, key=lambda x: x["time"])
