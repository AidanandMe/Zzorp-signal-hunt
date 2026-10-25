"""Server-side Gemini 4 Argon scan pipeline and verification guarantees for Zzorp Signal Hunt."""

import copy
import json
import logging
import time
from typing import Any

import jsonschema
from google import genai

from config import (
    GEMINI_MODEL,
    GENERATION_CONFIG,
    RAW_RESPONSE_SCHEMA,
    SYSTEM_PROMPT,
    THINKING_LEVEL,
    get_api_key,
)
from evidence_tool import LOOKUP_EVIDENCE_DECLARATION, lookup_evidence, sources_for

logger = logging.getLogger("zzorp.scanner")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s")
    )
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

IN_CHARACTER_ERROR_MESSAGE = (
    "My instruments are confused and my antennae are fizzing. Please try scanning again, field partner!"
)


def _openapi_to_json_schema(node: Any) -> Any:
    """Convert OpenAPI 'nullable: true' fields into standard JSON Schema 'type: [T, \"null\"]'.

    This leaves zzorp_response_schema.json untouched on disk while allowing standard
    JSON Schema validation (jsonschema) and Gemini structured output to validate nulls.
    """
    if isinstance(node, dict):
        converted = {k: _openapi_to_json_schema(v) for k, v in node.items()}
        is_nullable = converted.pop("nullable", False)
        if is_nullable and isinstance(converted.get("type"), str):
            converted["type"] = [converted["type"], "null"]
        return converted
    if isinstance(node, list):
        return [_openapi_to_json_schema(item) for item in node]
    return node


JSON_VALIDATOR_SCHEMA = _openapi_to_json_schema(copy.deepcopy(RAW_RESPONSE_SCHEMA))


def validate_zzorp_response(data: dict[str, Any]) -> None:
    """Validate parsed JSON against zzorp_response_schema.json. Raises ValidationError if invalid."""
    jsonschema.validate(instance=data, schema=JSON_VALIDATOR_SCHEMA)


def enforce_server_guarantees(
    data: dict[str, Any],
    retrieved_ids: list[str],
    expected_scan_type: str = "first_scan",
) -> list[str]:
    """Enforce mandatory server-side guarantees in code (Section 4 of build brief).

    - Remove any ID in evidence_used that was not actually returned by lookup_evidence during this scan.
    - Always set player_conclusion to None in model output.
    - Never accept entry_state: 'player_concluded' from the model.
    Returns list of any unretrieved IDs that were stripped.
    """
    retrieved_set = set(retrieved_ids)
    raw_used = data.get("evidence_used")
    if not isinstance(raw_used, list):
        raw_used = []

    valid_used: list[str] = []
    stripped_ids: list[str] = []
    for eid in raw_used:
        if isinstance(eid, str) and eid in retrieved_set:
            if eid not in valid_used:
                valid_used.append(eid)
        else:
            stripped_ids.append(str(eid))
            logger.warning(
                "Server guarantee: removed unretrieved evidence ID '%s' from evidence_used (retrieved=%s)",
                eid,
                retrieved_ids,
            )
    data["evidence_used"] = valid_used

    # Ensure scan_type matches request context
    if expected_scan_type in ("first_scan", "follow_up"):
        data["scan_type"] = expected_scan_type

    notebook = data.get("notebook_update")
    if isinstance(notebook, dict):
        # Guarantee: player_conclusion is ALWAYS null in model output
        if notebook.get("player_conclusion") is not None:
            logger.warning(
                "Server guarantee: model set notebook_update.player_conclusion=%r; forcing to None",
                notebook.get("player_conclusion"),
            )
        notebook["player_conclusion"] = None

        # Guarantee: never accept entry_state == 'player_concluded' from the model
        if notebook.get("entry_state") == "player_concluded":
            replacement_state = (
                "evidence_gathered"
                if data.get("scan_type") == "follow_up"
                else ("observed" if data.get("signal_type") == "no_signal" else "question_open")
            )
            logger.warning(
                "Server guarantee: model set entry_state='player_concluded'; overriding to '%s'",
                replacement_state,
            )
            notebook["entry_state"] = replacement_state

        # On follow_up scans, ensure entry_state is evidence_gathered and new_evidence is populated
        if data.get("scan_type") == "follow_up":
            if notebook.get("entry_state") != "evidence_gathered":
                notebook["entry_state"] = "evidence_gathered"
            if not notebook.get("new_evidence"):
                notebook["new_evidence"] = data.get("signal_summary") or "Follow-up photo examined."

    # Also strip any stray top-level player_conclusion if present
    if "player_conclusion" in data:
        data.pop("player_conclusion", None)

    return stripped_ids


