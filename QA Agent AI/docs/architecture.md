# QA Agent AI Architecture

## Decision

This project explores an LLM-command approach instead of extending the old generic dynamic runner.

The existing `../QA Agent` project remains useful as a conservative runner. This project investigates whether a model-led command loop can understand fresh modules faster.

## Proposed Loop

```text
1. Load PRD context and one test case.
2. Read the Gro QA Agent AI skill rules.
3. Ask OpenAI to produce a guarded JSON plan.
4. Validate the plan locally.
5. Execute only allowed commands.
6. Capture snapshots and command outputs.
7. Compare evidence with expected results.
8. Save a traceable run result.
```

## Why Not Let The Model Directly Browse?

Free browsing is hard to audit. It can also drift from the original test case.

This prototype keeps the model in a planner role. The local runner decides whether a proposed command is allowed.

## Why Start With One Case?

Excel-wide execution hides too many problems. A single-case prototype lets us inspect:

- Whether the plan matches the original case.
- Whether the model chooses sensible browser actions.
- Whether the command schema is expressive enough.
- Whether evidence is useful for actual vs expected judgment.

## CLI vs MCP

`playwright-cli` is the first adapter because it is command-oriented, compact, and easy to audit.

Playwright MCP can be added later as an exploration adapter when we need richer persistent browser context or self-healing behavior.

## Current Non-Goals

- No full Excel ingestion in v0.1.
- No final filled workbook in v0.1.
- No destructive data setup.
- No broad autonomous browsing.
- No automatic pass unless every expected result has evidence.
