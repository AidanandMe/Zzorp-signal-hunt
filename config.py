"""Central configuration for Zzorp Signal Hunt (Gemini 4 Argon)."""

import json
import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent

# Load environment variables from .env in project root
load_dotenv(BASE_DIR / ".env")

# Required model for the Google DeepMind: Build with Gemini 4 Argon bounty
GEMINI_MODEL = "gemini-4-argon"

# Thinking level configuration (do NOT set temperature, top_p, or top_k)
THINKING_LEVEL = os.getenv("ZZORP_THINKING_LEVEL", "medium")
MAX_OUTPUT_TOKENS = 32768

GENERATION_CONFIG = {
    "thinking_level": THINKING_LEVEL,
    "max_output_tokens": MAX_OUTPUT_TOKENS,
}

# Authoritative project files
SYSTEM_PROMPT_PATH = BASE_DIR / "zzorp_system_prompt.md"
RESPONSE_SCHEMA_PATH = BASE_DIR / "zzorp_response_schema.json"
EVIDENCE_ARCHIVE_PATH = BASE_DIR / "evidence_archive.json"

SYSTEM_PROMPT = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
RAW_RESPONSE_SCHEMA = json.loads(RESPONSE_SCHEMA_PATH.read_text(encoding="utf-8"))


def get_api_key() -> str:
    """Retrieve GEMINI_API_KEY from environment variables without logging it."""
    load_dotenv(BASE_DIR / ".env", override=True)
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key or key == "PASTE_YOUR_GEMINI_API_KEY_HERE":
        raise RuntimeError(
            "GEMINI_API_KEY is missing or still set to the placeholder in .env. "
            "Please paste your valid Gemini API key into .env."
        )
    return key