def _build_pass1_prompt(scan_type: str, previous_entry: dict[str, Any] | None) -> str:
    """Build the user prompt for Pass 1 (Reasoning and Evidence Pass)."""
    if scan_type == "follow_up" and previous_entry:
        return (
            "FOLLOW-UP INVESTIGATION SCAN (scan_type must be 'follow_up').\n"
            "The field partner has returned with a follow-up photo for this open Field Notebook entry:\n"
            f"- Entry Title: {previous_entry.get('entry_title', 'Unknown Specimen')}\n"
            f"- Previous Signal Classification: {previous_entry.get('signal_type', 'unknown')}\n"
            f"- Zzorp's Open Question: {previous_entry.get('zzorp_question', '')}\n"
            f"- Previously Missing Information: {json.dumps(previous_entry.get('missing_information', []))}\n"
            f"- Previous Mission: {json.dumps(previous_entry.get('mission'))}\n"
            f"- Previously Cited Evidence IDs: {json.dumps(previous_entry.get('evidence_used', []))}\n\n"
            "Instructions:\n"
            "1. Observe only what is directly visible in this new follow-up photo.\n"
            "2. Describe what the new photo shows in `new_evidence`, and update `signal_type` and `missing_information` "
            "if the new photo resolves a previous unknown or changes your classification.\n"
            "3. If the new photo reveals a material, recycling symbol, bin label, or other topic in the archive, "
            "call `lookup_evidence` before stating any environmental fact or rule.\n"
            "4. Set `entry_state` to 'evidence_gathered'.\n"
            "5. Make `zzorp_reaction` extra playful and rewarding (up to 3 short sentences on follow-up scans only):\n"
            "   - Sentence 1: An excited 'AHA!' reaction to the field partner's new photo;\n"
            "   - Sentence 2: What the new evidence changed or clarified in your thinking;\n"
            "   - Sentence 3: A fun question handing the conclusion back to the player, such as 'What do YOU think now, field partner?'\n"
            "6. Never conclude for the player, never invent facts or contradictions, and never mention points or scores.\n"
            "7. Keep your Pass 1 notes brief (short bullet points under 60 words); Pass 2 will produce the final JSON."
        )
    return (
        "FIRST SCAN (scan_type must be 'first_scan').\n"
        "Instructions:\n"
        "1. Observe only what is directly visible in this photo (`visible_facts`).\n"
        "2. Separate interpretations into `inferences`, phrased as possibilities.\n"
        "3. Classify honestly (`possible_contradiction`, `positive_signal`, `insufficient_evidence`, or `no_signal`). "
        "Remember: `no_signal` and `insufficient_evidence` are good, valid answers — never invent a problem.\n"
        "4. If any environmental fact, figure, law, or recycling rule might apply, call `lookup_evidence` first. "
        "Never state an environmental fact without calling `lookup_evidence`.\n"
        "5. Keep your Pass 1 notes brief (short bullet points under 60 words); Pass 2 will produce the final JSON."
    )


