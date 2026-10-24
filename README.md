# 🛸 Zzorp Signal Hunt

> **Tagline:** *An alien investigates human habits.*  
> **Encode London 2026 Hackathon MVP**  
> **Target Tracks:**
> - 🌍 **The Real World: AI that understands the world around us**
> - 🧠 **Google DeepMind: Build with Gemini 4 Argon** (`gemini-4-argon` via the Interactions API)

---

## 🌟 Overview

**Zzorp** is a curious, one-eyed yellow alien field scientist trying to understand everyday human behaviour. Through the player's camera, Zzorp notices things humans have stopped noticing — disposable cups beside recycling bins, fruit wrapped in plastic film, lights left on in empty rooms, and trees trapped in concrete — and turns those observations into playful field missions and open questions.

Curious, puzzled, and occasionally amused by us, **Zzorp never tells the player what is right or wrong**:

- **"Humans created this object to use for eight minutes. It may remain on Earth for decades. Explain."**
- **"Humans… why are you packaging the packaging?"**

> **Core Principle:** *Zzorp observes. The player investigates. The conclusions are theirs.*

---

## 🧠 Why Gemini 4 Argon (`gemini-4-argon`)?

Real-world environmental photos are messy and ambiguous. A single photo rarely proves whether a bin accepts plastic-lined cups, why a room's lights are on, or whether a plastic film is locally recyclable.

**Zzorp Signal Hunt** uses **Gemini 4 Argon (`gemini-4-argon`)** via `client.interactions.create(...)` with `thinking_level: "medium"` in a strict **two-pass tool-grounded pipeline**:

1. **Pass 1 — Visual Observation & Archive Lookup (`scanner.py`)**
   - Receives the browser-resized JPEG (`max 1600px`, EXIF/GPS stripped in `<canvas>`).
   - Separates what is **directly visible** (`visible_facts`) from **interpretation** (`inferences`) and **what cannot be known from one photo** (`missing_information`).
   - Calls the local `lookup_evidence(topic, signals)` function tool against our curated 15-entry **Earth Evidence Archive** (`evidence_archive.json` — WRAP, Royal Society, IEA, Woodland Trust, RHS, Global E-waste Monitor).
2. **Pass 2 — Grounded Structured JSON Output (`zzorp_response_schema.json`)**
   - Receives the exact matching archive entries and produces schema-locked JSON (`response_format=ZZORP_RESPONSE_SCHEMA`).
3. **Server-Side Epistemic & Safety Guarantees (`scanner.py`)**
   - **Zero Hallucinated Citations:** Every ID in `evidence_used` must exist in `evidence_archive.json` *and* have been returned by `lookup_evidence` in that turn.
   - **No Manufactured Problems:** When `signal_type == "no_signal"` (e.g. a ceramic mug on a desk), the server guarantees `mission = null` and `evidence_used = []`.
   - **Player-Owned Conclusions:** `notebook_update.player_conclusion` is enforced as `null` on all model outputs — only the player can write and save their own conclusion in the Field Notebook.
   - **Verification Trace:** Every scan returns a transparent trace (`Observed 2 things → searched "takeaway_cups" → found 2 entries → cited 2 → checked 2 factual claims ✓`).

---

## 🗂️ Project Structure

```text
Zzorp-Signal-Hunt/
├── app.py                      # FastAPI server (/api/scan, /api/examples, /api/demo_preset/*)
├── scanner.py                  # Two-pass Gemini 4 Argon pipeline + schema & epistemic guarantees
├── config.py                   # Model constants (gemini-4-argon) & .env key loader
├── evidence_tool.py            # Read-only lookup_evidence(topic, signals) & sources_for(ids)
├── evidence_archive.json       # Curated 15-entry Earth Evidence Archive (EV-001 to EV-015)
├── zzorp_system_prompt.md      # Zzorp's persona, epistemic honesty, and child-safety rules
├── zzorp_response_schema.json  # Strict JSON Schema for structured output
├── static/
│   ├── index.html              # Mobile-first 3-screen web app (Scanner, Report, Field Notebook)
│   ├── styles.css              # Playful alien lab theme + custom yellow Zzorp SVG character
│   └── app.js                  # Canvas EXIF stripper, localStorage Field Notebook, follow-up loop
├── examples/                   # Drop sample photos here (.jpg/.png/.webp) for instant loading
├── tests/
│   └── honesty_log.md          # 10-scenario Honesty Test matrix
└── Design.md                   # Architecture & visual design specification
```

---

## 🚀 Quick Start

### 1. Create & activate the virtual environment

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Configure your Gemini API key

Open `.env` in the project root and paste your Google AI Studio API key:

```env
GEMINI_API_KEY=your_api_key_here
```

*(Note: `.env` is git-ignored so your key is never committed.)*

### 3. Run the server

```powershell
.\.venv\Scripts\python.exe app.py
```

Open **http://127.0.0.1:8000** in your browser (or mobile device on the same network).

---

## 🎬 3-Minute Live Pitch Demo Flow

1. **Scan 1 — Contradiction Signal:** Scan a takeaway cup next to a recycling bin (or bananas wrapped in plastic). Show how Zzorp separates **What's Visible**, **Zzorp's Inference**, and **What's Still Missing**, cites verified archive sources (`EV-001`, `EV-002`), and proposes a safe **Follow-up Mission**.
2. **Scan 2 — Follow-up Investigation Loop:** Click **📷 Upload Follow-up Photo**, upload a closer photo of the bin's label, and watch the Field Notebook entry progress from `Question Open` → `Evidence Gathered` with `new_evidence`.
3. **Player-Owned Conclusion:** Type the player's own conclusion into the Field Notebook and save it (`Player Concluded ✓`), demonstrating that Zzorp never tells the player what to think.
4. **Scan 3 — Epistemic Honesty (`no_signal`):** Scan an ordinary ceramic mug on a wooden desk. Show that Zzorp classifies it as `✨ No signal detected` with no fake mission and zero invented citations.
5. **Credit-Safe Fallback Drawer:** On Screen 1, expand **🧪 Demo Specimens & `examples/` Folder** to load any image placed in `examples/` or trigger instant, archive-verified demo specimens (`cup`, `banana`, `mug`) if venue Wi-Fi or shared hackathon API credits hiccup.
