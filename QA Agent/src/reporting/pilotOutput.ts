import type {
  CaseResult,
  ExecutionReadinessIssue,
  PilotCaseOutput,
  PilotFailureCategory,
  PilotOutputSummary,
  TestCaseIRType,
  TraceCoverageSummary
} from "../types.js";

interface PilotCategoryDefinition {
  label: string;
  owner_hint: string;
  recommended_action: string;
}

const CATEGORY_DEFINITIONS: Record<PilotFailureCategory, PilotCategoryDefinition> = {
  passed: {
    label: "Passed",
    owner_hint: "No immediate action",
    recommended_action: "Keep the evidence with this self-test run."
  },
  product_bug: {
    label: "Product Bug",
    owner_hint: "Development team",
    recommended_action: "Review the evidence and fix the Gro behavior or confirm the expected result changed."
  },
  setup_data_issue: {
    label: "Setup Data Issue",
    owner_hint: "Test owner / development team",
    recommended_action: "Prepare or seed the required prerequisite data, then rerun the case."
  },
  environment_issue: {
    label: "Environment Issue",
    owner_hint: "Environment / account owner",
    recommended_action: "Fix login, account, permission, or staging configuration before rerunning."
  },
  agent_understanding_gap: {
    label: "Agent Understanding Gap",
    owner_hint: "QA Agent owner",
    recommended_action: "Clarify module/page/action mapping or add Gro knowledge before rerunning."
  },
  recipe_missing: {
    label: "Recipe Missing",
    owner_hint: "QA Agent owner",
    recommended_action: "Build or verify a reusable recipe for this module/action before expecting automation."
  },
  selector_or_script_issue: {
    label: "Selector / Script Issue",
    owner_hint: "QA Agent owner",
    recommended_action: "Inspect the evidence and improve selectors, page discovery, or generic Playwright handling."
  },
  test_case_ambiguity: {
    label: "Test Case Ambiguity",
    owner_hint: "Requirement / test case owner",
    recommended_action: "Clarify the test case precondition, action, or expected result before automation."
  },
  manual_review_required: {
    label: "Manual Review Required",
    owner_hint: "Reviewer",
    recommended_action: "Manually inspect the evidence and decide whether this is acceptable for delivery."
  }
};

export function attachPilotOutputs(results: CaseResult[]): {
  results: CaseResult[];
  summary: PilotOutputSummary;
} {
  const enriched = results.map((result) => ({
    ...result,
    pilot_output: buildPilotCaseOutput(result)
  }));

  return {
    results: enriched,
    summary: summarizePilotOutputs(enriched)
  };
}

export function buildPilotCaseOutput(result: CaseResult): PilotCaseOutput {
  const category = classifyPilotCategory(result);
  const definition = CATEGORY_DEFINITIONS[category];
  const developerSummary = summarizeForDeveloper(result, category);

  return {
    category,
    category_label: definition.label,
    developer_summary: developerSummary,
    expected_summary: summarizeExpected(result),
    actual_summary: compact(result.actual_result),
    recommended_action: recommendAction(result, category, definition),
    evidence_path: result.evidence_path,
    owner_hint: definition.owner_hint
  };
}

export function summarizePilotOutputs(results: CaseResult[]): PilotOutputSummary {
  const byCategory = zeroPilotCategoryCounts();
  const actions = new Map<string, number>();

  for (const result of results) {
    const output = result.pilot_output ?? buildPilotCaseOutput(result);
    byCategory[output.category] += 1;
    if (output.category !== "passed") {
      actions.set(output.recommended_action, (actions.get(output.recommended_action) ?? 0) + 1);
    }
  }

  return {
    total_cases: results.length,
    attention_case_count: results.filter((result) => {
      const output = result.pilot_output ?? buildPilotCaseOutput(result);
      return output.category !== "passed";
    }).length,
    by_category: byCategory,
    top_recommended_actions: Array.from(actions.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([action]) => action)
  };
}

