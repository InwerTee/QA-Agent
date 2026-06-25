import { loadCases, filterCases } from "./cases/loadCases.js";
import { buildSetupPlan } from "./core/setupPlan.js";
import { prepareInputPackage } from "./ingestion/prepareInputPackage.js";
import { loadRuntimeConfig } from "./runtime/config.js";
import { runCases } from "./runner/runCases.js";

type ParsedArgs = PrepareArgs | CaseCommandArgs;

interface PrepareArgs {
  command: "prepare";
  inputDir: string;
  release?: string;
  outDir?: string;
}

interface CaseCommandArgs {
  command: "list" | "plan" | "run";
  release: string;
  caseIds: string[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "prepare") {
    const result = await prepareInputPackage(args.inputDir, {
      release: args.release,
      outDir: args.outDir
    });
    console.log(`Prepared ${result.caseCount} case(s) for ${result.release} - ${result.title}`);
    console.log(`Cases JSON: ${result.casesPath}`);
    console.log(`Manifest JSON: ${result.manifestPath}`);
    console.log(`Ingestion report: ${result.reportPath}`);
    console.log(JSON.stringify(result.automationSummary, null, 2));
    return;
  }

  const allCases = await loadCases(args.release);
  const selectedCases = filterCases(allCases, args.caseIds);

  if (args.command === "list") {
    for (const testCase of selectedCases) {
      console.log(`${testCase.stable_id}\t${testCase.title}`);
    }
    return;
  }

  if (args.command === "plan") {
    const plans = selectedCases.map(buildSetupPlan);
    console.log(JSON.stringify(plans, null, 2));
    return;
  }

  if (args.command === "run") {
    const result = await runCases(args.release, selectedCases, loadRuntimeConfig());
    console.log(`Report JSON: ${result.jsonPath}`);
    console.log(`Report Markdown: ${result.markdownPath}`);
    console.log(JSON.stringify(result.report.summary, null, 2));
    return;
  }

  throw new Error(`Unsupported command: ${args.command}`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, release, ...rest] = argv;

  if (command === "prepare") {
    return parsePrepareArgs(release, rest);
  }

  if (!command || !release) {
    throw new Error(
      "Usage: npm run qa -- <prepare|list|plan|run> ..."
    );
  }

  if (command !== "list" && command !== "plan" && command !== "run") {
    throw new Error(`Unsupported command: ${command}`);
  }

  const caseIds: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (token === "--case") {
      const id = rest[index + 1];
      if (!id) {
        throw new Error("--case requires a stable case id");
      }
      caseIds.push(id);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return { command, release, caseIds };
}

function parsePrepareArgs(inputDir: string | undefined, rest: string[]): PrepareArgs {
  if (!inputDir) {
    throw new Error(
      "Usage: npm run qa -- prepare <input-package-dir> [--release <RELEASE>] [--out <OUTPUT_DIR>]"
    );
  }

  let release: string | undefined;
  let outDir: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (token === "--release") {
      release = readNextArg(rest, index, "--release");
      index += 1;
      continue;
    }

    if (token === "--out") {
      outDir = readNextArg(rest, index, "--out");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return { command: "prepare", inputDir, release, outDir };
}

function readNextArg(rest: string[], index: number, option: string): string {
  const value = rest[index + 1];
  if (!value) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
