import { missingSiteEnv, type RuntimeConfig } from "../runtime/config.js";
import type {
  ExecutionReadinessBlockerSummary,
  ExecutionReadinessDecision,
  ExecutionReadinessIssue,
  ExecutionReadinessIssueCode,
  ExecutionReadinessRunSummary,
  NormalizedCase,
  PrdKnowledgePack,
  QaStatus,
  TestCaseIRNode,
  TestCaseIRType
} from "../types.js";
import { buildDynamicActionPlan } from "./actionPlan.js";
import {
  buildRuntimeTestCaseIR,
  type TestCaseIRBuildResult
} from "./llmTestCaseIR.js";

export interface ExecutionReadinessResult {
  decision: ExecutionReadinessDecision;
  irBuild: TestCaseIRBuildResult;
}

export async function assessExecutionReadiness(
  testCase: NormalizedCase,
  config: RuntimeConfig,
  _options: { prdKnowledge?: PrdKnowledgePack } = {}
): Promise<ExecutionReadinessResult> {
  const plan = buildDynamicActionPlan(testCase);
  const irBuild = await buildRuntimeTestCaseIR(testCase, plan, config);
  const issues: ExecutionReadinessIssue[] = [];
  const missingEnv = missingSiteEnv(config, testCase.site);
  const hasImplementedExecutor = testCase.automation_status === "ready";

  if (missingEnv.length > 0) {
    issues.push({
      code: "env_missing",
      severity: "blocker",
      message: `Missing required environment variable(s): ${missingEnv.join(", ")}.`
    });
  }

  if (!hasImplementedExecutor && testCase.automation_status === "manual_review") {
    issues.push({
      code: "manual_case",
      severity: "blocker",
      message: "Input triage marked this case as manual review before browser execution."
    });
  }

  if (irBuild.validation.errors.length > 0) {
    issues.push({
      code: "ir_translation_untrusted",
      severity: "blocker",
      message: `Test Case IR validation failed: ${irBuild.validation.errors.join("; ")}.`
    });
  }

  if (!hasImplementedExecutor) {
    for (const node of irBuild.ir.preconditions) {
      if (node.ir_type === "precondition_existing_data" && testCase.dependencies.length === 0) {
        issues.push(issueFromNode(
          "setup_data_required",
          node,
          "Existing data prerequisite has no known setup dependency in this run."
        ));
      }
    }

    for (const node of irBuild.ir.actions) {
      if (!isSupportedAction(node)) {
        issues.push(issueFromNode(
          "unsupported_action",
          node,
          `Conservative mode does not execute ${node.ir_type} yet.`
        ));
        continue;
      }

      if (node.confidence === "low") {
        issues.push(issueFromNode(
          "low_confidence_action",
          node,
          "Conservative mode does not execute low-confidence browser actions."
        ));
      }
    }

    for (const node of irBuild.ir.assertions) {
      if (!isSupportedAssertion(node)) {
        issues.push(issueFromNode(
          "unsupported_assertion",
          node,
          `Conservative mode cannot fully verify ${node.ir_type} yet.`
        ));
      }
    }
  }

  const blockingIssues = issues.filter((issue) => issue.severity === "blocker");
  const canExecute =
    blockingIssues.length === 0 &&
    testCase.automation_status !== "manual_review" &&
    (testCase.automation_status === "ready" || hasRunnableGenericCoverage(irBuild.ir.actions, irBuild.ir.assertions));
  const recommendedStatus = recommendStatus(blockingIssues, canExecute);
  const status = canExecute ? "ready" : recommendedStatus === "MANUAL_REVIEW" ? "manual_review" : "blocked";
  const reason = canExecute
    ? "Case passed the conservative readiness gate and can enter browser execution."
    : summarizeReadinessReason(blockingIssues);

  return {
    irBuild,
    decision: {
      mode: "conservative",
      case_id: testCase.stable_id,
      status,
      can_execute: canExecute,
      recommended_status: recommendedStatus,
      confidence: canExecute ? "medium" : recommendedStatus === "ENV_BLOCKED" ? "high" : "medium",
      reason,
      total_preconditions: irBuild.ir.preconditions.length,
      total_actions: irBuild.ir.actions.length,
      total_assertions: irBuild.ir.assertions.length,
      runnable_action_count: irBuild.ir.actions.filter(isSupportedAction).length,
      automated_assertion_count: irBuild.ir.assertions.filter(isSupportedAssertion).length,
      issues,
      notes: [
        "Conservative mode checks execution readiness before opening Playwright.",
        hasImplementedExecutor
          ? "Case is marked ready for an implemented executor, so conservative generic capability checks are informational only."
          : "Only cases with supported actions and checkable assertions enter browser execution.",
        ...irBuild.notes
      ],
      test_case_ir: irBuild.ir
    }
  };
}

