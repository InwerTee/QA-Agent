import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type {
  CaseResult,
  QaStatus,
  RunReport,
  TraceCoverageSummary
} from "../types.js";

const require = createRequire(import.meta.url);
const XlsxPopulate = require("xlsx-populate") as XlsxPopulateModule;

export type FilledResultStatus =
  | "Passed"
  | "Partial"
  | "Failed"
  | "Setup Blocked"
  | "Agent Blocked"
  | "Script Blocked"
  | "Env Blocked"
  | "Review";

export interface ExportResultsOptions {
  sourceWorkbook?: string;
  outPath?: string;
  mappingPath?: string;
}

export interface ExportResultsResult {
  outputWorkbookPath: string;
  mappingPath: string;
  mapping: ResultMapping;
}

export interface ResultMapping {
  run_id: string;
  release: string;
  source_workbook: string;
  output_workbook: string;
  result_column_by_sheet: Record<string, string>;
  cases: ResultMappingCase[];
}

export interface ResultMappingCase {
  run_id: string;
  case_execution_id: string;
  stable_id: string;
  source_sheet: string;
  source_row: number;
  raw_test_case: string;
  run_status: QaStatus;
  coverage_summary: TraceCoverageSummary;
  final_filled_status: FilledResultStatus;
  actual_result: string;
  failure_reason?: string;
  evidence_path?: string;
  filled_cell: string;
}

interface XlsxPopulateModule {
  fromFileAsync(filePath: string): Promise<Workbook>;
}

interface Workbook {
  sheet(name: string): Worksheet | undefined;
  toFileAsync(filePath: string): Promise<void>;
}

interface Worksheet {
  name(): string;
  usedRange(): Range | undefined;
  cell(rowNumber: number, columnNumber: number): Cell;
}

interface Range {
  forEach(callback: (cell: Cell) => void): void;
}

interface Cell {
  address(): string;
  columnNumber(): number;
  rowNumber(): number;
  value(): unknown;
  value(value: unknown): Cell;
}