export function pilotCategoryLabel(category: PilotFailureCategory): string {
  return CATEGORY_DEFINITIONS[category].label;
}

function classifyPilotCategory(result: CaseResult): PilotFailureCategory {
  if (result.status === "PASS") {
    return hasFullCoverage(result.traceability.coverage_summary) ? "passed" : "manual_review_required";
  }

  if (result.status === "PRODUCT_BUG") return "product_bug";
  if (result.status === "SETUP_BLOCKED") return "setup_data_issue";
  if (result.status === "ENV_BLOCKED") return "environment_issue";

  const readinessIssues = result.execution_readiness?.issues ?? [];
  if (readinessIssues.some((issue) => issue.code === "env_missing")) return "environment_issue";
  if (readinessIssues.some((issue) => issue.code === "setup_data_required")) return "setup_data_issue";
  if (readinessIssues.some((issue) => issue.code === "ir_translation_untrusted")) return "agent_understanding_gap";

  const rawCombined = [
    result.failure_reason,
    result.classification_reason,
    result.actual_result,
    result.precondition_result,
    result.traceability.raw_pre_requisite,
    result.traceability.raw_test_steps,
    result.traceability.raw_expected_result,
    ...result.expected_result,
    ...result.notes,
    ...result.traceability.alignment_notes,
    ...result.traceability.step_trace.map((entry) => entry.actual_check),
    ...result.traceability.expected_trace.map((entry) => entry.actual_check),
    ...result.traceability.expected_trace.flatMap((entry) => entry.notes),
    ...(result.execution_readiness?.issues.map((issue) => `${issue.code} ${issue.message}`) ?? [])
  ].filter(Boolean).join(" ");
  const text = normalize(rawCombined);

  if (/\benv_missing\b|missing required environment|credential|login|auth|permission|storage state|account/.test(text)) {
    return "environment_issue";
  }

  if (
    /\bsetup_data_required\b|precondition_existing_data|existing data|seed|required prerequisite|setup data/.test(text) ||
    /at least one .* exists|expected .* row .*not (visible|found)|no known setup dependency/.test(text) ||
    (/hasText:\s*'[^']+'/.test(rawCombined) && /locator|table|row|tbody|el-table/.test(text))
  ) {
    return "setup_data_issue";
  }

  if (readinessIssues.some((issue) => issue.code === "low_confidence_action")) {
    return "agent_understanding_gap";
  }

  if (/ambiguous test case|unclear|not observable|cannot be verified|expected result.*manual|manual interpretation|test case.*ambiguous/.test(text)) {
    return "test_case_ambiguity";
  }

  if (/unknown module|page discovery|candidate route|wrong page|module match|route hint|no .* route|understanding|knowledge/.test(text)) {
    return "agent_understanding_gap";
  }

  if (/recipe_missing|no verified executor|no verified .* recipe|unsupported_action|unsupported_assertion|unsupported browser action|capability|conservative execution threshold|does not execute/.test(text)) {
    return "recipe_missing";
  }

  if (
    result.status === "SCRIPT_BLOCKED" ||
    /selector|locator|target|element|button|field|dropdown|option|visible form field|could not find|not find a visible|table|row|operation column|timeout|script/.test(text)
  ) {
    return "selector_or_script_issue";
  }

  if (result.status === "MANUAL_REVIEW") return "manual_review_required";
  if (result.status === "AGENT_BLOCKED") return "recipe_missing";

  return "manual_review_required";
}

function summarizeForDeveloper(result: CaseResult, category: PilotFailureCategory): string {
  if (category === "passed") {
    return "The agent completed this case and covered the expected result evidence.";
  }

  if (result.status === "PASS" && category === "manual_review_required") {
    return "The browser flow completed, but not every expected result was fully covered by evidence.";
  }

  const readinessSummary = summarizeReadinessForDeveloper(result);
  if (readinessSummary) return readinessSummary;

  const rawReason = cleanText(
    result.failure_reason ||
      result.classification_reason ||
      result.actual_result ||
      result.precondition_result ||
      "The agent recorded this case as needing attention, but no detailed failure reason was available."
  );

  const timeoutSummary = summarizeTimeoutOrLocatorFailure(rawReason);
  if (timeoutSummary) return timeoutSummary;

  return sentenceLimit(humanizeInternalMessage(rawReason), 260);
}