export function summarizeExecutionReadiness(
  decisions: ExecutionReadinessDecision[]
): ExecutionReadinessRunSummary {
  const byStatus = zeroStatusSummary();
  const blockerCases = new Map<ExecutionReadinessIssueCode, Set<string>>();

  for (const decision of decisions) {
    if (!decision.can_execute) {
      byStatus[decision.recommended_status] += 1;
    }
    for (const issue of decision.issues.filter((item) => item.severity === "blocker")) {
      const cases = blockerCases.get(issue.code) ?? new Set<string>();
      cases.add(decision.case_id);
      blockerCases.set(issue.code, cases);
    }
  }

  const topBlockers: ExecutionReadinessBlockerSummary[] = Array.from(blockerCases.entries())
    .map(([code, caseIds]) => ({
      code,
      label: labelForIssue(code),
      count: caseIds.size,
      case_ids: Array.from(caseIds).sort()
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  return {
    mode: "conservative",
    total_cases: decisions.length,
    ready: decisions.filter((decision) => decision.status === "ready").length,
    blocked: decisions.filter((decision) => decision.status === "blocked").length,
    manual_review: decisions.filter((decision) => decision.status === "manual_review").length,
    by_recommended_status: byStatus,
    top_blockers: topBlockers
  };
}

export function labelForIssue(code: ExecutionReadinessIssueCode): string {
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

function isSupportedAction(node: TestCaseIRNode): boolean {
  if (node.capability === "manual" || node.capability === "blocked") return false;

  const safeTypes: TestCaseIRType[] = [
    "navigate_to_page",
    "navigate_back",
    "click_target",
    "fill_field",
    "wait_for_update",
    "observe_only"
  ];

  if (!safeTypes.includes(node.ir_type)) return false;
  if (node.ir_type === "fill_field" && (!node.target || !node.value)) return false;
  if (node.ir_type === "click_target" && !node.target) return false;
  return true;
}

function isSupportedAssertion(node: TestCaseIRNode): boolean {
  if (node.capability === "manual" || node.capability === "blocked") return false;

  const safeTypes: TestCaseIRType[] = [
    "assert_visible_text",
    "assert_navigation",
    "assert_modal_visible",
    "assert_modal_closed",
    "assert_toast_visible",
    "assert_table_filtered",
    "assert_no_raw_null",
    "assert_form_validation"
  ];

  return safeTypes.includes(node.ir_type);
}

function hasRunnableGenericCoverage(actions: TestCaseIRNode[], assertions: TestCaseIRNode[]): boolean {
  return actions.length > 0 && actions.every(isSupportedAction) && assertions.length > 0 && assertions.every(isSupportedAssertion);
}

function issueFromNode(
  code: ExecutionReadinessIssueCode,
  node: TestCaseIRNode,
  message: string
): ExecutionReadinessIssue {
  return {
    code,
    severity: "blocker",
    source_type: node.source_type,
    source_index: node.source_index,
    source_text: node.source_text,
    ir_type: node.ir_type,
    capability: node.capability,
    message
  };
}

function recommendStatus(issues: ExecutionReadinessIssue[], canExecute: boolean): QaStatus {
  if (canExecute) return "MANUAL_REVIEW";
  if (issues.some((issue) => issue.code === "env_missing")) return "ENV_BLOCKED";
  if (issues.some((issue) => issue.code === "setup_data_required")) return "SETUP_BLOCKED";
  if (issues.some((issue) => issue.code === "unsupported_assertion" || issue.code === "manual_case")) {
    return "MANUAL_REVIEW";
  }
  return "AGENT_BLOCKED";
}

function summarizeReadinessReason(issues: ExecutionReadinessIssue[]): string {
  if (issues.length === 0) {
    return "Case did not meet the conservative execution threshold.";
  }

  const counts = new Map<ExecutionReadinessIssueCode, number>();
  for (const issue of issues) {
    counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([code, count]) => `${labelForIssue(code)} (${count})`)
    .join("; ");
}

function zeroStatusSummary(): Record<QaStatus, number> {
  return {
    PASS: 0,
    PRODUCT_BUG: 0,
    SETUP_BLOCKED: 0,
    AGENT_BLOCKED: 0,
    SCRIPT_BLOCKED: 0,
    ENV_BLOCKED: 0,
    MANUAL_REVIEW: 0
  };
}
