import { analyzeRunFailures } from "./failureAnalysis.js";
import type {
  CaseResult,
  ExecutionReadinessIssueCode,
  FailureCluster,
  QaStatus,
  RunReport,
  TestCaseIRNode
} from "../types.js";

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
  lines.push(`- Agent Version: ${report.agent_version}`);
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

  if (report.prd_context) {
    lines.push("");
    lines.push("## PRD Context");
    lines.push("");
    lines.push(`- Source: ${report.prd_context.source_path ?? "not available"}`);
    lines.push(`- Extraction: ${report.prd_context.extraction_status}`);
    lines.push(`- Modules: ${report.prd_context.modules.join(", ") || "none inferred"}`);
    lines.push(`- Pages: ${report.prd_context.pages.slice(0, 10).join(", ") || "none inferred"}`);
    if (report.prd_context.notes.length > 0) {
      lines.push("- Notes:");
      for (const note of report.prd_context.notes) {
        lines.push(`  - ${note}`);
      }
    }
  }

  if (report.execution_readiness) {
    lines.push("");
    lines.push("## Execution Readiness");
    lines.push("");
    lines.push(`- Mode: ${report.execution_readiness.mode}`);
    lines.push(`- Total cases: ${report.execution_readiness.total_cases}`);
    lines.push(`- Ready for browser execution: ${report.execution_readiness.ready}`);
    lines.push(`- Stopped before browser execution: ${report.execution_readiness.blocked}`);
    lines.push(`- Manual review before browser execution: ${report.execution_readiness.manual_review}`);
    lines.push("");
    lines.push("| Recommended Status For Not-Executed Cases | Count |");
    lines.push("| --- | ---: |");
    for (const status of STATUS_ORDER) {
      const count = report.execution_readiness.by_recommended_status[status];
      if (count > 0) {
        lines.push(`| ${status} | ${count} |`);
      }
    }
    if (report.execution_readiness.top_blockers.length > 0) {
      lines.push("");
      lines.push("| Readiness Blocker | Cases | Sample Cases |");
      lines.push("| --- | ---: | --- |");
      for (const blocker of report.execution_readiness.top_blockers) {
        lines.push(
          `| ${blocker.label} | ${blocker.count} | ${oneLine(formatSampleCaseIds(blocker.case_ids))} |`
        );
      }
    }
  }

  const failureAnalysis = report.failure_analysis ?? analyzeRunFailures(report.case_results);
  if (failureAnalysis.attention_case_count > 0) {
    lines.push("");
    lines.push("## Failure Intelligence");
    lines.push("");
    lines.push(`- Attention cases: ${failureAnalysis.attention_case_count}`);
    if (failureAnalysis.next_actions.length > 0) {
      lines.push("- Suggested next actions:");
      for (const action of failureAnalysis.next_actions) {
        lines.push(`  - ${action}`);
      }
    }
    lines.push("");
    lines.push("| Category | Count | Status Mix | Sample Cases | Recommended Next Action |");
    lines.push("| --- | ---: | --- | --- | --- |");
    for (const cluster of failureAnalysis.clusters) {
      lines.push(
        `| ${cluster.label} | ${cluster.count} | ${oneLine(formatStatusMix(cluster))} | ${oneLine(
          formatSampleCases(cluster)
        )} | ${oneLine(cluster.recommended_next_action)} |`
      );
    }
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
    if (result.execution_readiness) {
      lines.push(`- Execution readiness: ${result.execution_readiness.status}`);
      lines.push(`- Readiness reason: ${result.execution_readiness.reason}`);
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

    if (result.traceability.test_case_ir) {
      const ir = result.traceability.test_case_ir;
      lines.push(
        `- Test Case IR: ${ir.preconditions.length} precondition(s), ${ir.actions.length} action(s), ${ir.assertions.length} assertion(s)`
      );
      lines.push(
        `- IR translator: ${ir.translation.provider} / ${ir.translation.status}${
          ir.translation.model ? ` / ${ir.translation.model}` : ""
        }`
      );
      if (ir.translation.validation_errors.length > 0) {
        lines.push(`- IR validation errors: ${ir.translation.validation_errors.join("; ")}`);
      }
      if (ir.translation.validation_warnings.length > 0) {
        lines.push(`- IR validation warnings: ${ir.translation.validation_warnings.join("; ")}`);
      }
    }

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

    if (result.execution_readiness?.issues.length) {
      lines.push("");
      lines.push("Execution readiness issues:");
      for (const issue of result.execution_readiness.issues) {
        lines.push(
          `- ${issue.severity}: ${labelReadinessIssue(issue.code)}${
            issue.source_index ? ` #${issue.source_index}` : ""
          } - ${issue.message}`
        );
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

    if (result.traceability.test_case_ir) {
      const irNodes = [
        ...result.traceability.test_case_ir.preconditions,
        ...result.traceability.test_case_ir.actions,
        ...result.traceability.test_case_ir.assertions
      ];
      lines.push("");
      lines.push("Test Case IR:");
      lines.push("");
      lines.push("| # | Kind | IR Type | Capability | Confidence | Target | Value | Scope / Row |");
      lines.push("| ---: | --- | --- | --- | --- | --- | --- | --- |");
      for (const node of irNodes) {
        lines.push(
          `| ${node.source_index} | ${node.kind} | ${node.ir_type} | ${node.capability} | ${node.confidence} | ${oneLine(
            node.target ?? ""
          )} | ${oneLine(node.value ?? "")} | ${oneLine(formatIrScope(node))} |`
        );
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").replaceAll("|", "\\|").trim();
}

function formatStatusMix(cluster: FailureCluster): string {
  return STATUS_ORDER
    .filter((status) => cluster.statuses[status])
    .map((status) => `${status} ${cluster.statuses[status]}`)
    .join(", ");
}

function formatSampleCases(cluster: FailureCluster): string {
  const sample = cluster.case_ids.slice(0, 8).join(", ");
  return cluster.case_ids.length > 8 ? `${sample}, ...` : sample;
}

function formatSampleCaseIds(caseIds: string[]): string {
  const sample = caseIds.slice(0, 8).join(", ");
  return caseIds.length > 8 ? `${sample}, ...` : sample;
}

function formatIrScope(node: TestCaseIRNode): string {
  return [node.scope, node.row].filter(Boolean).join(" / ");
}

function labelReadinessIssue(code: ExecutionReadinessIssueCode): string {
  switch (code) {
    case "env_missing":
      return "Missing environment/login configuration";
    case "setup_data_required":
      return "Setup data prerequisite required";
    case "manual_case":
      return "Input case marked manual";
    case "unsupported_action":
      return "Unsupported browser action";
    case "unsupported_assertion":
      return "Unsupported expected-result assertion";
    case "low_confidence_action":
      return "Low-confidence browser action";
    case "ir_translation_untrusted":
      return "Untrusted Test Case IR translation";
  }
}
