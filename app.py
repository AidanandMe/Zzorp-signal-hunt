"""FastAPI server for Zzorp Signal Hunt (Encode London 2026 MVP)."""

import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from config import BASE_DIR, GEMINI_MODEL, THINKING_LEVEL
from scanner import IN_CHARACTER_ERROR_MESSAGE, run_scan

app = FastAPI(
    title="Zzorp Signal Hunt",
    description="An alien field scientist investigates everyday human habits using Gemini 4 Argon.",
    version="0.1.0",
)

STATIC_DIR = BASE_DIR / "static"


class ScanRequest(BaseModel):
    image_base64: str = Field(..., min_length=16, description="Base64-encoded resized image (no data URL prefix)")
    mime_type: str = Field(default="image/jpeg")
    scan_type: str = Field(default="first_scan")
    previous_entry: dict[str, Any] | None = Field(default=None)


def _is_api_key_configured() -> bool:
    load_dotenv(BASE_DIR / ".env", override=True)
    key = os.getenv("GEMINI_API_KEY", "").strip()
    return bool(key and key != "PASTE_YOUR_GEMINI_API_KEY_HERE")


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
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error_in_character": IN_CHARACTER_ERROR_MESSAGE,
                "debug_reason": str(exc),
            },
        )


@app.get("/")
def serve_index() -> FileResponse:
    """Serve the mobile-friendly Zzorp Signal Hunt web app."""
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
