import type { CaseResult, QaStatus, RunReport } from "../types.js";

const STATUS_ORDER: QaStatus[] = [
  "PASS",
  "PRODUCT_BUG",
  "SETUP_BLOCKED",
  "AGENT_BLOCKED",
  "SCRIPT_BLOCKED",
  "ENV_BLOCKED",
  "MANUAL_REVIEW"
];

export function summarize(results: CaseResult[]): Record<QaStatus, number> {
  const summary = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<
    QaStatus,
    number
  >;

  for (const result of results) {
    summary[result.status] += 1;
  }

  return summary;
}

export function formatMarkdownReport(report: RunReport): string {
  const lines: string[] = [];

  lines.push(`# Gro QA Agent Run Report`);
  lines.push("");
  lines.push(`- Run ID: ${report.run_id}`);
  lines.push(`- Release: ${report.release}`);
  lines.push(`- Started: ${report.started_at}`);
  lines.push(`- Finished: ${report.finished_at}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("| --- | ---: |");

  for (const status of STATUS_ORDER) {
    lines.push(`| ${status} | ${report.summary[status]} |`);
  }

  lines.push("");
  lines.push("## Cases");
  lines.push("");
  lines.push("| Case | Status | Actual | Failure Reason |");
  lines.push("| --- | --- | --- | --- |");

  for (const result of report.case_results) {
    lines.push(
      `| ${result.stable_id} | ${result.status} | ${oneLine(result.actual_result)} | ${oneLine(
        result.failure_reason ?? ""
      )} |`
    );
  }

  if (report.created_test_data.length > 0) {
    lines.push("");
    lines.push("## Created Test Data");
    lines.push("");
    lines.push("| Data ID | Display Name | Type | Created By | Used By | Cleanup |");
    lines.push("| --- | --- | --- | --- | --- | --- |");

    for (const data of report.created_test_data) {
      lines.push(
        `| ${data.data_id} | ${data.display_name} | ${data.data_type} | ${data.created_by_case} | ${data.used_by_cases.join(", ")} | ${data.cleanup_status} |`
      );
    }
  }

  for (const result of report.case_results) {
    lines.push("");
    lines.push(`## ${result.stable_id} - ${result.title}`);
    lines.push("");
    lines.push(`- Status: ${result.status}`);
    if (result.result_confidence) {
      lines.push(`- Result confidence: ${result.result_confidence}`);
    }
    if (result.classification_reason) {
      lines.push(`- Classification reason: ${result.classification_reason}`);
    }
    lines.push(`- Case execution ID: ${result.case_execution_id}`);
    lines.push(`- Precondition result: ${result.precondition_result}`);
    lines.push(`- Actual result: ${result.actual_result}`);

    if (result.failure_reason) {
      lines.push(`- Failure reason: ${result.failure_reason}`);
    }

    if (result.evidence_path) {
      lines.push(`- Evidence: ${result.evidence_path}`);
    }

    lines.push(`- Source workbook: ${result.traceability.source_workbook}`);
    lines.push(`- Source sheet/row: ${result.traceability.source_sheet} / ${result.traceability.source_row}`);
    if (result.traceability.contract_id) {
      lines.push(`- Trace contract: ${result.traceability.contract_id}`);
    }
    lines.push(
      `- Trace coverage: covered ${result.traceability.coverage_summary.covered}, partial ${result.traceability.coverage_summary.partially_covered}, not covered ${result.traceability.coverage_summary.not_covered}, not executed ${result.traceability.coverage_summary.not_executed}`
    );

    if (result.created_test_data.length > 0) {
      lines.push("");
      lines.push("Created test data:");
      for (const data of result.created_test_data) {
        lines.push(
          `- ${data.data_type}: ${data.display_name} (${data.data_id}); used by: ${data.used_by_cases.join(", ") || "none"}`
        );
      }
    }

    if (result.depends_on_data.length > 0) {
      lines.push("");
      lines.push("Depends on test data:");
      for (const data of result.depends_on_data) {
        lines.push(
          `- ${data.data_type}: ${data.display_name} (${data.data_id}) from ${data.source_case}`
        );
      }
    }

    if (result.notes.length > 0) {
      lines.push("");
      lines.push("Notes:");
      for (const note of result.notes) {
        lines.push(`- ${note}`);
      }
    }

    lines.push("");
    lines.push("Expected result:");
    for (const expected of result.expected_result) {
      lines.push(`- ${expected}`);
    }

    lines.push("");
    lines.push("Traceability - Expected Results:");
    lines.push("");
    lines.push("| # | Coverage | Original Expected Text | Automated Check | Notes |");
    lines.push("| ---: | --- | --- | --- | --- |");
    for (const entry of result.traceability.expected_trace) {
      lines.push(
        `| ${entry.source_index} | ${entry.coverage} | ${oneLine(entry.source_text)} | ${oneLine(
          entry.actual_check
        )} | ${oneLine(entry.notes.join("; "))} |`
      );
    }

    lines.push("");
    lines.push("Traceability - Test Steps:");
    lines.push("");
    lines.push("| # | Coverage | Original Step Text | Automated Action | Notes |");
    lines.push("| ---: | --- | --- | --- | --- |");
    for (const entry of result.traceability.step_trace) {
      lines.push(
        `| ${entry.source_index} | ${entry.coverage} | ${oneLine(entry.source_text)} | ${oneLine(
          entry.actual_check
        )} | ${oneLine(entry.notes.join("; "))} |`
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").replaceAll("|", "\\|").trim();
}
