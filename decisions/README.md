# Forge — Architecture Decision Records

Records of non-obvious architecture choices, with context and reasoning.

**What goes here:**
- Any decision that took more than 5 minutes to make
- Tech stack choices with tradeoffs documented
- Rejected alternatives with reasons

**What does NOT go here:**
- Implementation details (that's code comments or CLAUDE.md)
- Operational procedures (that's DEPLOYMENT.md)

**Format:** `YYYY-MM-DD-short-title.md`. Template:

```markdown
# Decision: [Title]

**Date:** YYYY-MM-DD
**Status:** accepted | superseded | deprecated

## Context
What problem were we solving? What were the constraints?

## Decision
What did we choose?

## Alternatives considered
What else did we evaluate and why did we reject it?

## Consequences
What do we gain? What do we give up?
```

---

## Index

| Date | Decision | Status |
|------|----------|--------|
| 2026-05-29 | Gemini 3.1 Flash Live replaces Deepgram + NVIDIA NIM LLM + ElevenLabs | accepted |
| 2026-05-29 | WebSocket over SIP trunking for Twilio transport | accepted |
| 2026-05-29 | NVIDIA NIM LoRA for fine-tuning (not Vertex AI) | accepted |
| 2026-05-29 | ChromaDB local RAG (not pgvector) for hackathon | accepted |
