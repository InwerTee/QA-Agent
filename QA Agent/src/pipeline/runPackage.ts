import path from "node:path";
import { filterCases, loadCasesFromFile } from "../cases/loadCases.js";
import {
  exportResultsToWorkbook,
  type ExportResultsResult
} from "../export/exportResults.js";
import {
  prepareInputPackage,
  type PrepareResult
} from "../ingestion/prepareInputPackage.js";
import { loadRuntimeConfig } from "../runtime/config.js";
import { runCases } from "../runner/runCases.js";
import { triageRelease, type TriageResult } from "../triage/triageCases.js";
import type { AutomationMap, CaseTriage, NormalizedCase, RunReport } from "../types.js";

export interface RunPackageOptions {
  release?: string;
  outDir?: string;
  caseIds?: string[];
}

export interface RunPackageResult {
  release: string;
  inputDir: string;
  prepared: PrepareResult;
  triage: TriageResult;
  selectedCaseIds: string[];
  processedCaseIds: string[];
  report: RunReport;
  reportJsonPath: string;
  reportMarkdownPath: string;
  filledWorkbookPath: string;
  resultMappingPath: string;
  exportResult: ExportResultsResult;
}

export async function runInputPackage(
  inputDir: string,
  options: RunPackageOptions = {}
): Promise<RunPackageResult> {
  const prepared = await prepareInputPackage(inputDir, {
    release: options.release,
    outDir: options.outDir
  });
  const cases = await loadCasesFromFile(prepared.casesPath);
  const triage = await triageRelease(prepared.release, cases, { outDir: prepared.outDir });
  const selectedCases = selectCasesForPackageRun(cases, options.caseIds);

  if (selectedCases.length === 0) {
    throw new Error("No test cases were found for this input package.");
  }

  const runResult = await runCases(prepared.release, selectedCases, loadRuntimeConfig());
  const exportResult = await exportResultsToWorkbook(runResult.jsonPath);

  return {
    release: prepared.release,
    inputDir: path.resolve(inputDir),
    prepared,
    triage,
    selectedCaseIds: selectedCases.map((testCase) => testCase.stable_id),
    processedCaseIds: selectedCases.map((testCase) => testCase.stable_id),
    report: runResult.report,
    reportJsonPath: runResult.jsonPath,
    reportMarkdownPath: runResult.markdownPath,
    filledWorkbookPath: exportResult.outputWorkbookPath,
    resultMappingPath: exportResult.mappingPath,
    exportResult
  };
}

export function selectCasesForPackageRun(
  cases: NormalizedCase[],
  requestedCaseIds: string[] = []
): NormalizedCase[] {
  if (requestedCaseIds.length > 0) {
    return filterCases(cases, requestedCaseIds);
  }

  return [...cases].sort((left, right) => left.source_row - right.source_row);
}

export function selectImplementedCases(
  cases: NormalizedCase[],
  automationMap: AutomationMap
): NormalizedCase[] {
  const caseById = new Map(cases.map((testCase) => [testCase.stable_id, testCase]));
  const implemented = automationMap.cases
    .filter((testCase) => testCase.readiness === "implemented")
    .filter((testCase) => testCase.traceability.has_executor_contract)
    .sort(compareRunnableCase);

  return implemented
    .map((testCase) => caseById.get(testCase.stable_id))
    .filter((testCase): testCase is NormalizedCase => Boolean(testCase));
}

function compareRunnableCase(left: CaseTriage, right: CaseTriage): number {
  return (
    (left.main_flow_order ?? 999) - (right.main_flow_order ?? 999) ||
    left.traceability.source_row - right.traceability.source_row ||
    left.stable_id.localeCompare(right.stable_id)
  );
}
