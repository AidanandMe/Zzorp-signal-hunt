# Zzorp Signal Hunt — Architecture & Design (`Design.md`)

## 1. Overview
**Zzorp Signal Hunt** is a mobile-friendly web application built for the **Encode London 2026** hackathon, targeting:
- **The Real World: AI that understands the world around us**
- **Google DeepMind: Build with Gemini 4 Argon**

Zzorp is an alien field ethnographer investigating everyday human habits through the player's camera. Rather than acting as a preachy sustainability dashboard or single-shot photo captioner, Zzorp separates **direct visual observation** from **inference**, consults a curated 15-entry **Evidence Archive**, verifies its own claims against retrieved evidence, identifies what remains unknown, and assigns a child-friendly **physical investigation mission**.

---

## 2. System Architecture

```
Browser (Mobile-First Web UI)
  ├── Client-side Canvas resizer (max 1600px JPEG, strips EXIF/GPS metadata)
  ├── Screen 1: Signal Scanner (photo selection/camera + playful status cycle)
  ├── Screen 2: Results (Observations, Inferences, Signal Badge, Zzorp Says,
  │                      Missing Info, Mission, Collapsible Sources & Verification Trace)
  └── Field Notebook (localStorage, text-only, follow-up scans & player conclusion)
          │
          ▼  POST /api/scan (JSON: base64 JPEG + mime_type + optional notebook context)
FastAPI Server (`app.py` + `scanner.py` + `config.py`)
  ├── Pass 1: Reasoning & Evidence Pass (`gemini-4-argon`, `thinking_level="medium"`)
  │     └── Calls `lookup_evidence(topic, signal)` in `evidence_tool.py`
  │         against `evidence_archive.json`
  ├── Pass 2: Verification & Structured Output Pass (`gemini-4-argon`)
  │     └── Verifies all factual claims in `zzorp_reaction` & `signal_summary`
  │         against retrieved archive entries & caveats; outputs `zzorp_response_schema.json`
  └── Server-Side Guarantees & Schema Validation
        ├── Strips any `evidence_used` ID not actually returned by `lookup_evidence`
        ├── Forces `notebook_update.player_conclusion = null`
        ├── Forbids `notebook_update.entry_state = "player_concluded"` from model output
        ├── Validates against `zzorp_response_schema.json` (with 1 automatic retry)
        └── Attaches `sources` (via `sources_for()`) and real `verification_trace` metadata
```

---

## 3. Key Technical Decisions

### 3.1 Centralised Gemini 4 Argon Configuration (`config.py`)
- Uses `gemini-4-argon` via the official `google-genai` Interactions API (`client.interactions.create`).
- Does **not** set `temperature`, `top_p`, or `top_k` (deprecated/ignored in Gemini 4 Argon).
- Sets `thinking_level: "medium"` and `max_output_tokens: 32768` so Argon has ample room for both internal reasoning (`thought` steps) and structured JSON output.
- Loads `GEMINI_API_KEY` exclusively from server-side environment variables (`.env`).

### 3.2 Two-Pass Scan & Verification Pipeline (`scanner.py`)
1. **Pass 1 (Observation & Tool Use):**
   - Sends the resized image + `zzorp_system_prompt.md` + `LOOKUP_EVIDENCE_DECLARATION` to `gemini-4-argon`.
   - Executes every `lookup_evidence` tool call via `evidence_tool.py` and returns `function_result` steps using `previous_interaction_id` to preserve server-side conversation and thought signatures.
   - Tracks every search query (`topic`, `signal`) and every archive entry ID actually returned during the scan.
2. **Pass 2 (Fact Verification & Structured JSON):**
   - Continues the interaction (`previous_interaction_id`) with `response_format` enforcing `zzorp_response_schema.json`.
   - Explicitly instructs Argon to verify every factual claim in `zzorp_reaction` and `signal_summary` against the retrieved archive entries (respecting `caveat` and `geography`) and remove any unsupported statement.
3. **Server-Side Guardrails:**
   - Filters `evidence_used` against the set of IDs actually returned by `lookup_evidence` in Pass 1 (logging a warning if the model cites an unretrieved ID).
   - Forces `notebook_update.player_conclusion = None` and prevents `notebook_update.entry_state == "player_concluded"`.
   - Validates output against `zzorp_response_schema.json` using `jsonschema`. Retries once on validation/parsing failure; returns a friendly in-character fallback error if retry fails.

### 3.3 Privacy by Design
- Images are resized to at most 1600px and re-encoded as JPEG in the browser via `<canvas>`, stripping all EXIF metadata (including GPS coordinates) before upload.
- Image bytes are held only in memory during the request, never written to disk, never stored in the Field Notebook, and never logged.
- People in frame (`people_in_frame: true`) are ignored per prompt and system rules.
