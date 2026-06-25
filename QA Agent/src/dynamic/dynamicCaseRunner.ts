import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import type { RuntimeConfig } from "../runtime/config.js";
import type {
  CaseExecutionTrace,
  CaseResult,
  NormalizedCase,
  QaStatus,
  TraceCoverageSummary,
  TraceEntry
} from "../types.js";
import { caseExecutionId } from "../core/runIdentity.js";
import type { AdminPageSession } from "../playwright/adminSession.js";
import {
  buildDynamicActionPlan,
  type DynamicActionPlan,
  type DynamicActionStep
} from "./actionPlan.js";
import { observePage, type BrowserObservation } from "./browserObservation.js";
import {
  describeResolution,
  resolveClickTarget,
  resolveInputTarget,
  resolveSelectTarget
} from "./targetResolver.js";
import { waitForObservablePage } from "./pageReadiness.js";

interface DynamicRunOptions {
  adminSession?: AdminPageSession;
}

interface DynamicStepResult {
  planStep: DynamicActionStep;
  status: "completed" | "blocked" | "skipped";
  actual: string;
}

interface ExpectedAssertionResult {
  expectedIndex: number;
  expectedText: string;
  status: "passed" | "failed" | "manual";
  actual: string;
  notes: string[];
}

export async function runDynamicCase(
  testCase: NormalizedCase,
  config: RuntimeConfig,
  runDir: string,
  runId: string,
  options: DynamicRunOptions = {}
): Promise<CaseResult> {
  const plan = buildDynamicActionPlan(testCase);

  if (testCase.site !== "admin") {
    return dynamicBlockedResult({
      testCase,
      runId,
      plan,
      status: "AGENT_BLOCKED",
      actualResult: `Dynamic browser execution currently supports Admin Site cases only; this case targets ${testCase.site}.`,
      failureReason: "Unsupported site for the current dynamic runner.",
      stepResults: []
    });
  }

  if (!options.adminSession) {
    return dynamicBlockedResult({
      testCase,
      runId,
      plan,
      status: "ENV_BLOCKED",
      actualResult: "No Admin browser session was available for dynamic execution.",
      failureReason: "Admin session is missing.",
      stepResults: []
    });
  }

  const { page } = options.adminSession;
  const stepResults: DynamicStepResult[] = [];
  let lastObservation: BrowserObservation | undefined;
  let readinessNotes: string[] = [];

  try {
    await navigateToStartingPoint(page, config, testCase);
    const readiness = await waitForObservablePage(page, {
      timeoutMs: 20_000,
      reloads: 1
    });
    lastObservation = readiness.observation;
    readinessNotes = readiness.notes;

    if (!readiness.ready) {
      const evidencePath = await screenshot(page, runDir, `${testCase.stable_id}.page-not-observable.png`);
      return dynamicBlockedResult({
        testCase,
        runId,
        plan,
        status: "ENV_BLOCKED",
        actualResult: "The target Gro page did not render observable UI before dynamic execution started.",
        failureReason:
          "The browser reached the target URL, but the page had no readable text, controls, inputs, or table content after waiting and retrying.",
        evidencePath,
        stepResults,
        lastObservation,
        extraNotes: readinessNotes
      });
    }

    for (const step of plan.steps) {
      const result = await executeDynamicStep(page, step, lastObservation);
      stepResults.push(result);
      lastObservation = await observePage(page);

      if (result.status === "blocked") {
        const evidencePath = await screenshot(page, runDir, `${testCase.stable_id}.dynamic-blocked.png`);
        return dynamicBlockedResult({
          testCase,
          runId,
          plan,
          status: step.source === "precondition" ? "SETUP_BLOCKED" : "AGENT_BLOCKED",
          actualResult: result.actual,
          failureReason: result.actual,
          evidencePath,
          stepResults,
          lastObservation
        });
      }
    }

    const evidencePath = await screenshot(page, runDir, `${testCase.stable_id}.dynamic.png`);
    const completed = stepResults.filter((result) => result.status === "completed").length;
    const assertionResults = await evaluateExpectedResults(
      page,
      testCase,
      lastObservation ?? (await observePage(page))
    );
    const failedAssertions = assertionResults.filter((result) => result.status === "failed");
    const checkedAssertions = assertionResults.filter((result) => result.status !== "manual");
    const allExpectedChecked =
      testCase.expected_result.length > 0 &&
      checkedAssertions.length === testCase.expected_result.length;
    const allCheckedPassed =
      allExpectedChecked && assertionResults.every((result) => result.status === "passed");
    const status: QaStatus = failedAssertions.length > 0
      ? "PRODUCT_BUG"
      : allCheckedPassed
        ? "PASS"
        : "MANUAL_REVIEW";
    const assertionSummary = formatAssertionSummary(assertionResults);

    return {
      run_id: runId,
      case_execution_id: caseExecutionId(runId, testCase.stable_id),
      stable_id: testCase.stable_id,
      title: testCase.title,
      status,
      precondition_result: "Dynamic runner attempted the case from the uploaded natural-language steps.",
      actual_result: failedAssertions.length > 0
        ? `Dynamic runner completed ${completed}/${plan.steps.length} planned step(s), but expected assertion failed: ${failedAssertions[0].actual}`
        : allCheckedPassed
          ? `Dynamic runner completed ${completed}/${plan.steps.length} planned step(s), and all generic expected assertions passed.`
          : `Dynamic runner completed ${completed}/${plan.steps.length} planned step(s). ${assertionSummary}`,
      expected_result: testCase.expected_result,
      failure_reason: failedAssertions[0]?.actual,
      evidence_path: evidencePath,
      created_test_data: [],
      depends_on_data: [],
      traceability: buildDynamicTrace(testCase, plan, stepResults, assertionResults),
      notes: [
        "v0.8 dynamic runner used generic browser actions rather than a prewritten case executor.",
        ...readinessNotes,
        ...assertionResults.flatMap((result) => result.notes),
        ...formatObservationNotes(lastObservation)
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const evidencePath = await screenshot(page, runDir, `${testCase.stable_id}.dynamic-error.png`).catch(
      () => undefined
    );

    return dynamicBlockedResult({
      testCase,
      runId,
      plan,
      status: "AGENT_BLOCKED",
      actualResult: "Dynamic runner could not complete the case.",
      failureReason: message,
      evidencePath,
      stepResults,
      lastObservation,
      extraNotes: readinessNotes
    });
  }
}

async function navigateToStartingPoint(
  page: Page,
  config: RuntimeConfig,
  testCase: NormalizedCase
): Promise<void> {
  const baseUrl = config.adminBaseUrl?.replace(/\/$/, "");
  if (!baseUrl) return;

  const route = inferStartingRoute(testCase);
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
}

function inferStartingRoute(testCase: NormalizedCase): string {
  const text = `${testCase.module} ${testCase.scenario_group} ${testCase.scenario} ${testCase.title}`;

  if (/master campaign/i.test(text)) {
    return "/masterCampaign/master-campaign-list";
  }

  return "/";
}

async function executeDynamicStep(
  page: Page,
  step: DynamicActionStep,
  observation: BrowserObservation
): Promise<DynamicStepResult> {
  if (step.action === "precondition" || step.action === "observe" || step.action === "assert") {
    return {
      planStep: step,
      status: step.action === "precondition" && /exists|existing|at least one/i.test(step.sourceText)
        ? "blocked"
        : "completed",
      actual:
        step.action === "precondition" && /exists|existing|at least one/i.test(step.sourceText)
          ? `Dynamic runner cannot safely create or verify this prerequisite yet: ${step.sourceText}`
          : `Observed step text: ${step.sourceText}`
    };
  }

  if (step.action === "navigate") {
    return {
      planStep: step,
      status: "completed",
      actual: `Started from inferred page target: ${step.target ?? "default page"}.`
    };
  }

  if (step.action === "wait") {
    await page.waitForTimeout(1000);
    return {
      planStep: step,
      status: "completed",
      actual: "Waited for the page to update."
    };
  }

  if (step.action === "click") {
    const target = step.target;
    if (!target) {
      return blocked(step, "The dynamic click step has no clear target.");
    }

    if (/if not already open/i.test(step.sourceText) && (await hasVisibleDialog(page))) {
      return {
        planStep: step,
        status: "completed",
        actual: `Skipped opening "${target}" because a dialog is already visible.`
      };
    }

    if (isInputLikeTarget(target) || isInputLikeTarget(step.sourceText)) {
      const resolution = resolveInputTarget(page, observation, {
        action: "fill",
        target,
        sourceText: step.sourceText
      });

      if (resolution.status !== "found") {
        return blocked(step, describeResolution(resolution, target));
      }

      await resolution.locator.click({ timeout: 5000 });
      return {
        planStep: step,
        status: "completed",
        actual: `Focused "${target}". ${describeResolution(resolution, target)}`
      };
    }

    const resolution = resolveClickTarget(page, observation, {
      action: "click",
      target,
      sourceText: step.sourceText
    });

    if (resolution.status !== "found") {
      const rowScopedAction = await resolveRowScopedActionTarget(page, target, step.sourceText);
      if (rowScopedAction) {
        await rowScopedAction.locator.click({ timeout: 5000 });
        return {
          planStep: step,
          status: "completed",
          actual: `Clicked row-scoped "${target}". ${rowScopedAction.reason}`
        };
      }

      return blocked(step, describeResolution(resolution, target));
    }

    await resolution.locator.click({ timeout: 5000 });
    return {
      planStep: step,
      status: "completed",
      actual: `Clicked "${target}". ${describeResolution(resolution, target)}`
    };
  }

  if (step.action === "fill") {
    if (!step.value) {
      return blocked(step, "The dynamic fill step has no clear value to enter.");
    }

    const focusedInput = page
      .locator('input:focus, textarea:focus, [contenteditable="true"]:focus, [role="textbox"]:focus')
      .first();

    if (isGenericInputTarget(step.target) && (await focusedInput.isVisible().catch(() => false))) {
      await focusedInput.fill(step.value, { timeout: 5000 });
      await page.keyboard.press("Enter").catch(() => undefined);
      return {
        planStep: step,
        status: "completed",
        actual: `Filled "${step.value}" into the currently focused input.`
      };
    }

    const resolution = resolveInputTarget(page, observation, {
      action: "fill",
      target: step.target,
      value: step.value,
      sourceText: step.sourceText
    });

    if (resolution.status !== "found") {
      return blocked(step, describeResolution(resolution, step.target));
    }

    await resolution.locator.fill(step.value, { timeout: 5000 });
    await page.keyboard.press("Enter").catch(() => undefined);
    return {
      planStep: step,
      status: "completed",
      actual: `Filled "${step.value}" into "${step.target ?? "input"}". ${describeResolution(resolution, step.target)}`
    };
  }

  if (step.action === "select") {
    if (!step.value) {
      return blocked(step, "The dynamic select step has no clear option value.");
    }

    const resolution = await resolveSelectTarget(page, observation, {
      action: "select",
      target: step.target,
      value: step.value,
      sourceText: step.sourceText
    });

    if (resolution.status !== "found") {
      return blocked(step, describeResolution(resolution, step.target));
    }

    await resolution.locator.click({ timeout: 5000 });
    const option = await resolveDropdownOption(page, step.value);

    if (!option) {
      return blocked(
        step,
        `Opened "${step.target ?? "select control"}" but could not find option "${step.value}". ${describeResolution(resolution, step.target)}`
      );
    }

    await option.click({ timeout: 5000 });
    return {
      planStep: step,
      status: "completed",
      actual: `Selected "${step.value}" in "${step.target ?? "select control"}". ${describeResolution(resolution, step.target)}`
    };
  }

  return blocked(step, `Unsupported dynamic action: ${step.action}.`);
}

function blocked(step: DynamicActionStep, actual: string): DynamicStepResult {
  return {
    planStep: step,
    status: "blocked",
    actual
  };
}

function isInputLikeTarget(value?: string): boolean {
  return !!value && /\b(search|input|field|textbox|text box|go to|page input|page field)\b/i.test(value);
}

function isGenericInputTarget(value?: string): boolean {
  return !value || /^(the\s+)?(input|input field|field|textbox|text box)$/i.test(value.trim());
}

async function hasVisibleDialog(page: Page): Promise<boolean> {
  return page
    .locator('.el-dialog__wrapper:visible, [role="dialog"]:visible')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
}

async function resolveDropdownOption(page: Page, value: string): Promise<Locator | undefined> {
  const option = page
    .locator('[role="option"]:visible, .el-select-dropdown__item:visible, .el-dropdown-menu__item:visible, li:visible')
    .filter({ hasText: new RegExp(escapeRegExp(value), "i") })
    .first();

  if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
    return option;
  }

  return undefined;
}

async function resolveRowScopedActionTarget(
  page: Page,
  target: string,
  sourceText: string
): Promise<{ locator: Locator; reason: string } | undefined> {
  if (!isRowScopedAction(target)) return undefined;

  const rowLocator = page.locator(
    'table:visible tbody tr:visible, .el-table__body-wrapper tr:visible'
  );
  const rows = await rowLocator
    .evaluateAll((elements) =>
      elements
        .map((element, index) => ({
          index,
          text: ((element as HTMLElement).innerText || element.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
        }))
        .filter((row) => row.text && !/no data|no results/i.test(row.text))
        .slice(0, 20)
    )
    .catch(() => []);

  if (rows.length === 0) return undefined;

  const quoted = quotedTexts(sourceText).filter((value) => normalizeText(value) !== normalizeText(target));
  const matchingRows = quoted.length > 0
    ? rows.filter((row) => quoted.some((value) => row.text.toLowerCase().includes(value.toLowerCase())))
    : rows;
  const uniqueRows = dedupeRowsByText(matchingRows);

  if (uniqueRows.length !== 1) return undefined;

  const row = rowLocator.nth(uniqueRows[0].index);
  const action = row
    .locator('button:visible, a:visible, [role="button"]:visible, .el-button:visible')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(target)}\\s*$`, "i") })
    .first();

  if (!(await action.isVisible({ timeout: 800 }).catch(() => false))) {
    return undefined;
  }

  const context = quoted.length > 0
    ? `matched row context "${quoted.join(", ")}"`
    : "current table had one unique data row";
  return {
    locator: action,
    reason: `Resolved from row context because ${context}.`
  };
}

function dedupeRowsByText(rows: Array<{ index: number; text: string }>): Array<{ index: number; text: string }> {
  const seen = new Set<string>();
  const unique: Array<{ index: number; text: string }> = [];

  for (const row of rows) {
    const key = normalizeText(row.text);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  return unique;
}

function isRowScopedAction(value: string): boolean {
  return /^(edit|view|details?|detail|delete|remove|approve|reject|copy|duplicate)$/i.test(value.trim());
}

async function evaluateExpectedResults(
  page: Page,
  testCase: NormalizedCase,
  observation: BrowserObservation
): Promise<ExpectedAssertionResult[]> {
  return Promise.all(
    testCase.expected_result.map(async (expected, index) =>
      evaluateExpectedResult(page, expected, index + 1, observation)
    )
  );
}

async function evaluateExpectedResult(
  page: Page,
  expected: string,
  expectedIndex: number,
  observation: BrowserObservation
): Promise<ExpectedAssertionResult> {
  const visibleText = observation.visibleTextSample;
  const normalizedExpected = normalizeText(expected);
  const quoted = quotedTexts(expected);

  if (/no data|no results|no records|empty state/.test(normalizedExpected)) {
    const rowCount = observation.tables.reduce((total, table) => total + table.rowCount, 0);
    const hasEmptyState = /no data|no results|no records|empty/i.test(visibleText);
    const passed = hasEmptyState || rowCount === 0;

    return {
      expectedIndex,
      expectedText: expected,
      status: passed ? "passed" : "failed",
      actual: passed
        ? "Observed an empty result state or zero table rows."
        : `Expected an empty result state, but observed ${rowCount} table row(s).`,
      notes: ["Generic empty-state expected assertion."]
    };
  }

  if (/\b(disabled|not clickable|cannot click)\b/.test(normalizedExpected)) {
    const target = quoted[0] ?? inferButtonName(expected);
    if (target) {
      const button = page
        .locator('button:visible, [role="button"]:visible, .el-button:visible')
        .filter({ hasText: new RegExp(escapeRegExp(target), "i") })
        .first();
      const visible = await button.isVisible({ timeout: 800 }).catch(() => false);
      const disabled = visible && (await button.isDisabled().catch(() => false));

      return {
        expectedIndex,
        expectedText: expected,
        status: disabled ? "passed" : "failed",
        actual: disabled
          ? `Button "${target}" is disabled.`
          : `Expected button "${target}" to be disabled, but it was not observed as disabled.`,
        notes: ["Generic disabled-button expected assertion."]
      };
    }
  }

  const displayedValue = quoted[0];
  if (displayedValue && /\b(display|shown|show|visible|appear|list|table|result|row|field)\b/.test(normalizedExpected)) {
    const passed = normalizeText(visibleText).includes(normalizeText(displayedValue));

    return {
      expectedIndex,
      expectedText: expected,
      status: passed ? "passed" : "failed",
      actual: passed
        ? `Observed expected text "${displayedValue}" on the page.`
        : `Expected text "${displayedValue}" was not found in the observed page text.`,
      notes: ["Generic visible-text expected assertion."]
    };
  }

  return {
    expectedIndex,
    expectedText: expected,
    status: "manual",
    actual: "No reliable generic assertion matched this expected result yet.",
    notes: ["Expected result still needs a stronger assertion strategy."]
  };
}

function formatAssertionSummary(results: ExpectedAssertionResult[]): string {
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const manual = results.filter((result) => result.status === "manual").length;
  return `Generic expected assertions: ${passed} passed, ${failed} failed, ${manual} require review.`;
}

function inferButtonName(value: string): string | undefined {
  const match = value.match(/\b([A-Z][A-Za-z ]{1,30})\s+button\b/);
  return match?.[1]?.trim();
}

function quotedTexts(text: string): string[] {
  return Array.from(text.matchAll(/"([^"]+)"|'([^']+)'/g))
    .map((match) => match[1] ?? match[2])
    .filter(Boolean);
}

function normalizeText(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_/\\.-]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function screenshot(page: Page, runDir: string, fileName: string): Promise<string> {
  await mkdir(runDir, { recursive: true });
  const evidencePath = path.join(runDir, fileName);
  await page.screenshot({ path: evidencePath, fullPage: true });
  return evidencePath;
}

function dynamicBlockedResult(input: {
  testCase: NormalizedCase;
  runId: string;
  plan: DynamicActionPlan;
  status: QaStatus;
  actualResult: string;
  failureReason: string;
  evidencePath?: string;
  stepResults: DynamicStepResult[];
  lastObservation?: BrowserObservation;
  extraNotes?: string[];
}): CaseResult {
  return {
    run_id: input.runId,
    case_execution_id: caseExecutionId(input.runId, input.testCase.stable_id),
    stable_id: input.testCase.stable_id,
    title: input.testCase.title,
    status: input.status,
    precondition_result: "Dynamic runner attempted to interpret the uploaded case text.",
    actual_result: input.actualResult,
    expected_result: input.testCase.expected_result,
    failure_reason: input.failureReason,
    evidence_path: input.evidencePath,
    created_test_data: [],
    depends_on_data: [],
    traceability: buildDynamicTrace(input.testCase, input.plan, input.stepResults),
    notes: [
      "v0.8 dynamic runner attempted this case without requiring a prewritten executor.",
      ...(input.extraNotes ?? []),
      ...formatObservationNotes(input.lastObservation)
    ]
  };
}

function buildDynamicTrace(
  testCase: NormalizedCase,
  plan: DynamicActionPlan,
  stepResults: DynamicStepResult[],
  assertionResults: ExpectedAssertionResult[] = []
): CaseExecutionTrace {
  const resultBySource = new Map(
    stepResults.map((result) => [`${result.planStep.source}:${result.planStep.index}`, result])
  );
  const assertionByIndex = new Map(
    assertionResults.map((result) => [result.expectedIndex, result])
  );

  const preconditionTrace = testCase.precondition
    ? [
        traceEntry(
          "precondition",
          1,
          testCase.precondition,
          resultBySource.get("precondition:1")
        )
      ]
    : [];

  const stepTrace = testCase.steps.map((step, index) =>
    traceEntry("test_step", index + 1, step, resultBySource.get(`test_step:${index + 1}`))
  );

  const expectedTrace = testCase.expected_result.map((expected, index) => {
    const sourceIndex = index + 1;
    const assertion = assertionByIndex.get(sourceIndex);

    return {
      source_type: "expected_result" as const,
      source_index: sourceIndex,
      source_text: expected,
      coverage: assertion && assertion.status !== "manual" ? "covered" as const : "not_covered" as const,
      actual_check:
        assertion?.actual ??
        (plan.expectedChecks[index]?.target
          ? `Dynamic expected check target identified: ${plan.expectedChecks[index].target}.`
          : "Dynamic runner has not implemented reliable generic assertion for this expected result yet."),
      notes: assertion
        ? assertion.notes
        : ["Requires human review or a stronger assertion strategy."]
    };
  });

  const entries = [...preconditionTrace, ...stepTrace, ...expectedTrace];

  return {
    source_workbook: testCase.source.workbook,
    source_sheet: testCase.sheet,
    source_row: testCase.source_row,
    raw_test_case: testCase.raw_source.test_case,
    raw_pre_requisite: testCase.raw_source.pre_requisite,
    raw_test_steps: testCase.raw_source.test_steps,
    raw_expected_result: testCase.raw_source.expected_result,
    contract_id: `${testCase.stable_id}.dynamic.v0.8`,
    precondition_trace: preconditionTrace,
    step_trace: stepTrace,
    expected_trace: expectedTrace,
    coverage_summary: summarizeCoverage(entries),
    alignment_notes: [
      "Dynamic execution trace was generated from uploaded natural-language steps.",
      "This is not a prewritten case-specific executor."
    ]
  };
}

function traceEntry(
  sourceType: "precondition" | "test_step",
  sourceIndex: number,
  sourceText: string,
  result?: DynamicStepResult
): TraceEntry {
  return {
    source_type: sourceType,
    source_index: sourceIndex,
    source_text: sourceText,
    coverage: result?.status === "completed" ? "partially_covered" : "not_executed",
    actual_check: result?.actual ?? "Dynamic runner did not reach this source item.",
    notes: result?.status === "blocked" ? ["Dynamic execution stopped here."] : []
  };
}

function summarizeCoverage(entries: TraceEntry[]): TraceCoverageSummary {
  return entries.reduce<TraceCoverageSummary>(
    (summary, entry) => {
      summary[entry.coverage] += 1;
      return summary;
    },
    {
      covered: 0,
      partially_covered: 0,
      not_covered: 0,
      not_executed: 0
    }
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatObservationNotes(observation?: BrowserObservation): string[] {
  if (!observation) {
    return ["No page observation was captured."];
  }

  const clickableLabels = observation.clickables
    .map((candidate) => candidate.text || candidate.ariaLabel || candidate.title || candidate.className)
    .filter(Boolean)
    .slice(0, 8);
  const inputLabels = observation.inputs
    .map((candidate) => candidate.placeholder || candidate.ariaLabel || candidate.title || candidate.nearText)
    .filter(Boolean)
    .slice(0, 8);

  return [
    `Last observed URL: ${observation.url}`,
    `Visible text sample: ${observation.visibleTextSample.slice(0, 300)}`,
    clickableLabels.length ? `Observed clickables: ${clickableLabels.join(" | ")}` : "Observed clickables: none",
    inputLabels.length ? `Observed inputs: ${inputLabels.join(" | ")}` : "Observed inputs: none",
    observation.tableHeaders.length
      ? `Observed table headers: ${observation.tableHeaders.slice(0, 12).join(" | ")}`
      : "Observed table headers: none"
  ];
}