function summarizeExpected(result: CaseResult): string {
  return compact(result.expected_result.join(" "));
}

function recommendAction(
  result: CaseResult,
  category: PilotFailureCategory,
  definition: PilotCategoryDefinition
): string {
  const readinessIssue = primaryReadinessIssue(result.execution_readiness?.issues ?? []);

  if (readinessIssue && category !== "passed") {
    return actionForReadinessIssue(readinessIssue, category);
  }

  const rawReason = cleanText(result.failure_reason || result.actual_result || "");
  if (category === "setup_data_issue") {
    const missingRow = extractQuotedTableText(rawReason);
    if (missingRow) {
      return `Create or seed "${missingRow}" in staging, then rerun this case.`;
    }
  }

  if (category === "selector_or_script_issue" && /locator|selector|timeout|not visible|element/i.test(rawReason)) {
    return "Inspect the page state/evidence, then improve the selector or generic page-control handling.";
  }

  return definition.recommended_action;
}

function zeroPilotCategoryCounts(): Record<PilotFailureCategory, number> {
  return {
    passed: 0,
    product_bug: 0,
    setup_data_issue: 0,
    environment_issue: 0,
    agent_understanding_gap: 0,
    recipe_missing: 0,
    selector_or_script_issue: 0,
    test_case_ambiguity: 0,
    manual_review_required: 0
  };
}

function hasFullCoverage(summary: TraceCoverageSummary): boolean {
  return (
    summary.partially_covered === 0 &&
    summary.not_covered === 0 &&
    summary.not_executed === 0
  );
}

function compact(value: string): string {
  return cleanText(value).replace(/\s+/g, " ").trim();
}

function normalize(value: string): string {
  return compact(value).toLowerCase();
}

