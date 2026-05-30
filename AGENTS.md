# Forge — AGENTS.md

Canonical reference: **[CLAUDE.md](CLAUDE.md)** — read it first and in full.

This file is an adapter for Codex and other non-Claude AI coding agents. It adds Codex-specific agent stubs and a gstack skill catalog. For architecture, data contracts, security rules, testing standards, task patterns, environment variables, and the complete API surface, see CLAUDE.md.

---

## Model Routing
| Task Type | Model |
|-----------|-------|
| Isolated edits, boilerplate, narrow transforms (1–2 files) | Haiku |
| Feature implementation, multi-file integration, refactors | Sonnet |
| Architecture decisions, root-cause analysis, security review | Opus |

Escalate only when the lower tier fails with a clear reasoning gap.

---

## Quick Orientation

| What | Where |
|------|-------|
| FastAPI app + all routes | `forge/api/main.py` |
| Pipecat voice pipeline | `forge/pipeline/persona_bot.py:run_persona_bot()` |
| All prompts (never inline) | `forge/prompts.py` |
| Storage shim | `forge/storage.py` (never `import boto3` directly) |
| RAG | `forge/rag/retriever.py` |
| Transcript scorer | `forge/ingestion/transcript_scorer.py` |

Three rules that matter most:
1. All prompts in `prompts.py` — never inline LLM strings
2. All storage via `storage.py` shim — never raw `boto3`
3. Long-running work in `BackgroundTasks` — never block the event loop

---

## Subsystem Module Docs

Each subsystem has a module-level `CLAUDE.md` with allowed patterns, forbidden patterns, and what not to do:

| Module | Doc |
|--------|-----|
| API routes | `forge/api/CLAUDE.md` |
| Gemini Live pipeline | `forge/pipeline/CLAUDE.md` |
| Ingestion + transcript scorer | `forge/ingestion/CLAUDE.md` |
| Vanguard adversarial testing | `forge/vanguard/CLAUDE.md` |

---

## Codex Agent Stubs

```toml
[agents.implementer]
description = "Implement a single task. Read CLAUDE.md and the relevant subsystem CLAUDE.md first. Verify output matches the spec exactly — do not summarize."
model = "codex-1"

[agents.spec-reviewer]
description = "Verify implementation matches spec. Read the actual code — do not trust the implementer's report. Check: correct files modified, no extra changes, edge cases handled."
model = "codex-1"

[agents.quality-reviewer]
description = "Verify implementation is clean, tested, and maintainable. Check: no inline prompts (all prompts in prompts.py), no raw boto3 (use storage shim), no hardcoded values, tests exist."
model = "codex-1"

[agents.transcript-scorer-agent]
description = "Score and select best transcript segments. Use NVIDIA NIM for scoring. Return top-K turns per dimension as NVIDIA NIM finetune JSONL."
model = "codex-1"

[agents.vanguard-analyst]
description = "Analyze a Vanguard run result. Identify failure patterns per persona. Propose harder attack variants for the next cycle."
model = "codex-1"
```

---

## Skill Catalog

| Trigger | Skill | Phase |
|---------|-------|-------|
| New feature idea | /office-hours | Ideation |
| Starting feature | /autoplan + writing-plans | Planning |
| Multi-file work | subagent-driven-development | Implement |
| Parallel tasks | using-git-worktrees | Implement |
| Pre-PR | /review + /qa | Review |
| Security check | /cso | Review |
| Health check | /health | Review |
| Shipping | /ship → /land-and-deploy | Release |
| Post-deploy | /canary | Release |
| Weekly | /retro + /learn | Reflect |
| Save context | /context-save | Any |
