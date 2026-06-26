import { expect, test } from "@playwright/test";
import {
  attachPilotOutputs,
  buildPilotCaseOutput
} from "../../src/reporting/pilotOutput.js";
import type { CaseResult, QaStatus, TraceCoverageSummary } from "../../src/types.js";

test("pilot output classifies product, setup, environment, and partial-pass cases", () => {
  expect(buildPilotCaseOutput(fakeCase("PRODUCT_BUG")).category).toBe("product_bug");
  expect(buildPilotCaseOutput(fakeCase("SETUP_BLOCKED")).category).toBe("setup_data_issue");
  expect(buildPilotCaseOutput(fakeCase("ENV_BLOCKED")).category).toBe("environment_issue");
  expect(buildPilotCaseOutput(fakeCase("PASS", partialCoverage())).category).toBe("manual_review_required");
  expect(buildPilotCaseOutput(fakeCase("PASS", fullCoverage())).category).toBe("passed");
});

test("pilot output summarizes category counts for the web UI", () => {
  const { results, summary } = attachPilotOutputs([
    fakeCase("PASS", fullCoverage(), { stableId: "TC01" }),
    fakeCase("PRODUCT_BUG", fullCoverage(), { stableId: "TC02" }),
    fakeCase("AGENT_BLOCKED", fullCoverage(), {
      stableId: "TC03",
      failureReason: "This case has no verified executor/recipe yet."
    })
  ]);

  expect(results[1].pilot_output?.category_label).toBe("Product Bug");
  expect(summary.total_cases).toBe(3);
  expect(summary.attention_case_count).toBe(2);
  expect(summary.by_category.passed).toBe(1);
  expect(summary.by_category.product_bug).toBe(1);
  expect(summary.by_category.recipe_missing).toBe(1);
});

test("pilot output humanizes readiness gate failures for developer-facing output", () => {
  const output = buildPilotCaseOutput(fakeCase("MANUAL_REVIEW", fullCoverage(), {
    readinessIssues: [
      {
        code: "low_confidence_action",
        severity: "blocker",
        source_type: "test_step",
        source_index: 1,
        source_text: "User focuses on the Search Bar.",
        ir_type: "click_target",
        capability: "attemptable",
        message: "Conservative mode does not execute low-confidence browser actions."
      },
      {
        code: "unsupported_assertion",
        severity: "blocker",
        source_type: "expected_result",
        source_index: 1,
        source_text: "The table updates to show no data rows.",
        ir_type: "assert_manual_review",
        capability: "manual",
        message: "Conservative mode cannot fully verify assert_manual_review yet."
      }
    ]
  }));

  expect(output.category).toBe("agent_understanding_gap");
  expect(output.developer_summary).toContain("could not confidently map this step");
  expect(output.recommended_action).toBe("Improve page/control mapping for this step, or clarify the test step if needed.");
  expect(output.developer_summary).not.toContain("Conservative mode");
});

test("pilot output turns Playwright locator timeouts into readable setup feedback", () => {
  const output = buildPilotCaseOutput(fakeCase("SCRIPT_BLOCKED", fullCoverage(), {
    failureReason:
      "locator.waitFor: Timeout 12000ms exceeded. Call log: \u001b[2m - waiting for locator('.el-table__body-wrapper tbody tr').filter({ hasText: 'Summer Beauty Campaign 2024' }).filter({ visible: true }).first() to be visible\u001b[22m"
  }));

  expect(output.category).toBe("setup_data_issue");
  expect(output.developer_summary).toBe('The expected table row "Summer Beauty Campaign 2024" was not visible before timeout, so this case could not continue.');
  expect(output.recommended_action).toBe('Create or seed "Summer Beauty Campaign 2024" in staging, then rerun this case.');
  expect(output.developer_summary).not.toContain("locator");
  expect(output.developer_summary).not.toContain("\u001b");
});

function fakeCase(
  status: QaStatus,
  coverage: TraceCoverageSummary = fullCoverage(),
  options: {
    stableId?: string;
    failureReason?: string;
    readinessIssues?: NonNullable<CaseResult["execution_readiness"]>["issues"];
  } = {}
): CaseResult {
  const stableId = options.stableId ?? "TC01";

  return {
    run_id: "run-1",
    case_execution_id: `run-1:${stableId}`,
    stable_id: stableId,
    title: "Sample case",
    status,
    precondition_result: "Precondition checked.",
    actual_result: status === "PRODUCT_BUG" ? "Actual value did not match expected value." : "Actual result.",
    expected_result: ["Expected result."],
    failure_reason: options.failureReason ?? (status === "PRODUCT_BUG" ? "Mismatch." : undefined),
    evidence_path: "evidence.png",
    execution_readiness: options.readinessIssues
      ? {
          mode: "conservative",
          case_id: stableId,
          status: "manual_review",
          can_execute: false,
          recommended_status: status,
          confidence: "medium",
          reason: "Readiness issue.",
          total_preconditions: 0,
          total_actions: 0,
          total_assertions: 0,
          runnable_action_count: 0,
          automated_assertion_count: 0,
          issues: options.readinessIssues,
          notes: [],
          test_case_ir: {
            version: "test_case_ir.v1",
            case_id: stableId,
            title: "Sample case",
            goal: "Sample goal",
            preconditions: [],
            actions: [],
            assertions: [],
            translation: {
              provider: "rules",
              status: "rules_only",
              validation_errors: [],
              validation_warnings: [],
              notes: []
            },
            notes: []
          }
        }
      : undefined,
    created_test_data: [],
    depends_on_data: [],
    notes: [],
    traceability: {
      source_workbook: "/tmp/source.xlsx",
      source_sheet: "Sheet1",
      source_row: 2,
      raw_test_case: "Sample case",
      raw_pre_requisite: "Precondition.",
      raw_test_steps: "Steps.",
      raw_expected_result: "Expected.",
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
    covered: 1,
    partially_covered: 0,
    not_covered: 0,
    not_executed: 0
  };
}

function partialCoverage(): TraceCoverageSummary {
  return {
    covered: 1,
    partially_covered: 1,
    not_covered: 0,
    not_executed: 0
  };
}
