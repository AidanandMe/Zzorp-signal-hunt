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
THINKING_LEVEL = os.getenv("ZZORP_THINKING_LEVEL", "low")
MAX_OUTPUT_TOKENS = 4096

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
    """Retrieve GEMINI_API_KEY from environment variables or .env without logging it."""
    env_path = BASE_DIR / ".env"
    load_dotenv(env_path, override=True)
    key = os.getenv("GEMINI_API_KEY", "").strip()

    # Fallback: if the user pasted a raw key directly into .env without 'GEMINI_API_KEY='
    if (not key or key == "PASTE_YOUR_GEMINI_API_KEY_HERE") and env_path.exists():
        for raw_line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                if k.strip() == "GEMINI_API_KEY":
                    candidate = v.strip().strip('"').strip("'")
                    if candidate and candidate != "PASTE_YOUR_GEMINI_API_KEY_HERE":
                        key = candidate
                        break
            elif line != "PASTE_YOUR_GEMINI_API_KEY_HERE":
                key = line.strip('"').strip("'")
                break

    if not key or key == "PASTE_YOUR_GEMINI_API_KEY_HERE":
        raise RuntimeError(
            "GEMINI_API_KEY is missing or still set to the placeholder in .env. "
            "Please paste your valid Gemini API key into .env."
        )
    return key
