import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { executeCommand, toPlaywrightCliArgs } from "../commands/playwrightCli.mjs";
import { validatePlan } from "../commands/schema.mjs";

export async function runPlan(plan, options = {}) {
  const validation = validatePlan(plan);
  if (!validation.ok) {
    throw new Error(`Plan validation failed:\n${validation.errors.map((item) => `- ${item}`).join("\n")}`);
  }

  const startedAt = new Date().toISOString();
  const runId = `${safePart(plan.case_id)}-${startedAt.replace(/[:.]/g, "-")}`;
  const outDir = path.resolve(options.outDir ?? path.join("reports", runId));
  await mkdir(outDir, { recursive: true });

  const events = [];
  for (const command of plan.commands) {
    const event = await runOneCommand(command, {
      execute: Boolean(options.execute),
      cwd: options.cwd
    });
    events.push({
      id: command.id,
      type: command.type,
      source: command.source,
      safety: command.safety,
      expected_observation: command.expected_observation,
      result: event
    });

    if (event.status === "error" || event.status === "blocked") {
      break;
    }
  }

  const result = {
    version: "qa_agent_ai_run.v1",
    run_id: runId,
    case_id: plan.case_id,
    mode: options.execute ? "execute" : "dry_run",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    plan_status: plan.status,
    command_count: plan.commands.length,
    executed_event_count: events.length,
    events,
    final_assertions: plan.final_assertions,
    files: {
      run_dir: outDir
    }
  };

  const resultPath = path.join(outDir, "run-result.json");
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  return {
    result,
    resultPath
  };
}

async function runOneCommand(command, options) {
  try {
    const argv = toPlaywrightCliArgs(command);
    const event = await executeCommand(command, options);
    return {
      ...event,
      argv: event.argv ?? (argv ? [process.env.PLAYWRIGHT_CLI_COMMAND || "playwright-cli", ...argv] : undefined)
    };
  } catch (error) {
    return {
      status: "error",
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error)
    };
  }
}

function safePart(value) {
  return String(value || "run").replace(/[^a-z0-9._-]+/gi, "_");
}
