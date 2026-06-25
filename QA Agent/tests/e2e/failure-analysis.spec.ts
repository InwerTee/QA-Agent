import { expect, test } from "@playwright/test";
import { analyzeRunFailures } from "../../src/reporting/failureAnalysis.js";
import { formatMarkdownReport, summarize } from "../../src/reporting/formatReport.js";
import type {
  CaseResult,
  QaStatus,
  RunReport,
  TraceCoverageSummary,
  TraceEntry
} from "../../src/types.js";

test("failure analysis clusters the main agent improvement areas", () => {
  const results = [
    fakeCase("MANUAL_REVIEW", {
      stableId: "R1-TC01",
      actual: "Dynamic runner completed all planned steps, but expected result still needs a stronger assertion strategy."
    }),
    fakeCase("ENV_BLOCKED", {
      stableId: "R1-TC02",
      failureReason: "Missing required environment variable(s): QA_CREATOR_USERNAME."
    }),
    fakeCase("AGENT_BLOCKED", {
      stableId: "R1-TC03",
      failureReason: "Could not find a visible form field labeled \"Online Confirmation\" in the current dialog or page."
    }),
    fakeCase("AGENT_BLOCKED", {
      stableId: "R1-TC04",
      failureReason: "Multiple page elements matched the requested target with similar confidence."
    }),
    fakeCase("SETUP_BLOCKED", {
      stableId: "R1-TC05",
      failureReason: "Dynamic runner cannot safely create or verify this prerequisite yet."
    })
  ];

  const analysis = analyzeRunFailures(results);

  expect(analysis.attention_case_count).toBe(5);
  expect(analysis.clusters.map((cluster) => cluster.category)).toEqual(
    expect.arrayContaining([
      "assertion_gap",
      "env_missing",
      "form_field_resolution",
      "target_ambiguity",
      "setup_data_missing"
    ])
  );
  expect(analysis.next_actions.length).toBeGreaterThan(0);
});

test("markdown report includes failure intelligence section", () => {
  const caseResults = [
    fakeCase("MANUAL_REVIEW", {
      stableId: "R1-TC01",
      actual: "Expected result still needs a stronger assertion strategy."
    }),
    fakeCase("AGENT_BLOCKED", {
      stableId: "R1-TC02",
      failureReason: "Could not find option \"Employee [BA]\"."
    })
  ];
  const report: RunReport = {
    run_id: "R1-test-run",
    release: "R1",
    agent_version: "v0.15.0",
    started_at: "2026-06-25T00:00:00.000Z",
    finished_at: "2026-06-25T00:00:10.000Z",
    case_results: caseResults,
    created_test_data: [],
    summary: summarize(caseResults),
    failure_analysis: analyzeRunFailures(caseResults)
  };

  const markdown = formatMarkdownReport(report);

  expect(markdown).toContain("## Failure Intelligence");
  expect(markdown).toContain("Expected result assertion gap");
  expect(markdown).toContain("Dropdown or option resolution gap");
});

function fakeCase(
  status: QaStatus,
  options: {
    stableId: string;
    actual?: string;
    failureReason?: string;
  }
): CaseResult {
  return {
    run_id: "R1-test-run",
    case_execution_id: `R1-test-run:${options.stableId}`,
    stable_id: options.stableId,
    title: "Generic case",
    status,
    result_confidence: status === "MANUAL_REVIEW" ? "low" : "medium",
    classification_reason: options.actual,
    precondition_result: "Precondition checked.",
    actual_result: options.actual ?? options.failureReason ?? "Actual result.",
    expected_result: ["Expected result."],
    failure_reason: options.failureReason,
    evidence_path: "evidence.png",
    created_test_data: [],
    depends_on_data: [],
    notes: [],
    traceability: {
      source_workbook: "/tmp/paragon.xlsx",
      source_sheet: "Sheet1",
      source_row: 2,
      raw_test_case: "Generic case",
      raw_pre_requisite: "Precondition.",
      raw_test_steps: "Steps.",
      raw_expected_result: "Expected.",
      contract_id: `${options.stableId}.dynamic.v0.15.0`,
      precondition_trace: [],
      step_trace: traceEntries(options.failureReason),
      expected_trace: traceEntries(options.actual),
      coverage_summary: partialCoverage(),
      alignment_notes: []
    }
  };
}

function traceEntries(value?: string): TraceEntry[] {
  if (!value) return [];

  return [
    {
      source_type: "test_step",
      source_index: 1,
      source_text: "Original step.",
      coverage: "not_covered",
      actual_check: value,
      notes: []
    }
  ];
}

function partialCoverage(): TraceCoverageSummary {
  return {
    covered: 0,
    partially_covered: 1,
    not_covered: 1,
    not_executed: 0
  };
}