def _build_pass2_verification_prompt(
    retrieved_entries: list[dict[str, Any]],
    scan_type: str,
    retry_error: str | None = None,
) -> str:
    """Build the prompt for Pass 2 (Final Verification & Structured Output Pass)."""
    if retrieved_entries:
        evidence_block = json.dumps(retrieved_entries, indent=2)
    else:
        evidence_block = "NONE (lookup_evidence was not called or returned 0 entries)."

    state_rule = (
        "Ensure `scan_type` is 'follow_up', `notebook_update.entry_state` is 'evidence_gathered', "
        "`notebook_update.new_evidence` describes what this follow-up photo showed, "
        "`notebook_update.player_conclusion` is null, and `zzorp_reaction` has up to 3 short playful sentences: "
        "(1) an excited 'AHA!' reaction, (2) what the new evidence changed or clarified in Zzorp's thinking, "
        "and (3) a question handing the conclusion back to the player (e.g. 'What do YOU think now, field partner?')."
        if scan_type == "follow_up"
        else "Ensure `scan_type` is 'first_scan', `notebook_update.player_conclusion` is null, "
        "and `notebook_update.entry_state` is NOT 'player_concluded' (use 'observed' or 'question_open')."
    )

    prompt = (
        "FINAL VERIFICATION AND STRUCTURED JSON PASS.\n\n"
        f"Evidence entries retrieved during this scan:\n{evidence_block}\n\n"
        "Verification checklist before outputting JSON:\n"
        "1. Check every factual statement, number, law, or recycling rule in `zzorp_reaction` and `signal_summary` "
        "against the retrieved evidence entries above. Remove any factual claim not directly supported by those entries.\n"
        "2. Respect every cited entry's `caveat` (e.g. dated estimate, modelled calculation, contested figure) and `geography`.\n"
        "3. Never state a specific number of years that plastic or any object lasts.\n"
        "4. If `people_in_frame` is true, ignore the person completely (do not describe them, their clothes, food, or actions).\n"
        "5. `evidence_used` may ONLY contain IDs from the retrieved evidence entries above that your response actually relies on.\n"
        f"6. {state_rule}\n"
        "7. Respond ONLY with valid JSON matching the required response schema."
    )
    if retry_error:
        prompt += (
            f"\n\nIMPORTANT RETRY CORRECTION: Your previous JSON output failed validation with error: {retry_error}. "
            "Fix this issue and return strictly valid JSON matching all required fields and enums."
        )
    return prompt


def _build_verification_trace(
    visible_facts_count: int,
    searches_run: list[dict[str, Any]],
    retrieved_ids: list[str],
    cited_ids: list[str],
    stripped_ids: list[str],
    duration_seconds: float,
    pass1_seconds: float,
    pass2_seconds: float,
) -> dict[str, Any]:
    """Construct the real pipeline verification trace (Section 6 of build brief)."""
    obs_part = f"Observed {visible_facts_count} {'thing' if visible_facts_count == 1 else 'things'}"

    if searches_run:
        search_strs = []
        for s in searches_run:
            if s.get("signal"):
                search_strs.append(f'"{s["topic"]}" (signal: "{s["signal"]}")')
            else:
                search_strs.append(f'"{s["topic"]}"')
        search_part = f"searched {', '.join(search_strs)}"
        found_count = len(retrieved_ids)
        found_part = f"found {found_count} {'entry' if found_count == 1 else 'entries'}"
    else:
        search_part = "no archive lookup needed"
        found_part = "found 0 entries"

    cited_count = len(cited_ids)
    cited_part = f"cited {cited_count}" + (f" ({', '.join(cited_ids)})" if cited_ids else "")

    if stripped_ids:
        verify_part = f"verified claims against archive (stripped {len(stripped_ids)} unverified ID) ✓"
    else:
        verify_part = (
            f"checked {cited_count} factual {'claim' if cited_count == 1 else 'claims'} ✓"
            if cited_count > 0
            else "checked 0 archive claims (observational only) ✓"
        )

    summary_line = f"{obs_part} → {search_part} → {found_part} → {cited_part} → {verify_part}"

    return {
        "summary_line": summary_line,
        "observed_count": visible_facts_count,
        "searches_run": searches_run,
        "retrieved_ids": retrieved_ids,
        "cited_ids": cited_ids,
        "stripped_ids": stripped_ids,
        "verified_pass_completed": True,
        "guarantees_enforced": {
            "evidence_whitelist_checked": True,
            "player_conclusion_forced_null": True,
            "entry_state_guarded": True,
        },
        "timing": {
            "pass1_seconds": round(pass1_seconds, 2),
            "pass2_seconds": round(pass2_seconds, 2),
            "total_seconds": round(duration_seconds, 2),
            "thinking_level": THINKING_LEVEL,
            "model": GEMINI_MODEL,
        },
    }


