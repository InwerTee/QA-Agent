import { loadCases, filterCases } from "./cases/loadCases.js";
import { buildSetupPlan } from "./core/setupPlan.js";
import { exportResultsToWorkbook } from "./export/exportResults.js";
import { prepareInputPackage } from "./ingestion/prepareInputPackage.js";
import { loadRuntimeConfig } from "./runtime/config.js";
import { runCases } from "./runner/runCases.js";
import { triageRelease } from "./triage/triageCases.js";

type ParsedArgs = PrepareArgs | TriageArgs | ExportResultsArgs | CaseCommandArgs;

interface PrepareArgs {
  command: "prepare";
  inputDir: string;
  release?: string;
  outDir?: string;
}

interface TriageArgs {
  command: "triage";
  release: string;
  outDir?: string;
}

interface ExportResultsArgs {
  command: "export-results";
  reportPath: string;
  sourceWorkbook?: string;
  outPath?: string;
  mappingPath?: string;
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

  if (args.command === "export-results") {
    const result = await exportResultsToWorkbook(args.reportPath, {
      sourceWorkbook: args.sourceWorkbook,
      outPath: args.outPath,
      mappingPath: args.mappingPath
    });
    console.log(`Filled workbook: ${result.outputWorkbookPath}`);
    console.log(`Result mapping: ${result.mappingPath}`);
    console.log(
      JSON.stringify(
        {
          run_id: result.mapping.run_id,
          release: result.mapping.release,
          filled_cases: result.mapping.cases.length,
          result_column_by_sheet: result.mapping.result_column_by_sheet
        },
        null,
        2
      )
    );
    return;
  }

  const allCases = await loadCases(args.release);

  if (args.command === "triage") {
    const result = await triageRelease(args.release, allCases, { outDir: args.outDir });
    console.log(`Triaged ${result.automationMap.total_cases} case(s) for ${result.release}`);
    console.log(`Automation map: ${result.automationMapPath}`);
    console.log(`Triage report: ${result.reportPath}`);
    console.log(JSON.stringify(result.automationMap.summary, null, 2));
    return;
  }

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

  if (command === "export-results") {
    return parseExportResultsArgs(release, rest);
  }

  if (!command || !release) {
    throw new Error(
      "Usage: npm run qa -- <prepare|triage|export-results|list|plan|run> ..."
    );
  }

  if (command === "triage") {
    return parseTriageArgs(release, rest);
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

function parseTriageArgs(release: string | undefined, rest: string[]): TriageArgs {
  if (!release) {
    throw new Error("Usage: npm run qa -- triage <RELEASE> [--out <OUTPUT_DIR>]");
  }

  let outDir: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (token === "--out") {
      outDir = readNextArg(rest, index, "--out");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return { command: "triage", release, outDir };
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

function parseExportResultsArgs(
  reportPath: string | undefined,
  rest: string[]
): ExportResultsArgs {
  if (!reportPath) {
    throw new Error(
      "Usage: npm run qa -- export-results <report-json> [--source-workbook <XLSX>] [--out <XLSX>] [--mapping-out <JSON>]"
    );
  }

  let sourceWorkbook: string | undefined;
  let outPath: string | undefined;
  let mappingPath: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (token === "--source-workbook") {
      sourceWorkbook = readNextArg(rest, index, "--source-workbook");
      index += 1;
      continue;
    }

    if (token === "--out") {
      outPath = readNextArg(rest, index, "--out");
      index += 1;
      continue;
    }

    if (token === "--mapping-out") {
      mappingPath = readNextArg(rest, index, "--mapping-out");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return { command: "export-results", reportPath, sourceWorkbook, outPath, mappingPath };
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
