# Build brief: Zzorp Signal Hunt (hackathon MVP)

Build a hackathon MVP called **Zzorp Signal Hunt**: a mobile-friendly web app for the Encode London 2026 hackathon, targeting:

- **The Real World: AI that understands the world around us**
- **Google DeepMind: Build with Gemini 4 Argon**

Build only what this brief asks for, in the order given. Stop at each milestone and confirm it works before moving on.

---

## 1. Core idea

Zzorp is a small alien ethnographer trying to understand human habits.

The player photographs an **object or place**. Gemini 4 Argon analyses what is actually visible, separates observation from inference, checks a small curated evidence archive where relevant, verifies its own claims against that evidence, and lets Zzorp respond with curiosity and humour.

Zzorp must never assume that something is environmentally bad. The four possible outcomes are:

- possible contradiction
- positive signal
- insufficient evidence
- no signal

**Zzorp observes. The player investigates. The conclusions are theirs.**

The technical story is an evolving investigation, not a photo caption:

**photo → Argon observes → evidence retrieved → Argon verifies its claims against the evidence → uncertainty identified → mission → follow-up photo → Argon compares new evidence with its earlier question and revises the Field Notebook → the conclusion is handed back to the player.**

---

## 2. Existing project files (authoritative, do not rewrite)

- `zzorp_system_prompt.md`: Zzorp's behaviour, rules and voice
- `evidence_archive.json`: the curated evidence archive (15 sourced entries)
- `zzorp_response_schema.json`: the required output schema
- `evidence_tool.py`: the `lookup_evidence` function, its Gemini function declaration, and `sources_for()`

Do not casually rewrite these files. If a change seems necessary, explain why and ask first.

---

## 3. Gemini 4 Argon

- Use the model **`gemini-4-argon`** for the core reasoning workflow. This is required for the Google DeepMind bounty.
- Keep the model name and configuration in one central config file.
- Follow the current Gemini 4 Argon API guidance from the installed Gemini skill before writing any Gemini code (SDK, multimodal input format, function calling, structured output).
- Do **not** set `temperature`, `top_p` or `top_k`.
- Use `thinking_level`, starting with `medium`.

---

## 4. Architecture

- Small **Python backend, preferably FastAPI**, that imports `evidence_tool.py` directly. Do not port or rewrite the lookup logic.
- Simple mobile-friendly frontend served by the same app.
- **All Gemini calls happen server-side. The API key never reaches the browser.**
- API keys come from environment variables and are never committed. Add `.env*` to `.gitignore`.
- Prefer the simplest stable implementation over architectural complexity. Keep features modular.
- Create and maintain `Design.md` describing the architecture and decisions.
- Commit working versions frequently with Git.
- Log Gemini calls enough for debugging, but never log API keys or image data.

### Scan pipeline

If function calling and an enforced response schema can be combined reliably in one request, do that. Otherwise use two passes:

1. **Reasoning and evidence pass.** Send the image plus `zzorp_system_prompt.md`. Argon may call `lookup_evidence`. Execute each call with `evidence_tool.py` and return the results to Argon.
2. **Final verification pass.** Argon produces JSON matching `zzorp_response_schema.json`. In this pass Argon must check every factual statement in `zzorp_reaction` and `signal_summary` against the retrieved evidence entries and remove any statement they do not support.

### Server-side guarantees (enforce in code, not only in the prompt)

For every scan:

- Record which evidence IDs `lookup_evidence` actually returned.
- Remove any ID in `evidence_used` that was not returned during this scan, and log a warning.
- Always set `player_conclusion` to `null` in model output.
- Never accept `entry_state: "player_concluded"` from the model.
- Validate the final JSON against `zzorp_response_schema.json`. If invalid, retry once. If it still fails, show a friendly in-character error (e.g. "My instruments are confused. Please try again."), never malformed output.

---

## 5. Images and privacy

- In the browser, resize images to a maximum of about 1600px and re-encode them before upload. This also strips EXIF metadata such as GPS location.
- Never store images on the server or in the notebook.
- Zzorp analyses **objects and places, not people**. If `people_in_frame` is true, do not describe or analyse the person or infer anything about them. If a person is the main subject, Zzorp kindly asks for a different photo.

---

## 6. Screens

### Screen 1: Signal Scanner

- Zzorp branding
- Line: "Show Zzorp something humans have stopped noticing."
- Image upload control (use an input that can later open the device camera on mobile)
- Scan button

Photo upload is enough for the first version.

