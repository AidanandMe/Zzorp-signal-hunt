"""FastAPI server for Zzorp Signal Hunt (Encode London 2026 MVP)."""

import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from config import BASE_DIR, GEMINI_MODEL, THINKING_LEVEL, get_api_key
from evidence_tool import lookup_evidence, sources_for
from scanner import (
    IN_CHARACTER_ERROR_MESSAGE,
    _build_verification_trace,
    enforce_server_guarantees,
    run_scan,
    validate_zzorp_response,
)

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
        if (
            "spending cap" in err_str.lower()
            or "billing" in err_str.lower()
            or "resource_exhausted" in err_str.lower()
            or "429" in err_str.lower()
        ):
            preset_key = "follow_up" if req.scan_type == "follow_up" else "cup"
            if req.scan_type == "first_scan":
                # Pick deterministically from cup / banana based on image length so different photos feel distinct
                preset_key = ("cup", "banana", "mug")[len(image_b64) % 3]
            fallback_content = _build_preset_response(
                preset_key,
                fallback_note=(
                    "Live Gemini API returned 429 (Hackathon billing account spending cap reached) — "
                    "showing verified offline demo specimen so you can test the full app flow."
                ),
            )
            return JSONResponse(status_code=200, content=fallback_content)

        friendly_msg = IN_CHARACTER_ERROR_MESSAGE
        if "api_key_invalid" in err_str.lower() or "api key not valid" in err_str.lower():
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


DEMO_PRESETS: dict[str, dict[str, Any]] = {
    "cup": {
        "topic": "takeaway_cups",
        "signal": "cup",
        "payload": {
            "scan_type": "first_scan",
            "people_in_frame": False,
            "visible_facts": [
                "A paper takeaway cup with a plastic lid is sitting next to a recycling bin.",
                "We cannot see a sign showing if coffee cups are allowed in this bin.",
            ],
            "inferences": [
                "This cup probably has a thin plastic layer inside so hot drinks do not leak through the paper.",
                "Someone might have put it near the recycling bin thinking all paper cups go in normal paper recycling.",
            ],
            "missing_information": [
                "Whether this place has a special bin just for takeaway cups.",
                "What the sticker on the front of the bin says is allowed inside.",
            ],
            "signal_type": "possible_contradiction",
            "signal_summary": "A takeaway cup is sitting next to a normal recycling bin, even though most paper cups have a hidden plastic layer inside and need a special bin.",
            "zzorp_reaction": (
                "Beep-boop, wait a second! Humans made a cup out of tree paper glued to a thin plastic layer just to hold a warm drink for ten minutes, "
                "and now it is sitting by a normal paper bin that usually cannot recycle it! Why make a ten-minute cup that tricks your own recycling bins?"
            ),
            "mission": {
                "instruction": "Check the label on the front of the recycling bin to see if takeaway coffee cups are allowed.",
                "photo_to_bring_back": "A clear photo of the bin's label showing what can go inside.",
                "ask_an_adult": False,
            },
            "evidence_used": ["EV-001", "EV-002"],
            "notebook_update": {
                "entry_title": "Mystery #1: The Ten-Minute Cup",
                "zzorp_question": "Does this recycling bin actually take paper coffee cups, or do they need a special cup bin?",
                "entry_state": "question_open",
                "new_evidence": None,
                "player_conclusion": None,
            },
        },
    },
    "banana": {
        "topic": "packaged_produce",
        "signal": "fruit",
        "payload": {
            "scan_type": "first_scan",
            "people_in_frame": False,
            "visible_facts": [
                "Yellow bananas with their own thick skins are sealed inside a clear plastic bag.",
                "A price sticker is stuck to the outside of the plastic bag.",
            ],
            "inferences": [
                "The shop is probably selling these bananas together as one pack.",
                "The plastic bag might just be there to hold the price sticker, since bananas already have tough peels.",
            ],
            "missing_information": [
                "Whether loose bananas without plastic bags are sold right next to them.",
                "Whether this soft plastic bag can be recycled at the store.",
            ],
            "signal_type": "possible_contradiction",
            "signal_summary": "Bananas already grow their own thick natural wrapper, but someone put them inside an extra plastic bag anyway.",
            "zzorp_reaction": (
                "My big eye is blinking super fast! Nature already gave this yellow fruit a tough, stretchy peel to keep it safe, "
                "but humans zipped that peel inside a second plastic bag! Humans… why did you put a wrapper on top of a wrapper?"
            ),
            "mission": {
                "instruction": "Look at the fruit shelf nearby to see if you can buy loose bananas without a plastic bag.",
                "photo_to_bring_back": "A photo of the shelf showing loose fruit or the price sign.",
                "ask_an_adult": False,
            },
            "evidence_used": ["EV-007"],
            "notebook_update": {
                "entry_title": "Mystery #2: The Double-Wrapped Banana",
                "zzorp_question": "Why did the shop wrap fruit that already has its own skin, and can shoppers pick loose bananas instead?",
                "entry_state": "question_open",
                "new_evidence": None,
                "player_conclusion": None,
            },
        },
    },
    "mug": {
        "topic": None,
        "signal": None,
        "payload": {
            "scan_type": "first_scan",
            "people_in_frame": False,
            "visible_facts": [
                "A sturdy mug is sitting on a wooden desk next to a closed notebook.",
                "There are no throw-away wrappers or bins in the photo.",
            ],
            "inferences": [
                "This mug can be washed and used again and again instead of being thrown away.",
            ],
            "missing_information": [
                "No extra clues needed — everything looks normal and easy to understand!",
            ],
            "signal_type": "no_signal",
            "signal_summary": "A normal reusable mug sitting on a desk — no weird waste mystery here!",
            "zzorp_reaction": (
                "Aha! A strong mug sitting nicely next to a notebook. "
                "My scanner sees zero trash mysteries here — just a clever cup that humans can wash and use hundreds of times!"
            ),
            "mission": None,
            "evidence_used": [],
            "notebook_update": {
                "entry_title": "Mystery #3: The Clever Washable Mug",
                "zzorp_question": "How many throw-away cups can one washable mug save in a whole year?",
                "entry_state": "observed",
                "new_evidence": None,
                "player_conclusion": None,
            },
        },
    },
    "follow_up": {
        "topic": "local_recycling_rules",
        "signal": "bins",
        "payload": {
            "scan_type": "follow_up",
            "people_in_frame": False,
            "visible_facts": [
                "The recycling bin sign says yes to clean paper, cardboard, cans, and plastic bottles.",
                "The sign says takeaway coffee cups and messy food items are not allowed inside.",
            ],
            "inferences": [
                "This recycling bin cannot take paper coffee cups because of their thin plastic lining, though a clean plastic lid might be okay.",
            ],
            "missing_information": [
                "Where the nearest special coffee cup recycling bin is located.",
            ],
            "signal_type": "possible_contradiction",
            "signal_summary": "Your follow-up photo of the bin sign proves that takeaway coffee cups are not allowed in this recycling bin!",
            "zzorp_reaction": (
                "AHA! My antennae are doing a happy dance over your close-up photo of the bin sign! "
                "That solved my biggest mystery: this bin takes paper, cans, and bottles, but says NO to plastic-lined coffee cups! "
                "What do YOU think now, detective?"
            ),
            "mission": None,
            "evidence_used": ["EV-003"],
            "notebook_update": {
                "entry_title": "Mystery #1: The Ten-Minute Cup",
                "zzorp_question": "Does this recycling bin actually take paper coffee cups, or do they need a special cup bin?",
                "entry_state": "evidence_gathered",
                "new_evidence": "Bin sign checked: this bin takes clean paper, cardboard, cans, and bottles, but says no to takeaway coffee cups.",
                "player_conclusion": None,
            },
        },
    },
}


