import edge_tts
import asyncio
import os
import glob

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# High quality Microsoft Edge Neural voices for Indian languages
LANGUAGE_VOICE_MAP = {
    "kn": "kn-IN-GaganNeural",
    "kn-in": "kn-IN-GaganNeural",
    "kannada": "kn-IN-GaganNeural",
    "ml": "ml-IN-MidhunNeural",
    "ml-in": "ml-IN-MidhunNeural",
    "malayalam": "ml-IN-MidhunNeural",
    "hi": "hi-IN-MadhurNeural",
    "hi-in": "hi-IN-MadhurNeural",
    "hindi": "hi-IN-MadhurNeural",
    "ta": "ta-IN-ValluvarNeural",
    "ta-in": "ta-IN-ValluvarNeural",
    "tamil": "ta-IN-ValluvarNeural",
    "te": "te-IN-MohanNeural",
    "te-in": "te-IN-MohanNeural",
    "telugu": "te-IN-MohanNeural",
    "en": "en-IN-NeerjaNeural",
    "en-in": "en-IN-NeerjaNeural",
    "en-us": "en-US-AriaNeural"
}

def get_voice_for_language(lang_code: str = "en-US", custom_voice: str = None) -> str:
    """Resolve the best neural voice for the requested language code."""
    if custom_voice:
        return custom_voice
    if not lang_code:
        return "en-IN-NeerjaNeural"

    clean = lang_code.lower().strip()
    if clean in LANGUAGE_VOICE_MAP:
        return LANGUAGE_VOICE_MAP[clean]

    prefix = clean.split("-")[0]
    if prefix in LANGUAGE_VOICE_MAP:
        return LANGUAGE_VOICE_MAP[prefix]

    return "en-IN-NeerjaNeural"

def cleanup_old_tts_files(folder: str, keep_latest: int = 30):
    """Remove older temporary tts audio files to keep disk usage bounded."""
    try:
        files = glob.glob(os.path.join(folder, "tts_*.mp3"))
        if len(files) > keep_latest:
            files.sort(key=os.path.getmtime, reverse=True)
            for f in files[keep_latest:]:
                try:
                    os.remove(f)
                except Exception:
                    pass
    except Exception:
        pass

async def generate_tts_file(text: str, filename: str, voice: str = None):
    """Generate and save TTS file using Microsoft Edge Neural TTS with language support."""
    filepath = filename
    selected_voice = voice or "en-IN-NeerjaNeural"

    communicate = edge_tts.Communicate(text, selected_voice)
    await communicate.save(filepath)
    cleanup_old_tts_files(os.path.dirname(filepath) or UPLOAD_DIR)
    print(f"✅ TTS file saved: {filepath} (voice: {selected_voice})")
    return filepath