def _extract_json_text(interaction: Any) -> str:
    """Extract JSON text from an Interaction response."""
    text = getattr(interaction, "output_text", None)
    if not text and getattr(interaction, "steps", None):
        parts = []
        for step in interaction.steps:
            if getattr(step, "type", None) == "model_output" and getattr(step, "content", None):
                for block in step.content:
                    if getattr(block, "type", None) == "text" and getattr(block, "text", None):
                        parts.append(block.text)
        text = "".join(parts)
    if not text:
        raise ValueError("Model returned empty output_text in verification pass.")
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def run_scan(
    image_base64: str,
    mime_type: str = "image/jpeg",
    scan_type: str = "first_scan",
    previous_entry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute the full two-pass Gemini 4 Argon scan pipeline with server-side guarantees.

    Never logs API keys or image bytes.
    """
    t_start = time.perf_counter()
    api_key = get_api_key()
    client = genai.Client(api_key=api_key)
    # Prevent 90-second multi-retry hangs when an API key hits a hard 429 billing/spending cap
    try:
        client.interactions.sdk_configuration.retry_config = None
    except Exception:
        pass

    tool_decl = _openapi_to_json_schema(
        copy.deepcopy({"type": "function", **LOOKUP_EVIDENCE_DECLARATION})
    )
    pass1_prompt = _build_pass1_prompt(scan_type=scan_type, previous_entry=previous_entry)

    logger.info(
        "Starting scan: model=%s thinking_level=%s scan_type=%s mime_type=%s",
        GEMINI_MODEL,
        THINKING_LEVEL,
        scan_type,
        mime_type,
    )

    # -------------------------------------------------------------------------
    # PASS 1: Reasoning and Evidence Pass (Multimodal + lookup_evidence tool)
    # -------------------------------------------------------------------------
    t_pass1_start = time.perf_counter()
    interaction = client.interactions.create(
        model=GEMINI_MODEL,
        system_instruction=SYSTEM_PROMPT,
        input=[
            {"type": "text", "text": pass1_prompt},
            {"type": "image", "data": image_base64, "mime_type": mime_type},
        ],
        tools=[tool_decl],
        generation_config=GENERATION_CONFIG,
    )

    searches_run: list[dict[str, Any]] = []
    retrieved_ids: list[str] = []
    retrieved_entries_by_id: dict[str, dict[str, Any]] = {}

    # Handle up to 4 tool-call rounds in Pass 1
    for round_idx in range(4):
        steps = getattr(interaction, "steps", None) or []
        fc_steps = [s for s in steps if getattr(s, "type", None) == "function_call"]
        if not fc_steps:
            break

        function_results = []
        for fc in fc_steps:
            fn_name = getattr(fc, "name", "")
            fn_args = getattr(fc, "arguments", {}) or {}
            if isinstance(fn_args, str):
                try:
                    fn_args = json.loads(fn_args)
                except Exception:
                    fn_args = {}

            if fn_name == "lookup_evidence":
                topic = fn_args.get("topic", "")
                signal = fn_args.get("signal")
                logger.info(
                    "Pass 1 tool call [round %d]: lookup_evidence(topic=%r, signal=%r)",
                    round_idx + 1,
                    topic,
                    signal,
                )
                try:
                    tool_output = lookup_evidence(topic=topic, signal=signal)
                except Exception as exc:
                    logger.warning("lookup_evidence error for args=%r: %s", fn_args, exc)
                    tool_output = {"results": [], "note": "No evidence found. Say so in character."}

                found_ids = []
                for entry in tool_output.get("results", []):
                    eid = entry["id"]
                    found_ids.append(eid)
                    if eid not in retrieved_entries_by_id:
                        retrieved_ids.append(eid)
                        retrieved_entries_by_id[eid] = entry

                searches_run.append(
                    {
                        "topic": topic,
                        "signal": signal,
                        "found_count": len(found_ids),
                        "found_ids": found_ids,
                    }
                )
            else:
                logger.warning("Unknown tool called by model: %s", fn_name)
                tool_output = {"error": f"Unknown tool '{fn_name}'"}

            function_results.append(
                {
                    "type": "function_result",
                    "name": fn_name,
                    "call_id": getattr(fc, "id", ""),
                    "result": [{"type": "text", "text": json.dumps(tool_output)}],
                }
            )

        interaction = client.interactions.create(
            model=GEMINI_MODEL,
            system_instruction=SYSTEM_PROMPT,
            previous_interaction_id=interaction.id,
            input=function_results,
            tools=[tool_decl],
            generation_config={"thinking_level": THINKING_LEVEL, "max_output_tokens": 600},
        )

    t_pass1_end = time.perf_counter()
    pass1_seconds = t_pass1_end - t_pass1_start
    logger.info(
        "Pass 1 completed in %.2fs: searches=%d retrieved_ids=%s",
        pass1_seconds,
        len(searches_run),
        retrieved_ids,
    )

    # -------------------------------------------------------------------------
    # PASS 2: Final Verification & Structured JSON Output (with 1 automatic retry)
    # -------------------------------------------------------------------------
    t_pass2_start = time.perf_counter()
    retrieved_entries_list = [retrieved_entries_by_id[i] for i in retrieved_ids]
    last_error: str | None = None
    verified_data: dict[str, Any] | None = None
    stripped_ids: list[str] = []

    for attempt in range(2):
        pass2_prompt = _build_pass2_verification_prompt(
            retrieved_entries=retrieved_entries_list,
            scan_type=scan_type,
            retry_error=last_error,
        )
        try:
            try:
                final_interaction = client.interactions.create(
                    model=GEMINI_MODEL,
                    system_instruction=SYSTEM_PROMPT,
                    previous_interaction_id=interaction.id,
                    input=pass2_prompt,
                    response_format={
                        "type": "text",
                        "mime_type": "application/json",
                        "schema": RAW_RESPONSE_SCHEMA,
                    },
                    generation_config=GENERATION_CONFIG,
                )
            except Exception as schema_exc:
                # Fallback to JSON_VALIDATOR_SCHEMA if needed
                logger.info("Retrying response_format with JSON_VALIDATOR_SCHEMA (%s)", schema_exc)
                final_interaction = client.interactions.create(
                    model=GEMINI_MODEL,
                    system_instruction=SYSTEM_PROMPT,
                    previous_interaction_id=interaction.id,
                    input=pass2_prompt,
                    response_format={
                        "type": "text",
                        "mime_type": "application/json",
                        "schema": JSON_VALIDATOR_SCHEMA,
                    },
                    generation_config=GENERATION_CONFIG,
                )

            raw_json_str = _extract_json_text(final_interaction)
            parsed = json.loads(raw_json_str)
            if not isinstance(parsed, dict):
                raise ValueError("Model JSON root must be an object.")

            # Enforce mandatory server-side guarantees before schema validation
            stripped_ids = enforce_server_guarantees(
                parsed,
                retrieved_ids=retrieved_ids,
                expected_scan_type=scan_type,
            )

            # Validate against zzorp_response_schema.json
            validate_zzorp_response(parsed)
            verified_data = parsed
            break
        except Exception as exc:
            last_error = str(exc)
            logger.warning(
                "Pass 2 validation/parsing failed on attempt %d/2: %s",
                attempt + 1,
                last_error,
            )

    t_pass2_end = time.perf_counter()
    pass2_seconds = t_pass2_end - t_pass2_start
    total_seconds = t_pass2_end - t_start

    if verified_data is None:
        logger.error("Scan failed after retry: %s", last_error)
        return {
            "ok": False,
            "error_in_character": IN_CHARACTER_ERROR_MESSAGE,
            "debug_reason": last_error,
        }

    cited_ids = verified_data.get("evidence_used", [])
    resolved_sources = sources_for(cited_ids)
    verification_trace = _build_verification_trace(
        visible_facts_count=len(verified_data.get("visible_facts", [])),
        searches_run=searches_run,
        retrieved_ids=retrieved_ids,
        cited_ids=cited_ids,
        stripped_ids=stripped_ids,
        duration_seconds=total_seconds,
        pass1_seconds=pass1_seconds,
        pass2_seconds=pass2_seconds,
    )

    logger.info(
        "Scan succeeded in %.2fs (pass1=%.2fs, pass2=%.2fs): signal_type=%s cited=%s",
        total_seconds,
        pass1_seconds,
        pass2_seconds,
        verified_data.get("signal_type"),
        cited_ids,
    )

    return {
        "ok": True,
        "result": verified_data,
        "sources": resolved_sources,
        "verification_trace": verification_trace,
    }