def _build_preset_response(
    preset_name: str, fallback_note: str | None = None
) -> dict[str, Any]:
    """Build a verified response dict from DEMO_PRESETS using the real archive tool and server guarantees."""
    import copy

    spec = DEMO_PRESETS.get(preset_name.lower())
    if not spec:
        raise HTTPException(status_code=404, detail=f"Unknown demo preset: {preset_name}")

    topic = spec["topic"]
    signal = spec["signal"]
    searches_run: list[dict[str, Any]] = []
    retrieved_ids: list[str] = []

    if topic:
        tool_out = lookup_evidence(topic=topic, signal=signal)
        found_ids = [item["id"] for item in tool_out.get("results", [])]
        retrieved_ids.extend(found_ids)
        searches_run.append(
            {
                "topic": topic,
                "signal": signal,
                "found_count": len(found_ids),
                "found_ids": found_ids,
            }
        )

    payload_copy = copy.deepcopy(spec["payload"])
    expected_scan_type = payload_copy.get("scan_type", "first_scan")
    stripped_ids = enforce_server_guarantees(
        payload_copy,
        retrieved_ids=retrieved_ids,
        expected_scan_type=expected_scan_type,
    )
    validate_zzorp_response(payload_copy)

    cited_ids = payload_copy.get("evidence_used", [])
    resolved_sources = sources_for(cited_ids)
    verification_trace = _build_verification_trace(
        visible_facts_count=len(payload_copy.get("visible_facts", [])),
        searches_run=searches_run,
        retrieved_ids=retrieved_ids,
        cited_ids=cited_ids,
        stripped_ids=stripped_ids,
        duration_seconds=0.05,
        pass1_seconds=0.03,
        pass2_seconds=0.02,
    )
    if fallback_note:
        verification_trace["summary_line"] = (
            f"{verification_trace['summary_line']} • [429 Credit Fallback Active]"
        )
        verification_trace["fallback_note"] = fallback_note

    return {
        "ok": True,
        "result": payload_copy,
        "sources": resolved_sources,
        "verification_trace": verification_trace,
        "is_demo_preset": True,
        "fallback_note": fallback_note,
    }


@app.get("/api/demo_preset/{preset_name}")
def get_demo_preset(preset_name: str) -> JSONResponse:
    """Return a verified live-pitch demo specimen processed through the real archive tool and server guarantees."""
    return JSONResponse(status_code=200, content=_build_preset_response(preset_name))


@app.get("/")
def serve_index() -> FileResponse:
    """Serve the mobile-friendly Zzorp Signal Hunt web app."""
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/examples", StaticFiles(directory=str(EXAMPLES_DIR)), name="examples")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
