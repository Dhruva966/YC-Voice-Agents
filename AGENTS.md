# Forge — AGENTS.md

Canonical reference: **[CLAUDE.md](CLAUDE.md)** — read it first and in full.

This is a thin adapter for Codex and other non-Claude AI coding agents. Do not duplicate project policy here: architecture, data contracts, security rules, testing standards, task patterns, environment variables, and API surface all live in CLAUDE.md.

---

## How To Load Context

1. Read CLAUDE.md first.
2. If editing an interface boundary, read HANDOFF.md.
3. If editing a subsystem, read only that subsystem's `CLAUDE.md`:
   - `forge/api/CLAUDE.md`
   - `forge/pipeline/CLAUDE.md`
   - `forge/ingestion/CLAUDE.md`
   - `forge/vanguard/CLAUDE.md`
4. Use README.md and DEPLOYMENT.md for operator-facing setup context.

---

## Capability Routing

Map the capability tiers in CLAUDE.md to the current agent instead of using Claude model names literally. For Codex, use the default coding model for routine work and the strongest available reasoning effort/model for architecture, root-cause, security, deployment, data-loss, or multi-system changes.

---

## Codex Agent Stubs

```toml
[agents.implementer]
description = "Implement a single task. Read CLAUDE.md and the relevant subsystem CLAUDE.md first. Verify output matches the spec exactly — do not summarize."
model = "default"

[agents.spec-reviewer]
description = "Verify implementation matches spec. Read the actual code — do not trust the implementer's report. Check: correct files modified, no extra changes, edge cases handled."
model = "default"

[agents.quality-reviewer]
description = "Verify implementation is clean, tested, and maintainable. Check: no inline prompts (all prompts in prompts.py), no raw boto3 (use storage shim), no hardcoded values, tests exist."
model = "default"

[agents.transcript-scorer-agent]
description = "Score and select best transcript segments. Use NVIDIA NIM for scoring. Return top-K turns per dimension as NVIDIA NIM finetune JSONL."
model = "default"

[agents.vanguard-analyst]
description = "Analyze a Vanguard run result. Identify failure patterns per persona. Propose harder attack variants for the next cycle."
model = "default"
```

---

## Workflow Mapping

Use these as intent mappings, not literal slash commands unless the current tool supports them.

| Trigger | Skill | Phase |
|---------|-------|-------|
| New feature idea | office-hours | Ideation |
| Starting feature | writing-plans | Planning |
| Multi-file work | parallel-agent-coordination when delegation is useful | Implement |
| Parallel tasks | source-command-parallel-agents / using-git-worktrees | Implement |
| Pre-PR | review + qa | Review |
| Security check | security-review | Review |
| Health check | health/validation check | Review |
| Shipping | ship / land-and-deploy equivalent | Release |
| Post-deploy | canary/monitor equivalent | Release |
| Weekly | retro + learn equivalent | Reflect |
| Save context | context-save | Any |