function cleanText(value: string | undefined): string {
  return (value ?? "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeReadinessForDeveloper(result: CaseResult): string | undefined {
  const issues = result.execution_readiness?.issues ?? [];
  if (issues.length === 0) return undefined;

  const primary = primaryReadinessIssue(issues);
  if (!primary) return undefined;

  const secondaryCount = Math.max(issues.length - 1, 0);
  const suffix = secondaryCount > 0 ? ` ${secondaryCount} additional readiness issue(s) were also found.` : "";
  return sentenceLimit(`${summaryForReadinessIssue(primary)}${suffix}`, 260);
}

function primaryReadinessIssue(issues: ExecutionReadinessIssue[]): ExecutionReadinessIssue | undefined {
  const blockers = issues.filter((issue) => issue.severity === "blocker");
  const orderedCodes = [
    "env_missing",
    "setup_data_required",
    "ir_translation_untrusted",
    "low_confidence_action",
    "unsupported_action",
    "unsupported_assertion",
    "manual_case"
  ];

  return orderedCodes
    .map((code) => blockers.find((issue) => issue.code === code))
    .find(Boolean) ?? blockers[0] ?? issues[0];
}

function summaryForReadinessIssue(issue: ExecutionReadinessIssue): string {
  switch (issue.code) {
    case "env_missing":
      return "The agent could not start this case because staging URL, login, or account configuration is missing.";
    case "setup_data_required":
      return "This case needs pre-existing staging data, but the run did not include a setup case or seed data for it.";
    case "ir_translation_untrusted":
      return "The agent could not safely translate the original test case into a traceable execution plan.";
    case "low_confidence_action":
      return `The agent could not confidently map this step to a page control: ${shortSource(issue)}`;
    case "unsupported_action":
      return `The agent does not yet have a stable recipe for this action: ${readableIrType(issue.ir_type)}.`;
    case "unsupported_assertion":
      return `The expected result needs an assertion recipe the agent does not have yet: ${readableIrType(issue.ir_type)}.`;
    case "manual_case":
      return "This case was marked as manual review before browser execution.";
  }
}

function actionForReadinessIssue(
  issue: ExecutionReadinessIssue,
  category: PilotFailureCategory
): string {
  switch (issue.code) {
    case "env_missing":
      return "Configure the required staging URL/account, then rerun this case.";
    case "setup_data_required":
      return "Prepare the required staging data or add a setup recipe, then rerun this case.";
    case "ir_translation_untrusted":
      return "Clarify the test case wording or improve the IR translator before running this case.";
    case "low_confidence_action":
      return "Improve page/control mapping for this step, or clarify the test step if needed.";
    case "unsupported_action":
      return actionForIrType(issue.ir_type);
    case "unsupported_assertion":
      return "Add an automated assertion for this expected result, or mark it for manual evidence review.";
    case "manual_case":
      return "Review this case manually or define a reusable automation recipe for it.";
  }

  return CATEGORY_DEFINITIONS[category].recommended_action;
}

function actionForIrType(irType?: TestCaseIRType): string {
  switch (irType) {
    case "select_option":
      return "Add a reusable dropdown/filter recipe, then rerun this case.";
    case "click_dialog_action":
      return "Add a dialog/drawer action recipe for this module, then rerun this case.";
    case "fill_field":
      return "Improve field targeting and fill handling for this form, then rerun this case.";
    case "observe_only":
      return "Add an observation/assertion recipe for this page state before expecting automation.";
    case "click_target":
      return "Improve target resolution for this click action, then rerun this case.";
    default:
      return "Add a reusable automation recipe for this action, then rerun this case.";
  }
}

function readableIrType(irType?: TestCaseIRType): string {
  switch (irType) {
    case "select_option":
      return "selecting a dropdown/filter option";
    case "click_dialog_action":
      return "clicking a dialog or drawer action";
    case "fill_field":
      return "filling a form field";
    case "observe_only":
      return "observing and verifying the page state";
    case "assert_manual_review":
      return "manual visual/business verification";
    case "assert_table_filtered":
      return "checking filtered table rows";
    case "assert_form_validation":
      return "checking form validation or empty-state copy";
    default:
      return irType ? irType.replace(/_/g, " ") : "unknown action";
  }
}

function shortSource(issue: ExecutionReadinessIssue): string {
  return sentenceLimit(cleanText(issue.source_text || issue.message), 120);
}

function summarizeTimeoutOrLocatorFailure(reason: string): string | undefined {
  if (!/locator|selector|timeout|not visible|could not find|not found/i.test(reason)) {
    return undefined;
  }

  const missingText = extractQuotedTableText(reason);
  if (missingText) {
    return `The expected table row "${missingText}" was not visible before timeout, so this case could not continue.`;
  }

  return "The agent could not find the required page element before timeout, so the browser flow could not continue.";
}

function extractQuotedTableText(reason: string): string | undefined {
  return reason.match(/hasText:\s*'([^']+)'/)?.[1] ?? reason.match(/"([^"]{4,120})"/)?.[1];
}

function humanizeInternalMessage(value: string): string {
  return value
    .replace(/Conservative mode does not execute low-confidence browser actions\.?/gi, "The agent could not confidently identify one or more page actions.")
    .replace(/Conservative mode does not execute ([a-z_]+) yet\.?/gi, (_match, irType: string) => `The agent does not yet have a stable recipe for ${readableIrType(irType as TestCaseIRType)}.`)
    .replace(/Conservative mode cannot fully verify ([a-z_]+) yet\.?/gi, (_match, irType: string) => `The agent cannot yet fully verify ${readableIrType(irType as TestCaseIRType)}.`)
    .replace(/Existing data prerequisite has no known setup dependency in this run\.?/gi, "Required staging data is missing and no setup case was available in this run.");
}

function sentenceLimit(value: string, maxLength: number): string {
  const clean = cleanText(value);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}
