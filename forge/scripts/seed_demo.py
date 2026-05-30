"""Seed demo personality spec.

Writes a default personality_spec.json so the dashboard build pipeline
has something to show before a real build runs.

Usage:
    python scripts/seed_demo.py

Output goes to ./local_data/demo/personality/personality_spec.json
"""
import json
from pathlib import Path


def main():
    spec_path = Path("./local_data/demo/personality/personality_spec.json")
    spec_path.parent.mkdir(parents=True, exist_ok=True)
    spec_path.write_text(json.dumps({
        "communication_style": {
            "avg_sentence_length": "medium",
            "formality": 0.6,
            "directness": 0.8,
            "hedging_frequency": "low",
            "humor_style": "dry",
            "filler_words": [],
        },
        "vocabulary": {
            "signature_phrases": [],
            "words_never_used": [],
            "technical_domains": ["voice AI", "adversarial testing", "LLM evaluation"],
        },
        "opinion_fingerprints": [
            {"topic": "voice agent safety", "stance": "non-negotiable before production", "confidence": "strong"},
            {"topic": "LLM red-teaming", "stance": "automated and continuous", "confidence": "strong"},
        ],
        "knowledge_domains": [{"domain": "voice AI", "confidence_level": "expert"}],
        "response_tendencies": {
            "asks_clarifying_questions": False,
            "gives_opinions_unprompted": True,
            "uses_analogies_often": False,
            "typical_response_length": "brief",
        },
    }, indent=2))
    print("Forge seeded: default personality spec written to local_data/demo/. Run make build then make vanguard to generate real improvement data.")


if __name__ == "__main__":
    main()
