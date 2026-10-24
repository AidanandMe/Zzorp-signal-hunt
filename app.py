"""FastAPI server for Zzorp Signal Hunt (Encode London 2026 MVP)."""

import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from config import BASE_DIR, GEMINI_MODEL, THINKING_LEVEL, get_api_key
from scanner import IN_CHARACTER_ERROR_MESSAGE, run_scan

app = FastAPI(
    title="Zzorp Signal Hunt",
    description="An alien field scientist investigates everyday human habits using Gemini 4 Argon.",
    version="0.1.0",
)

STATIC_DIR = BASE_DIR / "static"
EXAMPLES_DIR = BASE_DIR / "examples"
EXAMPLES_DIR.mkdir(exist_ok=True)


class ScanRequest(BaseModel):
    image_base64: str = Field(..., min_length=16, description="Base64-encoded resized image (no data URL prefix)")
    mime_type: str = Field(default="image/jpeg")
    scan_type: str = Field(default="first_scan")
    previous_entry: dict[str, Any] | None = Field(default=None)


def _is_api_key_configured() -> bool:
    try:
        return bool(get_api_key())
    except RuntimeError:
        return False


@app.get("/api/health")
def health_check() -> dict[str, Any]:
    """Return server status and whether GEMINI_API_KEY has been pasted into .env."""
    return {
        "status": "ok",
        "model": GEMINI_MODEL,
        "thinking_level": THINKING_LEVEL,
        "api_key_configured": _is_api_key_configured(),
    }


@app.post("/api/scan")
def api_scan(req: ScanRequest) -> JSONResponse:
    """Process an image scan through the two-pass Gemini 4 Argon pipeline.

    Images are processed strictly in memory and never stored to disk.
    """
    if req.scan_type not in ("first_scan", "follow_up"):
        raise HTTPException(status_code=400, detail="scan_type must be 'first_scan' or 'follow_up'")

    # Strip data URI prefix if accidentally included
    image_b64 = req.image_base64.strip()
    if "," in image_b64 and image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]

    if not _is_api_key_configured():
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "error_in_character": (
                    "My sub-space transmitter has no power crystal! "
                    "(Please paste your GEMINI_API_KEY into the .env file and try again.)"
                ),
                "missing_api_key": True,
            },
        )

    try:
        outcome = run_scan(
            image_base64=image_b64,
            mime_type=req.mime_type or "image/jpeg",
            scan_type=req.scan_type,
            previous_entry=req.previous_entry,
        )
        if not outcome.get("ok"):
            return JSONResponse(status_code=502, content=outcome)
        return JSONResponse(status_code=200, content=outcome)
    except Exception as exc:
        err_str = str(exc)
        friendly_msg = IN_CHARACTER_ERROR_MESSAGE
        if "spending cap" in err_str.lower() or "billing" in err_str.lower():
            friendly_msg = (
                f"{IN_CHARACTER_ERROR_MESSAGE} "
                "(Google AI Studio returned 429: Your billing account has exceeded its monthly spending cap at https://ai.studio/billing — please increase the cap or paste a new API key into .env.)"
            )
        elif "api_key_invalid" in err_str.lower() or "api key not valid" in err_str.lower():
            friendly_msg = (
                f"{IN_CHARACTER_ERROR_MESSAGE} "
                "(Google AI Studio reported that the GEMINI_API_KEY in .env is invalid.)"
            )
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error_in_character": friendly_msg,
                "debug_reason": err_str,
            },
        )


@app.get("/api/examples")
def list_examples() -> dict[str, Any]:
    """List example photos placed in the examples/ folder."""
    allowed_exts = {".jpg", ".jpeg", ".png", ".webp"}
    files = sorted(
        f.name
        for f in EXAMPLES_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in allowed_exts
    )
    return {
        "count": len(files),
        "examples": [{"name": name, "url": f"/examples/{name}"} for name in files],
    }


@app.get("/")
def serve_index() -> FileResponse:
    """Serve the mobile-friendly Zzorp Signal Hunt web app."""
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/examples", StaticFiles(directory=str(EXAMPLES_DIR)), name="examples")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