export async function exportResultsToWorkbook(
  reportPath: string,
  options: ExportResultsOptions = {}
): Promise<ExportResultsResult> {
  const resolvedReportPath = path.resolve(reportPath);
  const report = await readReport(resolvedReportPath);
  const runDir = path.dirname(resolvedReportPath);
  const sourceWorkbook = resolveSourceWorkbook(report, options.sourceWorkbook);
  const outputWorkbookPath =
    options.outPath ??
    path.join(runDir, `${sanitizeFilePart(report.release)}.agent-filled.xlsx`);
  const mappingPath = options.mappingPath ?? path.join(runDir, "result_mapping.json");

  const workbook = await XlsxPopulate.fromFileAsync(sourceWorkbook);
  const casesBySheet = groupCasesBySheet(report.case_results);
  const resultColumnBySheet: Record<string, string> = {};
  const mappingCases: ResultMappingCase[] = [];

  for (const [sheetName, caseResults] of casesBySheet) {
    const sheet = workbook.sheet(sheetName);
    if (!sheet) {
      throw new Error(`Source workbook does not contain sheet "${sheetName}".`);
    }

    const resultColumn = findContentMaxColumn(sheet) + 1;
    const headerRow = findHeaderRow(sheet, caseResults);
    const headerCell = sheet.cell(headerRow, resultColumn);
    headerCell.value("Agent Result");
    resultColumnBySheet[sheetName] = columnName(resultColumn);

    for (const caseResult of caseResults) {
      const finalStatus = deriveFilledStatus(caseResult);
      const resultCell = sheet.cell(caseResult.traceability.source_row, resultColumn);
      resultCell.value(finalStatus);
      mappingCases.push({
        run_id: caseResult.run_id,
        case_execution_id: caseResult.case_execution_id,
        stable_id: caseResult.stable_id,
        source_sheet: sheetName,
        source_row: caseResult.traceability.source_row,
        raw_test_case: caseResult.traceability.raw_test_case,
        run_status: caseResult.status,
        coverage_summary: caseResult.traceability.coverage_summary,
        final_filled_status: finalStatus,
        actual_result: caseResult.actual_result,
        failure_reason: caseResult.failure_reason,
        evidence_path: caseResult.evidence_path,
        filled_cell: `${sheetName}!${resultCell.address()}`
      });
    }
  }

  await mkdir(path.dirname(outputWorkbookPath), { recursive: true });
  await workbook.toFileAsync(outputWorkbookPath);

  const mapping: ResultMapping = {
    run_id: report.run_id,
    release: report.release,
    source_workbook: sourceWorkbook,
    output_workbook: outputWorkbookPath,
    result_column_by_sheet: resultColumnBySheet,
    cases: mappingCases
  };

  await writeFile(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");

  return { outputWorkbookPath, mappingPath, mapping };
}

export function deriveFilledStatus(caseResult: CaseResult): FilledResultStatus {
  switch (caseResult.status) {
    case "PASS":
      return hasFullCoverage(caseResult.traceability.coverage_summary) ? "Passed" : "Partial";
    case "PRODUCT_BUG":
      return "Failed";
    case "SETUP_BLOCKED":
      return "Setup Blocked";
    case "AGENT_BLOCKED":
      return "Agent Blocked";
    case "SCRIPT_BLOCKED":
      return "Script Blocked";
    case "ENV_BLOCKED":
      return "Env Blocked";
    case "MANUAL_REVIEW":
      return "Review";
  }
}

async function readReport(reportPath: string): Promise<RunReport> {
  const content = await readFile(reportPath, "utf8");
  return JSON.parse(content) as RunReport;
}

function resolveSourceWorkbook(report: RunReport, override?: string): string {
  if (override) {
    return path.resolve(override);
  }

  const sourceWorkbooks = new Set(
    report.case_results.map((caseResult) => caseResult.traceability.source_workbook)
  );

  if (sourceWorkbooks.size === 0) {
    throw new Error("Report does not include any source workbook references.");
  }

  if (sourceWorkbooks.size > 1) {
    throw new Error(
      `export-results currently supports one source workbook per export; found: ${Array.from(
        sourceWorkbooks
      ).join(", ")}`
    );
  }

  return path.resolve(Array.from(sourceWorkbooks)[0]);
}

function groupCasesBySheet(caseResults: CaseResult[]): Map<string, CaseResult[]> {
  const bySheet = new Map<string, CaseResult[]>();

  for (const caseResult of caseResults) {
    const sheetName = caseResult.traceability.source_sheet;
    const existing = bySheet.get(sheetName) ?? [];
    existing.push(caseResult);
    bySheet.set(sheetName, existing);
  }

  for (const cases of bySheet.values()) {
    cases.sort((left, right) => left.traceability.source_row - right.traceability.source_row);
  }

  return bySheet;
}

function findContentMaxColumn(sheet: Worksheet): number {
  const usedRange = sheet.usedRange();
  let maxColumn = 0;

  usedRange?.forEach((cell) => {
    if (hasCellContent(cell.value())) {
      maxColumn = Math.max(maxColumn, cell.columnNumber());
    }
  });

  if (maxColumn === 0) {
    throw new Error(`Sheet "${sheet.name()}" has no content.`);
  }

  return maxColumn;
}

function findHeaderRow(sheet: Worksheet, caseResults: CaseResult[]): number {
  const firstCaseRow = Math.min(
    ...caseResults.map((caseResult) => caseResult.traceability.source_row)
  );
  const usedRange = sheet.usedRange();
  let headerRow = Math.max(1, firstCaseRow - 1);

  usedRange?.forEach((cell) => {
    const rowNumber = cell.rowNumber();
    if (rowNumber >= firstCaseRow || rowNumber < 1) return;

    const value = cellText(cell.value()).toLowerCase();
    if (value === "test case") {
      headerRow = rowNumber;
    }
  });

  return headerRow;
}

function hasFullCoverage(summary: TraceCoverageSummary): boolean {
  return (
    summary.partially_covered === 0 &&
    summary.not_covered === 0 &&
    summary.not_executed === 0
  );
}

function hasCellContent(value: unknown): boolean {
  return cellText(value).trim().length > 0;
}

function cellText(value: unknown): string {
  if (value == null) return "";

  if (typeof value === "object") {
    const richText = value as { text?: () => string };
    if (typeof richText.text === "function") {
      return richText.text();
    }
  }

  return String(value);
}

function columnName(columnNumber: number): string {
  let remaining = columnNumber;
  let name = "";

  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    remaining = Math.floor((remaining - modulo) / 26);
  }

  return name;
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_");
}
