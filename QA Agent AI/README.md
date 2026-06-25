# Gro QA Agent AI

Experimental branch for a more agentic QA runner.

This folder intentionally does not replace `../QA Agent`. The existing project remains the conservative local runner. This project explores a different architecture:

```text
PRD + one test case
  -> OpenAI planner
  -> guarded execution plan
  -> playwright-cli command loop
  -> snapshots / evidence
  -> actual vs expected result
```

## Current Goal

v0.1 is not a full Excel runner. It is a controlled prototype for one test case at a time.

The first thing to prove:

1. Can the model turn a Paragon test case into a traceable execution plan?
2. Can every planned action map back to the original case text?
3. Can browser commands be restricted to a safe allowlist?
4. Can we keep a useful audit trail before we try larger automation?

## Why This Exists

The previous runner became complex because it tried to be both:

- a stable product runner, and
- a live exploratory browser agent.

This project separates those concerns. The AI flow is allowed to explore, but every command must pass through explicit rules before execution.

## Quick Start

Dry-run a sample plan without calling OpenAI:

```bash
npm run demo
```

Plan with OpenAI:

```bash
OPENAI_API_KEY=... npm run plan -- \
  --case examples/single-case.json \
  --prd examples/prd-summary.md \
  --out reports/plan.json
```

Run planned commands in dry-run mode:

```bash
npm run run -- --plan reports/plan.json
```

Execute allowed `playwright-cli` commands:

```bash
npm run run -- --plan reports/plan.json --execute
```

Execution is intentionally opt-in. Without `--execute`, the runner only prints commands.

## Architecture

- `skills/gro-qa-agent-ai/SKILL.md` defines the operating rules for the AI planner.
- `src/llm/openaiResponses.mjs` calls the OpenAI Responses API when `OPENAI_API_KEY` is present.
- `src/commands/schema.mjs` validates the model's proposed commands.
- `src/commands/playwrightCli.mjs` executes only allowed `playwright-cli` commands.
- `src/runner/runSingleCase.mjs` runs a plan step by step and records evidence.

## Safety Rules

- The original test case is the authority.
- PRD context can clarify, but cannot invent a new test objective.
- Every browser command must trace to a source step or expected result.
- The runner starts in dry-run mode.
- Destructive operations are not allowed in v0.1.
- Unknown actions are blocked, not guessed.

## Relationship To The Existing Runner

Use `../QA Agent` when you need the current local web runner and Excel output.

Use this project when exploring whether an OpenAI-planned command loop can produce better page understanding and reusable QA recipes.
