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
  const selectedCases = selectCasesForPackageRun(cases, options.caseIds, triage.automationMap);

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
  requestedCaseIds: string[] = [],
  automationMap?: AutomationMap
): NormalizedCase[] {
  if (requestedCaseIds.length > 0) {
    return filterCases(cases, requestedCaseIds);
  }

  return sortCasesForExecution(cases, automationMap);
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

function sortCasesForExecution(
  cases: NormalizedCase[],
  automationMap?: AutomationMap
): NormalizedCase[] {
  const caseById = new Map(cases.map((testCase) => [testCase.stable_id, testCase]));
  const triageById = new Map(
    (automationMap?.cases ?? []).map((testCase) => [testCase.stable_id, testCase])
  );
  const remaining = new Set(cases.map((testCase) => testCase.stable_id));
  const sorted: NormalizedCase[] = [];

  while (remaining.size > 0) {
    const ready = Array.from(remaining)
      .map((id) => caseById.get(id)!)
      .filter((testCase) =>
        testCase.dependencies.every(
          (dependency) => !remaining.has(dependency.stable_id) || !caseById.has(dependency.stable_id)
        )
      )
      .sort((left, right) => compareExecutionCase(left, right, triageById));

    const next = ready[0] ?? caseById.get(Array.from(remaining)[0])!;
    sorted.push(next);
    remaining.delete(next.stable_id);
  }

  return sorted;
}

function compareExecutionCase(
  left: NormalizedCase,
  right: NormalizedCase,
  triageById: Map<string, CaseTriage>
): number {
  const leftTriage = triageById.get(left.stable_id);
  const rightTriage = triageById.get(right.stable_id);

  return (
    (leftTriage?.main_flow_order ?? 999) - (rightTriage?.main_flow_order ?? 999) ||
    left.source_row - right.source_row ||
    left.stable_id.localeCompare(right.stable_id)
  );
}