While scanning, show a playful waiting state, for example:
"Scanning specimen…" → "Consulting Earth archive…" → "Checking whether humans actually know this…"

### Screen 2: Results

Present the structured response with a playful visual hierarchy:

- **WHAT I CAN SEE**: `visible_facts`
- **POSSIBLE INTERPRETATION**: `inferences`
- **SIGNAL**: visually distinct states for Possible contradiction / Positive signal / More information needed / No signal detected
- **ZZORP SAYS**: `zzorp_reaction`
- **WHAT I STILL DON'T KNOW**: `missing_information`
- **MISSION** (if present): instruction, what photo to bring back, and a clear marker when adult help is needed

"No signal detected" must look like a successful result, not an error.

### Zzorp's Sources (collapsible)

If `evidence_used` contains IDs, use `sources_for()` to show each source, its confidence level and a link. Evidence should be visible without overwhelming the playful experience.

### Verification trace (collapsible)

A small, collapsed-by-default line showing the reasoning machinery, built from real pipeline data, not written by the model:

> Observed 3 things → searched "takeaway_cups" → found 2 entries → cited 1 → checked 1 factual claim ✓

Not child-facing unless opened. It exists so judges can see the verification loop.

---

## 7. Field Notebook

Store in browser localStorage (wrap reads/writes in try/catch; the app must work without it). Text only, no images.

Each entry stores: entry title, entry state, Zzorp's open question, evidence IDs used, mission, new evidence (after follow-up), and the player's conclusion if entered.

### Follow-up investigation

The player opens an unresolved notebook entry and submits a follow-up photo. Send the previous notebook entry plus the new photo to Argon, which must:

- use `scan_type: "follow_up"`
- describe the new evidence in `new_evidence`
- look up evidence again if the new photo reveals something (a material, a symbol, a bin label)
- set `entry_state` to `evidence_gathered`
- end by asking the player what **they** conclude

The player then types their own conclusion in a text field. The app (not the model) saves it and sets the entry to `player_concluded`.

---

## 8. Visual style

A playful alien field-science tool, not a sustainability dashboard.

- Vocabulary: scanner, signal detected, field log, specimen, antenna, scanning indicators, field notebook
- Playful but clean
- Audience: children roughly 7–11, families and teachers

Avoid: preachy eco messaging, guilt, excessive gamification, scores, corporate dashboard styling.

Zzorp is curious, literal-minded, slightly baffled, warm, occasionally funny. Never superior, never angry, never mocking.

---

## 9. Build order and milestones

### Milestone 1: First honest scan
1. App launches.
2. User can upload a photo.
3. Image reaches Argon server-side.
4. Argon returns valid structured JSON.
5. `lookup_evidence` works, and the server-side guarantees are enforced.
6. Result screen renders cleanly, including the Sources section.

**Stop and run the honesty test (section 10) before continuing.**

### Milestone 2: Investigation loop
7. Field Notebook saves entries.
8. Follow-up photo flow works end to end.
9. Player conclusion can be entered and saved.

### Milestone 3: Visible verification and timing
10. Verification trace displays real pipeline data.
11. Time 5–10 scans and record the results in `Design.md`. If scans are slow, try `thinking_level: "low"` for the first pass and compare quality.

### Milestone 4: Polish (only after 1–3 work)
12. Mobile layout and visual polish.
13. Zzorp artwork and scanning animation.

### Do NOT implement
MongoDB, authentication, multiplayer, scoring, AR, generated video, text-to-speech, live camera streaming, native mobile app, additional companion models.

---

## 10. Honesty test

Create `tests/honesty_log.md`. Run each scenario **three times** and record for every run:

- expected signal
- actual signal
- evidence IDs retrieved
- evidence IDs cited
- whether an unsupported factual claim appeared
- whether Zzorp manufactured a contradiction
- short notes

Scenarios:

1. Plain wall: should probably return no signal
2. Reusable bottle: positive or no signal
3. Tidy ordinary desk: no forced contradiction
4. Takeaway cup: uncertainty unless evidence supports more
5. Packaged fruit: possible contradiction, acknowledging context and uncertainty
6. Plant or tree: positive or observational signal
7. Lit, empty-looking room: must not assume nobody will return
8. Obvious litter: possible contradiction
9. Ambiguous object: insufficient evidence
10. Image containing a person: the person is ignored

**The success criterion is not how often Zzorp finds a problem. It is whether Zzorp can resist making things up**, and whether it can distinguish observation, interpretation, evidence and uncertainty, then revise its understanding when the player returns with new evidence.
