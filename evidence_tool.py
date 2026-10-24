"""Zzorp evidence lookup: the one tool the agent can call.

Register LOOKUP_EVIDENCE_DECLARATION as a function declaration with Gemini,
and when the model calls it, run lookup_evidence(**args) and send the result back.
"""

import json
from pathlib import Path

ARCHIVE = json.loads(Path(__file__).with_name("evidence_archive.json").read_text())

TOPICS = sorted({e["topic"] for e in ARCHIVE["entries"]})

LOOKUP_EVIDENCE_DECLARATION = {
    "name": "lookup_evidence",
    "description": (
        "Search Zzorp's curated evidence archive. Call this before stating ANY "
        "environmental fact, figure or rule. Returns only verified entries with "
        "source, confidence and caveat. If nothing is returned, Zzorp has no "
        "evidence and must say so."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "topic": {
                "type": "string",
                "enum": TOPICS,
                "description": "The archive topic closest to what is in the photo.",
            },
            "signal": {
                "type": "string",
                "nullable": True,
                "description": "Optional keyword to narrow results, e.g. 'cup', 'positive', 'lights'.",
            },
        },
        "required": ["topic"],
    },
}


def lookup_evidence(topic: str, signal: str | None = None) -> dict:
    """Return entries for this topic, optionally narrowed by a signal keyword.

    Topic always constrains the search: a signal can only narrow results
    within the topic, never pull in facts from an unrelated topic.
    """
    hits = [
        e for e in ARCHIVE["entries"]
        if e["topic"] == topic and (signal is None or signal in e["signals"])
    ]
    return {
        "results": [
            {k: e[k] for k in ("id", "statement", "source", "confidence", "caveat", "geography")}
            for e in hits
        ],
        "note": "No evidence found. Say so in character." if not hits else None,
    }


def sources_for(ids: list[str]) -> list[dict]:
    """For the UI's 'Zzorp's sources' drawer: id -> source and link."""
    by_id = {e["id"]: e for e in ARCHIVE["entries"]}
    return [
        {"id": i, "source": by_id[i]["source"], "url": by_id[i]["url"], "confidence": by_id[i]["confidence"]}
        for i in ids if i in by_id
    ]


if __name__ == "__main__":
    print(json.dumps(lookup_evidence("takeaway_cups"), indent=2))
    print(sources_for(["EV-002", "EV-999"]))
