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
import { loadPrdKnowledgePack } from "../knowledge/prdKnowledge.js";
import { loadRuntimeConfig } from "../runtime/config.js";
import { runCases, type RunCasesProgress } from "../runner/runCases.js";
import { triageRelease, type TriageResult } from "../triage/triageCases.js";
import type { AutomationMap, CaseTriage, NormalizedCase, RunReport } from "../types.js";

export interface RunPackageOptions {
  release?: string;
  outDir?: string;
  caseIds?: string[];
  caseTimeoutMs?: number;
  onProgress?: (progress: RunPackageProgress) => void;
}

export interface RunPackageProgress {
  phase: "preparing" | "triaging" | "running" | "exporting" | "completed";
  message: string;
  release?: string;
  selectedCaseIds?: string[];
  run?: RunCasesProgress;
}

export interface RunPackageResult {
  release: string;
  inputDir: string;
  prepared: PrepareResult;
  triage: TriageResult;
  prdKnowledgePath: string;
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
  options.onProgress?.({
    phase: "preparing",
    message: "Preparing uploaded PRD and test cases."
  });
  const prepared = await prepareInputPackage(inputDir, {
    release: options.release,
    outDir: options.outDir
  });
  const cases = await loadCasesFromFile(prepared.casesPath);
  const prdKnowledge = await loadPrdKnowledgePack(prepared.prdKnowledgePath);

  options.onProgress?.({
    phase: "triaging",
    release: prepared.release,
    message: `Triaging ${cases.length} parsed case(s).`
  });
  const triage = await triageRelease(prepared.release, cases, {
    outDir: prepared.outDir,
    prdKnowledge
  });
  const selectedCases = selectCasesForPackageRun(cases, options.caseIds, triage.automationMap);

  if (selectedCases.length === 0) {
    throw new Error("No test cases were found for this input package.");
  }

  const selectedCaseIds = selectedCases.map((testCase) => testCase.stable_id);
  options.onProgress?.({
    phase: "running",
    release: prepared.release,
    selectedCaseIds,
    message: `Running ${selectedCases.length} selected case(s).`
  });
  const runResult = await runCases(prepared.release, selectedCases, loadRuntimeConfig(), {
    caseTimeoutMs: options.caseTimeoutMs,
    prdKnowledge,
    onProgress: (run) =>
      options.onProgress?.({
        phase: "running",
        release: prepared.release,
        selectedCaseIds,
        message: run.message,
        run
      })
  });

  options.onProgress?.({
    phase: "exporting",
    release: prepared.release,
    selectedCaseIds,
    run: {
      stage: "completed",
      runId: runResult.report.run_id,
      release: prepared.release,
      total: selectedCases.length,
      completed: runResult.report.case_results.length,
      summary: runResult.report.summary,
      message: "Exporting filled Excel workbook."
    },
    message: "Exporting filled Excel workbook."
  });
  const exportResult = await exportResultsToWorkbook(runResult.jsonPath);

  options.onProgress?.({
    phase: "completed",
    release: prepared.release,
    selectedCaseIds,
    run: {
      stage: "completed",
      runId: runResult.report.run_id,
      release: prepared.release,
      total: selectedCases.length,
      completed: runResult.report.case_results.length,
      summary: runResult.report.summary,
      message: "Run package completed."
    },
    message: "Run package completed."
  });

  return {
    release: prepared.release,
    inputDir: path.resolve(inputDir),
    prepared,
    triage,
    prdKnowledgePath: prepared.prdKnowledgePath,
    selectedCaseIds,
    processedCaseIds: selectedCaseIds,
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
