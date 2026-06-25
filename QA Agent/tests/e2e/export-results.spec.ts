import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import {
  deriveFilledStatus,
  exportResultsToWorkbook
} from "../../src/export/exportResults.js";
import type { CaseResult, QaStatus, RunReport, TraceCoverageSummary } from "../../src/types.js";

const require = createRequire(import.meta.url);
const XlsxPopulate = require("xlsx-populate") as {
  fromBlankAsync(): Promise<TestWorkbook>;
  fromFileAsync(filePath: string): Promise<TestWorkbook>;
};

interface TestWorkbook {
  sheet(name: string): TestWorksheet;
  toFileAsync(filePath: string): Promise<void>;
}

interface TestWorksheet {
  cell(rowNumber: number, columnNumber: number): TestCell;
}

interface TestCell {
  value(): unknown;
  value(value: unknown): TestCell;
}

test("filled result status separates execution pass from full coverage", () => {
  expect(deriveFilledStatus(fakeCase("PASS", fullCoverage()))).toBe("Passed");
  expect(deriveFilledStatus(fakeCase("PASS", partialCoverage()))).toBe("Partial");
  expect(deriveFilledStatus(fakeCase("PRODUCT_BUG", fullCoverage()))).toBe("Failed");
  expect(deriveFilledStatus(fakeCase("SCRIPT_BLOCKED", fullCoverage()))).toBe("Blocked");
  expect(deriveFilledStatus(fakeCase("MANUAL_REVIEW", fullCoverage()))).toBe("Review");
});

test("export-results fills one Agent Result column in a copied workbook", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "qa-export-results-"));
  const workbookPath = path.join(tempDir, "paragon.xlsx");
  const reportPath = path.join(tempDir, "report.json");

  const workbook = await XlsxPopulate.fromBlankAsync();
  const sheet = workbook.sheet("Sheet1");
  sheet.cell(1, 1).value("No");
  sheet.cell(1, 2).value("Test Case");
  sheet.cell(1, 3).value("Expected Result");
  sheet.cell(2, 1).value("1");
  sheet.cell(2, 2).value("Create Master Campaign with All Fields");
  sheet.cell(2, 3).value("Created");
  sheet.cell(3, 1).value("2");
  sheet.cell(3, 2).value("Edit Basic Information Only");
  sheet.cell(3, 3).value("Edited");
  await workbook.toFileAsync(workbookPath);

  const report: RunReport = {
    run_id: "R6-test-run",
    release: "R6",
    started_at: "2026-06-25T00:00:00.000Z",
    finished_at: "2026-06-25T00:00:10.000Z",
    case_results: [
      fakeCase("PASS", fullCoverage(), {
        stableId: "R6-B7.2-TC01",
        row: 2,
        workbookPath,
        rawTestCase: "Create Master Campaign with All Fields"
      }),
      fakeCase("PASS", partialCoverage(), {
        stableId: "R6-B7.3-TC01",
        row: 3,
        workbookPath,
        rawTestCase: "Edit Basic Information Only"
      })
    ],
    created_test_data: [],
    summary: emptySummary()
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const result = await exportResultsToWorkbook(reportPath);
  const filledWorkbook = await XlsxPopulate.fromFileAsync(result.outputWorkbookPath);
  const filledSheet = filledWorkbook.sheet("Sheet1");
  const mapping = JSON.parse(await readFile(result.mappingPath, "utf8")) as {
    cases: Array<{
      run_id: string;
      case_execution_id: string;
      stable_id: string;
      final_filled_status: string;
      filled_cell: string;
    }>;
    result_column_by_sheet: Record<string, string>;
  };

  expect(filledSheet.cell(1, 4).value()).toBe("Agent Result");
  expect(filledSheet.cell(2, 4).value()).toBe("Passed");
  expect(filledSheet.cell(3, 4).value()).toBe("Partial");
  expect(mapping.result_column_by_sheet.Sheet1).toBe("D");
  expect(mapping.cases).toEqual([
    expect.objectContaining({
      run_id: "R6-test-run",
      case_execution_id: "R6-test-run:R6-B7.2-TC01",
      stable_id: "R6-B7.2-TC01",
      final_filled_status: "Passed",
      filled_cell: "Sheet1!D2"
    }),
    expect.objectContaining({
      run_id: "R6-test-run",
      case_execution_id: "R6-test-run:R6-B7.3-TC01",
      stable_id: "R6-B7.3-TC01",
      final_filled_status: "Partial",
      filled_cell: "Sheet1!D3"
    })
  ]);
});

function fakeCase(
  status: QaStatus,
  coverage: TraceCoverageSummary,
  options: {
    stableId?: string;
    row?: number;
    workbookPath?: string;
    rawTestCase?: string;
  } = {}
): CaseResult {
  const stableId = options.stableId ?? "R6-B7.2-TC01";
  const rawTestCase = options.rawTestCase ?? "Create Master Campaign with All Fields";

  return {
    run_id: "R6-test-run",
    case_execution_id: `R6-test-run:${stableId}`,
    stable_id: stableId,
    title: rawTestCase,
    status,
    precondition_result: "Precondition checked.",
    actual_result: "Actual result.",
    expected_result: ["Expected result."],
    failure_reason: status === "PRODUCT_BUG" ? "Mismatch." : undefined,
    evidence_path: "evidence.png",
    created_test_data: [],
    depends_on_data: [],
    notes: [],
    traceability: {
      source_workbook: options.workbookPath ?? "/tmp/paragon.xlsx",
      source_sheet: "Sheet1",
      source_row: options.row ?? 2,
      raw_test_case: rawTestCase,
      raw_pre_requisite: "Precondition.",
      raw_test_steps: "Steps.",
      raw_expected_result: "Expected.",
      contract_id: `${stableId}.contract`,
      precondition_trace: [],
      step_trace: [],
      expected_trace: [],
      coverage_summary: coverage,
      alignment_notes: []
    }
  };
}

function fullCoverage(): TraceCoverageSummary {
  return {
    covered: 3,
    partially_covered: 0,
    not_covered: 0,
    not_executed: 0
  };
}

function partialCoverage(): TraceCoverageSummary {
  return {
    covered: 2,
    partially_covered: 1,
    not_covered: 1,
    not_executed: 0
  };
}

function emptySummary(): Record<QaStatus, number> {
  return {
    PASS: 0,
    PRODUCT_BUG: 0,
    SETUP_BLOCKED: 0,
    SCRIPT_BLOCKED: 0,
    ENV_BLOCKED: 0,
    MANUAL_REVIEW: 0
  };
}
