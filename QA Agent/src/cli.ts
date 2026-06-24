import { loadCases, filterCases } from "./cases/loadCases.js";
import { buildSetupPlan } from "./core/setupPlan.js";
import { loadRuntimeConfig } from "./runtime/config.js";
import { runCases } from "./runner/runCases.js";

interface ParsedArgs {
  command: string;
  release: string;
  caseIds: string[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
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

  if (!command || !release) {
    throw new Error(
      "Usage: npm run qa -- <list|plan|run> <RELEASE> [--case <STABLE_ID> ...]"
    );
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
