#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { planWithOpenAI } from "./llm/openaiResponses.mjs";
import { validatePlan } from "./commands/schema.mjs";
import { runPlan } from "./runner/runSingleCase.mjs";

const command = process.argv[2] ?? "help";
const args = parseArgs(process.argv.slice(3));

try {
  if (command === "plan") {
    await planCommand(args);
  } else if (command === "run") {
    await runCommand(args);
  } else if (command === "check") {
    await checkCommand(args);
  } else {
    printHelp();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function planCommand(options) {
  const casePath = requiredOption(options.case, "--case");
  const prdPath = requiredOption(options.prd, "--prd");
  const outPath = path.resolve(options.out ?? "reports/plan.json");
  const caseData = JSON.parse(await readFile(path.resolve(casePath), "utf8"));
  const prdText = await readFile(path.resolve(prdPath), "utf8");
  const plan = await planWithOpenAI({ caseData, prdText, offline: Boolean(options.offline) });
  const validation = validatePlan(plan);

  if (!validation.ok) {
    throw new Error(`Planner returned an invalid plan:\n${validation.errors.map((item) => `- ${item}`).join("\n")}`);
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  console.log(`Plan written: ${outPath}`);
  console.log(`Status: ${plan.status}`);
  console.log(`Commands: ${plan.commands.length}`);
}

async function runCommand(options) {
  const planPath = requiredOption(options.plan, "--plan");
  const plan = JSON.parse(await readFile(path.resolve(planPath), "utf8"));
  const { resultPath, result } = await runPlan(plan, {
    execute: Boolean(options.execute),
    outDir: options.out
  });

  console.log(`Run result written: ${resultPath}`);
  console.log(`Mode: ${result.mode}`);
  console.log(`Events: ${result.executed_event_count}/${result.command_count}`);
}

async function checkCommand(options) {
  const planPath = options.plan;
  if (!planPath) {
    console.log("QA Agent AI check passed. No plan file provided.");
    return;
  }

  const plan = JSON.parse(await readFile(path.resolve(planPath), "utf8"));
  const validation = validatePlan(plan);
  if (!validation.ok) {
    throw new Error(`Plan validation failed:\n${validation.errors.map((item) => `- ${item}`).join("\n")}`);
  }
  console.log("Plan validation passed.");
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;

    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }

  return parsed;
}

function requiredOption(value, name) {
  if (!value || value === true) {
    throw new Error(`Missing required option ${name}.`);
  }
  return value;
}

function printHelp() {
  console.log(`
Gro QA Agent AI

Commands:
  npm run plan -- --case examples/single-case.json --prd examples/prd-summary.md --out reports/plan.json
  npm run run -- --plan reports/plan.json
  npm run run -- --plan reports/plan.json --execute
  npm run check -- --plan reports/plan.json
`);
}
