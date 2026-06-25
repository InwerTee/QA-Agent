import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import type { RuntimeConfig } from "../runtime/config.js";
import type {
  CaseExecutionTrace,
  CaseResult,
  NormalizedCase,
  QaStatus,
  ResultConfidence,
  TraceCoverageSummary,
  TraceEntry
} from "../types.js";
import { caseExecutionId } from "../core/runIdentity.js";
import type { AdminPageSession } from "../playwright/adminSession.js";
import {
  understandCase,
  type CaseUnderstanding
} from "../understanding/caseUnderstanding.js";
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
import { discoverStartingPage } from "./pageDiscovery.js";
import {
  type AppliedTableFilter,
  checkNoRawNullInTableSamples,
  checkTableHeadersInOrder,
  checkTableRowsMatchFilters,
  checkTableRowsContainValue,
  type TableValueCheck
} from "./tableChecks.js";

interface DynamicRunOptions {
  adminSession?: AdminPageSession;
  siteSession?: AdminPageSession;
}

interface DynamicStepResult {
  planStep: DynamicActionStep;
  status: "completed" | "blocked" | "skipped";
  actual: string;
  blockedStatus?: QaStatus;
}

interface ScopedActionAttempt {
  attempted: boolean;
  actual?: string;
  blockedReason?: string;
}

interface ExpectedAssertionResult {
  expectedIndex: number;
  expectedText: string;
  status: "passed" | "failed" | "manual";
  confidence: ResultConfidence;
  actual: string;
  notes: string[];
}

interface DynamicExecutionContext {
  tableValues: Map<string, string>;
  fillChecks: FillCheckRecord[];
  appliedFilters: AppliedTableFilter[];
  filterSubmissions: FilterSubmissionRecord[];
}

interface FillCheckRecord {
  stepIndex: number;
  sourceText: string;
  fieldPreference?: string;
  value: string;
  check: TableValueCheck;
}

interface FilterSubmissionRecord {
  stepIndex: number;
  submitted: boolean;
  actual: string;
}

interface DynamicOutcomeClassification {
  status: QaStatus;
  confidence: ResultConfidence;
  reason: string;
}

export async function runDynamicCase(
  testCase: NormalizedCase,
  config: RuntimeConfig,
  runDir: string,
  runId: string,
  options: DynamicRunOptions = {}
): Promise<CaseResult> {
  const plan = buildDynamicActionPlan(testCase);
  const understanding = understandCase(testCase);

  const session = options.siteSession ?? (understanding.site === "admin" ? options.adminSession : undefined);
  if (!session) {
    return dynamicBlockedResult({
      testCase,
      runId,
      plan,
      status: "ENV_BLOCKED",
      actualResult: `No ${understanding.site} browser session was available for dynamic execution.`,
      failureReason: `${understanding.site} session is missing.`,
      stepResults: [],
      extraNotes: formatUnderstandingNotes(understanding)
    });
  }

  const { page } = session;
  const stepResults: DynamicStepResult[] = [];
  let lastObservation: BrowserObservation | undefined;
  let discoveryNotes: string[] = [];
  const executionContext: DynamicExecutionContext = {
    tableValues: new Map(),
    fillChecks: [],
    appliedFilters: [],
    filterSubmissions: []
  };

  try {
    const discovery = await discoverStartingPage(page, config, testCase, understanding);
    lastObservation = discovery.observation;
    cacheTableValues(executionContext, lastObservation);
    discoveryNotes = discovery.notes;

    if (!discovery.ready) {
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
        extraNotes: [...formatUnderstandingNotes(understanding), ...discoveryNotes]
      });
    }

    for (const step of plan.steps) {
      const result = await executeDynamicStep(page, step, lastObservation, executionContext);
      stepResults.push(result);
      lastObservation = await observePage(page);
      cacheTableValues(executionContext, lastObservation);

      if (result.status === "blocked") {
        const evidencePath = await screenshot(page, runDir, `${testCase.stable_id}.dynamic-blocked.png`);
        return dynamicBlockedResult({
          testCase,
          runId,
          plan,
          status: result.blockedStatus ?? (step.source === "precondition" ? "SETUP_BLOCKED" : "AGENT_BLOCKED"),
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
      lastObservation ?? (await observePage(page)),
      executionContext
    );
    const outcome = classifyDynamicOutcome(assertionResults, stepResults, plan);
    const assertionSummary = formatAssertionSummary(assertionResults);
    const failedAssertions = assertionResults.filter((result) => result.status === "failed");

    return {
      run_id: runId,
      case_execution_id: caseExecutionId(runId, testCase.stable_id),
      stable_id: testCase.stable_id,
      title: testCase.title,
      status: outcome.status,
      result_confidence: outcome.confidence,
      classification_reason: outcome.reason,
      precondition_result: "Dynamic runner attempted the case from the uploaded natural-language steps.",
      actual_result: formatDynamicActualResult(completed, plan.steps.length, assertionSummary, outcome, failedAssertions),
      expected_result: testCase.expected_result,
      failure_reason: outcome.status === "PRODUCT_BUG" ? failedAssertions[0]?.actual : undefined,
      evidence_path: evidencePath,
      created_test_data: [],
      depends_on_data: [],
      traceability: buildDynamicTrace(testCase, plan, stepResults, assertionResults),
      notes: [
        "v0.10 dynamic runner used case understanding, page discovery, generic browser actions, and confidence-gated assertions rather than a prewritten case executor.",
        ...formatUnderstandingNotes(understanding),
        ...discoveryNotes,
        ...formatAppliedFilterNotes(executionContext.appliedFilters),
        ...formatFilterSubmissionNotes(executionContext.filterSubmissions),
        ...formatFillCheckNotes(executionContext.fillChecks),
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
      extraNotes: [...formatUnderstandingNotes(understanding), ...discoveryNotes]
    });
  }
}

async function executeDynamicStep(
  page: Page,
  step: DynamicActionStep,
  observation: BrowserObservation,
  context: DynamicExecutionContext
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
    const fieldPreference = inferTableFieldPreference(step.sourceText.toLowerCase());
    const inferredFill = step.value
      ? undefined
      : inferFillValueFromObservation(step, observation, context);
    const fillValue = step.value ?? inferredFill?.value;
    const fillTarget = chooseFillTarget(step.target, inferredFill?.target);

    if (!fillValue) {
      if (
        fieldPreference &&
        (observation.tables.length > 0 ||
          observation.tableHeaders.length > 0 ||
          context.tableValues.size > 0)
      ) {
        return blocked(
          step,
          `No usable "${fieldPreference}" value was found in the observed table data for this existing-data step.`,
          "SETUP_BLOCKED"
        );
      }

      return blocked(step, "The dynamic fill step has no clear value to enter.");
    }

    const focusedInput = page
      .locator('input:focus, textarea:focus, [contenteditable="true"]:focus, [role="textbox"]:focus')
      .first();

    if (isGenericInputTarget(step.target) && (await focusedInput.isVisible().catch(() => false))) {
      await focusedInput.fill(fillValue, { timeout: 5000 });
      await page.keyboard.press("Enter").catch(() => undefined);
      const fillCheck = await checkTableAfterFill(page, step, fillValue, fieldPreference);
      if (fillCheck) {
        context.fillChecks.push(fillCheck);
      }

      return {
        planStep: step,
        status: "completed",
        actual: `Filled "${fillValue}" into the currently focused input.${inferredFill ? ` ${inferredFill.reason}` : ""}${fillCheck ? ` ${fillCheck.check.actual}` : ""}`
      };
    }

    const resolution = resolveInputTarget(page, observation, {
      action: "fill",
      target: fillTarget,
      value: fillValue,
      sourceText: step.sourceText
    });

    if (resolution.status !== "found") {
      return blocked(step, describeResolution(resolution, step.target));
    }

    await resolution.locator.fill(fillValue, { timeout: 5000 });
    await page.keyboard.press("Enter").catch(() => undefined);
    const fillCheck = await checkTableAfterFill(page, step, fillValue, fieldPreference);
    if (fillCheck) {
      context.fillChecks.push(fillCheck);
    }

    return {
      planStep: step,
      status: "completed",
      actual: `Filled "${fillValue}" into "${fillTarget ?? "input"}". ${describeResolution(resolution, fillTarget)}${inferredFill ? ` ${inferredFill.reason}` : ""}${fillCheck ? ` ${fillCheck.check.actual}` : ""}`
    };
  }

  if (step.action === "select") {
    if (!step.value) {
      return blocked(
        step,
        "The original step asks the agent to select a dropdown value, but no concrete option value was provided.",
        "MANUAL_REVIEW"
      );
    }

    if (isRangeSelectionStep(step)) {
      if (shouldOpenFilterBeforeSelect(step)) {
        await openFilterIfAvailable(page, observation);
      }

      const rangeResult = await fillLabeledRangeFilter(page, step);
      if (rangeResult) {
        recordRangeFilter(context, step);
        const submission = await submitFilterIfNeeded(page, step, context);
        return {
          planStep: step,
          status: "completed",
          actual: `${rangeResult}${submission ? ` ${submission.actual}` : ""}`
        };
      }
    }

    const optionValues = parseSelectValues(step.value);
    if (optionValues.length === 0) {
      return blocked(
        step,
        "The original step asks the agent to select a dropdown value, but no usable option value could be parsed.",
        "MANUAL_REVIEW"
      );
    }

    if (shouldOpenFilterBeforeSelect(step)) {
      const filterReady = await openFilterIfAvailable(page, observation);
      if (filterReady) {
        const labeledSelection = await selectLabeledOptions(page, step, optionValues);
        if (labeledSelection.actual) {
          recordOneOfFilter(context, step, optionValues);
          const submission = await submitFilterIfNeeded(page, step, context);
          return {
            planStep: step,
            status: "completed",
            actual: `${labeledSelection.actual}${submission ? ` ${submission.actual}` : ""}`
          };
        }

        if (labeledSelection.blockedReason) {
          return blocked(step, labeledSelection.blockedReason);
        }
      }
    }

    let selectObservation = observation;
    let resolution = await resolveSelectTarget(page, selectObservation, {
      action: "select",
      target: step.target,
      value: step.value,
      sourceText: step.sourceText
    });

    if (resolution.status !== "found" && shouldOpenFilterBeforeSelect(step)) {
      const filterResolution = resolveClickTarget(page, selectObservation, {
        action: "click",
        target: "Filter",
        sourceText: "Open Filter"
      });

      if (filterResolution.status === "found") {
        await filterResolution.locator.click({ timeout: 5000 });
        await page.waitForTimeout(700);
        selectObservation = await observePage(page);
        resolution = await resolveSelectTarget(page, selectObservation, {
          action: "select",
          target: step.target,
          value: step.value,
          sourceText: step.sourceText
        });
      }
    }

    if (resolution.status !== "found") {
      const labeledSelection = await selectLabeledOptions(page, step, optionValues);
      if (labeledSelection.actual) {
        recordOneOfFilter(context, step, optionValues);
        const submission = await submitFilterIfNeeded(page, step, context);
        return {
          planStep: step,
          status: "completed",
          actual: `${labeledSelection.actual}${submission ? ` ${submission.actual}` : ""}`
        };
      }

      if (labeledSelection.blockedReason) {
        return blocked(step, labeledSelection.blockedReason);
      }

      return blocked(step, describeResolution(resolution, step.target));
    }

    await resolution.locator.click({ timeout: 5000 });
    const selectedOptions: string[] = [];

    for (const optionValue of optionValues) {
      const clicked = await clickDropdownOptionValue(page, resolution.locator, optionValue);
      if (!clicked) {
        return blocked(
          step,
          `Opened "${step.target ?? "select control"}" but could not find option "${optionValue}". ${describeResolution(resolution, step.target)}`
        );
      }

      selectedOptions.push(optionValue);
    }

    await page.keyboard.press("Escape").catch(() => undefined);
    recordOneOfFilter(context, step, selectedOptions);
    const submission = await submitFilterIfNeeded(page, step, context);
    return {
      planStep: step,
      status: "completed",
      actual: `Selected "${selectedOptions.join(", ")}" in "${step.target ?? "select control"}". ${describeResolution(resolution, step.target)}${submission ? ` ${submission.actual}` : ""}`
    };
  }

  return blocked(step, `Unsupported dynamic action: ${step.action}.`);
}

function blocked(
  step: DynamicActionStep,
  actual: string,
  blockedStatus?: QaStatus
): DynamicStepResult {
  return {
    planStep: step,
    status: "blocked",
    actual,
    blockedStatus
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

async function openFilterIfAvailable(page: Page, observation: BrowserObservation): Promise<boolean> {
  if (await hasVisibleDialog(page)) {
    return true;
  }

  const directFilter = page
    .locator('button:visible, [role="button"]:visible, .el-button:visible, a:visible, div:visible, span:visible')
    .filter({ hasText: /^\s*Filter\s*$/i })
    .first();

  if (await directFilter.isVisible({ timeout: 800 }).catch(() => false)) {
    await directFilter.click({ timeout: 5000 });
    await page.waitForTimeout(700);
    if (await hasVisibleDialog(page)) {
      return true;
    }
  }

  const filterResolution = resolveClickTarget(page, observation, {
    action: "click",
    target: "Filter",
    sourceText: "Open Filter"
  });

  if (filterResolution.status !== "found") {
    return false;
  }

  await filterResolution.locator.click({ timeout: 5000 });
  await page.waitForTimeout(700);
  return true;
}

async function submitFilterIfNeeded(
  page: Page,
  step: DynamicActionStep,
  context: DynamicExecutionContext
): Promise<FilterSubmissionRecord | undefined> {
  if (!shouldTreatAsTableFilter(step)) return undefined;

  const submission = await submitOpenFilterDialog(page);
  context.filterSubmissions.push({
    stepIndex: step.index,
    ...submission
  });

  return {
    stepIndex: step.index,
    ...submission
  };
}

async function submitOpenFilterDialog(page: Page): Promise<Omit<FilterSubmissionRecord, "stepIndex">> {
  const dialog = page.locator('.el-dialog__wrapper:visible, [role="dialog"]:visible').last();
  if (!(await dialog.isVisible({ timeout: 500 }).catch(() => false))) {
    return {
      submitted: true,
      actual: "Filter dialog was already closed."
    };
  }

  const button = dialog
    .locator('button:visible, [role="button"]:visible, .el-button:visible')
    .filter({ hasText: /^\s*(Apply|Search|Confirm|OK|Submit)\s*$/i })
    .last();

  if (!(await button.isVisible({ timeout: 800 }).catch(() => false))) {
    return {
      submitted: false,
      actual: "Filter dialog remained open; no Apply/Search/Confirm/OK/Submit button was found."
    };
  }

  await button.click({ timeout: 5000 });
  await page.waitForTimeout(1200);

  return {
    submitted: true,
    actual: "Submitted the filter dialog."
  };
}

async function selectLabeledOptions(
  page: Page,
  step: DynamicActionStep,
  optionValues: string[]
): Promise<ScopedActionAttempt> {
  const label = formLabelFromStep(step);
  if (!label) return { attempted: false };

  const formItem = await resolveVisibleFormItem(page, label);
  if (!formItem) {
    const observedLabels = await summarizeObservedFormLabels(page);
    return {
      attempted: true,
      blockedReason: `Could not find a visible form field labeled "${label}" in the current dialog or page. Observed form labels: ${observedLabels || "none"}.`
    };
  }

  const selectedOptions: string[] = [];
  const control = await firstVisibleWithin(
    formItem.locator(
      '.el-select, .ant-select, [role="combobox"], .el-input, .el-input__inner, input:not([type="hidden"]), button, [role="button"]'
    )
  );

  for (const optionValue of optionValues) {
    const inlineOption = await resolveInlineOption(formItem, optionValue);
    if (inlineOption) {
      await inlineOption.click({ timeout: 5000 });
      selectedOptions.push(optionValue);
      continue;
    }

    if (!control) {
      return {
        attempted: true,
        blockedReason: `Found form field "${label}", but no visible select/dropdown control was available inside it.`
      };
    }

    const clicked = await clickDropdownOptionValue(page, control, optionValue);
    if (!clicked) {
      return {
        attempted: true,
        blockedReason: `Found form field "${label}" and opened its control, but option "${optionValue}" was not visible in the dropdown.`
      };
    }

    selectedOptions.push(optionValue);
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  return {
    attempted: true,
    actual: `Selected "${selectedOptions.join(", ")}" in form field "${label}" using scoped label matching.`
  };
}

async function fillLabeledRangeFilter(page: Page, step: DynamicActionStep): Promise<string | undefined> {
  const label = formLabelFromStep(step);
  const range = parseRangeValue(step.value);
  if (!label || !range) return undefined;

  const formItem = await resolveVisibleFormItem(page, label);
  const inputs = await resolveRangeInputs(page, label, formItem);
  if (!inputs) {
    const filledByGeometry = await fillRangeInputsByGeometry(page, label, range.min, range.max);
    const filledByPlaceholder = filledByGeometry
      ? false
      : await fillFollowersRangeByPlaceholders(page, label, range.min, range.max);
    if (!filledByGeometry && !filledByPlaceholder) return undefined;

    await page.keyboard.press("Enter").catch(() => undefined);
    return `Filled range "${range.min}-${range.max}" in form field "${label}" using ${filledByGeometry ? "geometric label" : "visible placeholder"} matching.`;
  }

  await inputs[0].fill(range.min, { timeout: 5000 });
  await inputs[1].fill(range.max, { timeout: 5000 });
  await page.keyboard.press("Enter").catch(() => undefined);

  return `Filled range "${range.min}-${range.max}" in form field "${label}" using scoped label matching.`;
}

async function resolveRangeInputs(
  page: Page,
  label: string,
  initialFormItem?: Locator
): Promise<[Locator, Locator] | undefined> {
  const containers: Locator[] = [];
  if (initialFormItem) containers.push(initialFormItem);

  const labelRegex = new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`, "i");
  const exactLabels = page
    .locator('.el-dialog__wrapper:visible label, [role="dialog"]:visible label, .el-form-item__label')
    .filter({ hasText: labelRegex });
  const labelCount = await exactLabels.count().catch(() => 0);

  for (let index = 0; index < Math.min(labelCount, 12); index += 1) {
    const container = exactLabels
      .nth(index)
      .locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " el-form-item ")][1]');
    containers.push(container);
  }

  for (const container of containers) {
    if (!(await container.isVisible({ timeout: 300 }).catch(() => false))) continue;
    const visibleInputs = await visibleLocators(container.locator('input:not([type="hidden"]), textarea'), 2);
    if (visibleInputs.length >= 2) {
      return [visibleInputs[0], visibleInputs[1]];
    }
  }

  return undefined;
}

async function fillRangeInputsByGeometry(
  page: Page,
  label: string,
  min: string,
  max: string
): Promise<boolean> {
  return page
    .evaluate(
      ({ labelText, minValue, maxValue }) => {
        function visible(element: Element): boolean {
          const htmlElement = element as HTMLElement;
          const rect = htmlElement.getBoundingClientRect();
          const style = window.getComputedStyle(htmlElement);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        }

        function text(element: Element): string {
          return ((element as HTMLElement).innerText || element.textContent || "").replace(/\s+/g, " ").trim();
        }

        function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
          const prototype = input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          setter?.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }

        const roots = Array.from(document.querySelectorAll('.el-dialog__wrapper, [role="dialog"], body'))
          .filter(visible);
        const normalizedLabel = labelText.toLowerCase();

        for (const root of roots) {
          const labelElement = Array.from(root.querySelectorAll("label, .el-form-item__label"))
            .find((element) => visible(element) && text(element).toLowerCase() === normalizedLabel);

          if (!labelElement) continue;

          const labelRect = (labelElement as HTMLElement).getBoundingClientRect();
          const inputs = Array.from(root.querySelectorAll("input:not([type='hidden']), textarea"))
            .filter((element): element is HTMLInputElement | HTMLTextAreaElement =>
              visible(element) && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
            )
            .map((element) => ({
              element,
              rect: element.getBoundingClientRect()
            }))
            .filter(({ rect }) =>
              rect.top >= labelRect.top - 10 &&
              rect.top <= labelRect.bottom + 80 &&
              rect.left >= labelRect.left - 20
            )
            .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);

          if (inputs.length < 2) continue;

          setValue(inputs[0].element, minValue);
          setValue(inputs[1].element, maxValue);
          return true;
        }

        return false;
      },
      {
        labelText: label,
        minValue: min,
        maxValue: max
      }
    )
    .catch(() => false);
}

async function fillFollowersRangeByPlaceholders(
  page: Page,
  label: string,
  min: string,
  max: string
): Promise<boolean> {
  if (!/^followers?$/i.test(label.trim())) return false;

  const dialog = page.locator('.el-dialog__wrapper:visible, [role="dialog"]:visible').last();
  if (!(await dialog.isVisible({ timeout: 300 }).catch(() => false))) return false;

  const lowest = await firstVisibleWithin(dialog.locator('input[placeholder="Lowest"], input[placeholder*="Lowest" i]'));
  const highest = await firstVisibleWithin(dialog.locator('input[placeholder="Highest"], input[placeholder*="Highest" i]'));
  if (!lowest || !highest) return false;

  await lowest.fill(min, { timeout: 5000 });
  await highest.fill(max, { timeout: 5000 });
  return true;
}

async function visibleLocators(locator: Locator, limit: number): Promise<Locator[]> {
  const count = await locator.count().catch(() => 0);
  const visible: Locator[] = [];

  for (let index = 0; index < Math.min(count, 30); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible({ timeout: 200 }).catch(() => false)) {
      visible.push(candidate);
      if (visible.length >= limit) break;
    }
  }

  return visible;
}

async function resolveVisibleFormItem(page: Page, label: string): Promise<Locator | undefined> {
  const normalizedLabel = normalizeText(label);
  const scopes = [
    page.locator('.el-dialog__wrapper:visible, [role="dialog"]:visible').last(),
    page.locator('.el-drawer:visible, .el-drawer__body:visible').last(),
    page.locator('.el-popover:visible, .el-popper:visible, [role="tooltip"]:visible').last(),
    page.locator("body").first()
  ];

  for (const scope of scopes) {
    if (!(await scope.isVisible({ timeout: 300 }).catch(() => false))) {
      continue;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const item = await resolveVisibleFormItemInScope(scope, normalizedLabel);
      if (item) return item;

      const scrolled = await scrollScopeDown(scope);
      if (!scrolled) break;
      await scope.page().waitForTimeout(200);
    }
  }

  return undefined;
}

async function resolveVisibleFormItemInScope(
  scope: Locator,
  normalizedLabel: string
): Promise<Locator | undefined> {
    const items = scope.locator('.el-form-item, .form-item, .ant-form-item');
    const count = await items.count().catch(() => 0);

    for (let index = 0; index < Math.min(count, 220); index += 1) {
      const item = items.nth(index);
      const itemLabel = await extractFormItemLabel(item);
      const normalizedItemLabel = normalizeText(itemLabel);
      const itemText = normalizeText(await item.innerText({ timeout: 300 }).catch(() => ""));

      if (
        normalizedItemLabel === normalizedLabel ||
        normalizedItemLabel.includes(normalizedLabel) ||
        itemText.startsWith(normalizedLabel) ||
        itemText.includes(` ${normalizedLabel} `)
      ) {
        await item.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
        return item;
      }
    }

  return undefined;
}

async function scrollScopeDown(scope: Locator): Promise<boolean> {
  return scope
    .evaluate((root) => {
      const candidates = [
        root,
        ...Array.from(
          root.querySelectorAll(
            '.el-dialog__body, .el-drawer__body, .el-scrollbar__wrap, .screen-box, form'
          )
        )
      ] as HTMLElement[];
      const scrollTarget = candidates.find((element) => element.scrollHeight > element.clientHeight + 20);

      if (!scrollTarget) {
        return false;
      }

      const before = scrollTarget.scrollTop;
      scrollTarget.scrollTop = Math.min(
        scrollTarget.scrollTop + Math.max(240, scrollTarget.clientHeight * 0.8),
        scrollTarget.scrollHeight
      );

      return scrollTarget.scrollTop > before;
    })
    .catch(() => false);
}

async function summarizeObservedFormLabels(page: Page): Promise<string> {
  const scope = page
    .locator('.el-dialog__wrapper:visible, [role="dialog"]:visible, .el-drawer:visible, .el-drawer__body:visible, body')
    .first();

  return scope
    .locator('label, .el-form-item__label, .ant-form-item-label')
    .evaluateAll((elements) =>
      Array.from(
        new Set(
          elements
            .map((element) => ((element as HTMLElement).innerText || element.textContent || "").trim())
            .filter(Boolean)
        )
      ).slice(0, 24)
    )
    .then((labels) => labels.join(" | "))
    .catch(() => "");
}

async function extractFormItemLabel(item: Locator): Promise<string> {
  const labels = await item
    .locator('label, .el-form-item__label, .ant-form-item-label, [class*="label"]')
    .evaluateAll((elements) =>
      elements
        .map((element) => ((element as HTMLElement).innerText || element.textContent || "").trim())
        .filter(Boolean)
    )
    .catch(() => []);

  return labels[0] ?? "";
}

async function firstVisibleWithin(locator: Locator): Promise<Locator | undefined> {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 20); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible({ timeout: 200 }).catch(() => false)) {
      return candidate;
    }
  }

  return undefined;
}

async function resolveInlineOption(scope: Locator, value: string): Promise<Locator | undefined> {
  const option = scope
    .locator(
      'button:visible, label:visible, span:visible, li:visible, [role="option"]:visible, [role="radio"]:visible, [role="checkbox"]:visible, .el-radio-button:visible, .el-checkbox:visible'
    )
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`, "i") })
    .first();

  if (await option.isVisible({ timeout: 500 }).catch(() => false)) {
    return option;
  }

  return undefined;
}

async function clickDropdownOptionValue(page: Page, control: Locator, value: string): Promise<boolean> {
  let option = await resolveDropdownOption(page, value);
  if (!option) {
    await control.click({ timeout: 5000 });
    await page.waitForTimeout(200);
    option = await resolveDropdownOption(page, value);
  }

  if (!option) {
    return false;
  }

  try {
    await option.click({ timeout: 5000 });
    return true;
  } catch {
    await control.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(200);
    const retryOption = await resolveDropdownOption(page, value);
    if (!retryOption) return false;
    await retryOption.click({ timeout: 5000 });
    return true;
  }
}

async function resolveDropdownOption(page: Page, value: string): Promise<Locator | undefined> {
  const exactOption = page
    .locator('[role="option"], .el-select-dropdown__item, .el-dropdown-menu__item, .el-cascader-node, li')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`, "i") });
  const exactVisible = await firstVisibleWithin(exactOption);

  if (exactVisible) {
    return exactVisible;
  }

  const containsOption = page
    .locator('[role="option"], .el-select-dropdown__item, .el-dropdown-menu__item, .el-cascader-node, li')
    .filter({ hasText: new RegExp(escapeRegExp(value), "i") });
  const containsVisible = await firstVisibleWithin(containsOption);

  if (containsVisible) {
    return containsVisible;
  }

  return undefined;
}

function parseSelectValues(value: string): string[] {
  return value
    .split(/[,;/]|\band\b|\bor\b/i)
    .map((option) => option.trim())
    .map((option) => option.replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function isRangeSelectionStep(step: DynamicActionStep): boolean {
  return Boolean(parseRangeValue(step.value)) && /\b(range|min|max|lowest|highest|followers?|gpm|size)\b/i.test(
    `${step.sourceText} ${step.target ?? ""}`
  );
}

function parseRangeValue(value?: string): { min: string; max: string } | undefined {
  const match = value?.match(/^\s*(\d+(?:\.\d+)?)\s*[-–—~]\s*(\d+(?:\.\d+)?)\s*$/);
  if (!match?.[1] || !match[2]) return undefined;

  return {
    min: match[1],
    max: match[2]
  };
}

function recordOneOfFilter(
  context: DynamicExecutionContext,
  step: DynamicActionStep,
  values: string[]
): void {
  const label = formLabelFromStep(step);
  const cleanedValues = values.map((value) => value.trim()).filter(Boolean);
  if (!label || cleanedValues.length === 0 || !shouldTreatAsTableFilter(step)) return;

  upsertAppliedFilter(context, {
    label,
    kind: "one_of",
    values: cleanedValues,
    sourceText: step.sourceText
  });
}

function recordRangeFilter(
  context: DynamicExecutionContext,
  step: DynamicActionStep
): void {
  const label = formLabelFromStep(step);
  const range = parseRangeValue(step.value);
  if (!label || !range || !shouldTreatAsTableFilter(step)) return;

  upsertAppliedFilter(context, {
    label,
    kind: "range",
    min: Number(range.min),
    max: Number(range.max),
    sourceText: step.sourceText
  });
}

function shouldTreatAsTableFilter(step: DynamicActionStep): boolean {
  return /\b(filter|criteria|table|row|result|matching)\b/i.test(step.sourceText);
}

function upsertAppliedFilter(
  context: DynamicExecutionContext,
  filter: AppliedTableFilter
): void {
  const key = normalizeText(filter.label);
  const existingIndex = context.appliedFilters.findIndex((existing) => normalizeText(existing.label) === key);

  if (existingIndex >= 0) {
    context.appliedFilters[existingIndex] = filter;
    return;
  }

  context.appliedFilters.push(filter);
}

function formLabelFromStep(step: DynamicActionStep): string | undefined {
  const targetLabel = formLabelFromTarget(step.target);
  if (targetLabel) return targetLabel;

  const quotedColon = quotedTexts(step.sourceText)
    .map((value) => value.match(/^([^:]{2,60}):\s*.+$/)?.[1]?.trim())
    .find(Boolean);
  if (quotedColon) return quotedColon;

  const colonMatch = step.sourceText.match(/\b([A-Z][A-Za-z0-9 /&()_-]{1,60})\s*:\s*[^.;]+/);
  return colonMatch?.[1]?.trim();
}

function formLabelFromTarget(target?: string): string | undefined {
  if (!target) return undefined;

  const label = target
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/^(master campaign|campaign|filter)\s+/i, "")
    .replace(/\b(dropdown|select|selection|multiselect|multi-select|field|input|control|filter|range)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return label.length > 1 ? label : undefined;
}

function shouldOpenFilterBeforeSelect(step: DynamicActionStep): boolean {
  return /\b(filter|criteria)\b/i.test(step.sourceText) || /\b(filter|platform|status|employee|followers|account type)\b/i.test(step.target ?? "");
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

async function checkTableAfterFill(
  page: Page,
  step: DynamicActionStep,
  value: string,
  fieldPreference?: string
): Promise<FillCheckRecord | undefined> {
  if (!shouldCheckTableAfterFill(step.sourceText)) return undefined;

  await page.waitForTimeout(700);
  const observation = await observePage(page);
  const check = checkTableRowsContainValue(observation, value);

  return {
    stepIndex: step.index,
    sourceText: step.sourceText,
    fieldPreference,
    value,
    check
  };
}

function shouldCheckTableAfterFill(sourceText: string): boolean {
  return /\b(search|result|table|row|check|matching|criteria)\b/i.test(sourceText);
}

async function evaluateExpectedResults(
  page: Page,
  testCase: NormalizedCase,
  observation: BrowserObservation,
  context: DynamicExecutionContext
): Promise<ExpectedAssertionResult[]> {
  return Promise.all(
    testCase.expected_result.map(async (expected, index) =>
      evaluateExpectedResult(page, expected, index + 1, observation, context)
    )
  );
}

function classifyDynamicOutcome(
  assertionResults: ExpectedAssertionResult[],
  stepResults: DynamicStepResult[],
  plan: DynamicActionPlan
): DynamicOutcomeClassification {
  const failed = assertionResults.filter((result) => result.status === "failed");
  const manual = assertionResults.filter((result) => result.status === "manual");
  const checked = assertionResults.filter((result) => result.status !== "manual");
  const completedSteps = stepResults.filter((result) => result.status === "completed").length;
  const allStepsCompleted = completedSteps === plan.steps.length;
  const highConfidenceFailed = failed.filter((result) => result.confidence === "high");
  const allExpectedChecked =
    assertionResults.length > 0 &&
    checked.length === assertionResults.length;
  const allCheckedPassed =
    allExpectedChecked &&
    assertionResults.every((result) => result.status === "passed");
  const allHighConfidence =
    assertionResults.length > 0 &&
    assertionResults.every((result) => result.confidence === "high");

  if (highConfidenceFailed.length > 0 && allStepsCompleted) {
    return {
      status: "PRODUCT_BUG",
      confidence: "high",
      reason: `High-confidence expected assertion failed: ${highConfidenceFailed[0].actual}`
    };
  }

  if (failed.length > 0) {
    return {
      status: "MANUAL_REVIEW",
      confidence: "medium",
      reason:
        "One or more generic assertions failed, but confidence was not high enough to classify this as a product bug."
    };
  }

  if (allCheckedPassed && allHighConfidence && allStepsCompleted) {
    return {
      status: "PASS",
      confidence: "high",
      reason: "All planned steps completed and every expected result was covered by a high-confidence assertion."
    };
  }

  if (allCheckedPassed) {
    return {
      status: "MANUAL_REVIEW",
      confidence: "medium",
      reason:
        "All checkable assertions passed, but at least one assertion used medium confidence or execution coverage was incomplete."
    };
  }

  return {
    status: "MANUAL_REVIEW",
    confidence: manual.length > 0 ? "low" : "medium",
    reason:
      manual.length > 0
        ? "The case executed, but at least one expected result still lacks a reliable generic assertion."
        : "The case executed, but expected-result coverage was incomplete."
  };
}

function formatDynamicActualResult(
  completed: number,
  total: number,
  assertionSummary: string,
  outcome: DynamicOutcomeClassification,
  failedAssertions: ExpectedAssertionResult[]
): string {
  if (outcome.status === "PRODUCT_BUG" && failedAssertions.length > 0) {
    return `Dynamic runner completed ${completed}/${total} planned step(s), and a high-confidence expected assertion failed: ${failedAssertions[0].actual}`;
  }

  if (outcome.status === "PASS") {
    return `Dynamic runner completed ${completed}/${total} planned step(s), and all high-confidence generic expected assertions passed.`;
  }

  return `Dynamic runner completed ${completed}/${total} planned step(s). ${assertionSummary} Classification: ${outcome.reason}`;
}

async function evaluateExpectedResult(
  page: Page,
  expected: string,
  expectedIndex: number,
  observation: BrowserObservation,
  context: DynamicExecutionContext
): Promise<ExpectedAssertionResult> {
  const visibleText = observation.visibleTextSample;
  const normalizedExpected = normalizeText(expected);
  const quoted = quotedTexts(expected);

  if (isSearchResultExpected(normalizedExpected) && context.fillChecks.length > 0) {
    const failedChecks = context.fillChecks.filter((record) => record.check.status !== "matched");
    const allCheckable = context.fillChecks.every((record) =>
      record.check.status === "matched" || record.check.status === "not_matched"
    );

    return {
      expectedIndex,
      expectedText: expected,
      status: failedChecks.length === 0 && allCheckable ? "passed" : "failed",
      confidence: allCheckable ? "high" : "medium",
      actual: failedChecks.length === 0
        ? `All ${context.fillChecks.length} search/table check(s) matched their entered values.`
        : `Search/table check failed after "${failedChecks[0].value}": ${failedChecks[0].check.actual}`,
      notes: [
        "Generic search-result assertion based on sampled table rows after each fill.",
        ...context.fillChecks.map((record) => `Step ${record.stepIndex}: ${record.check.actual}`)
      ]
    };
  }

  if (isFilterResultExpected(normalizedExpected) && context.appliedFilters.length > 0) {
    const filterCheck = checkTableRowsMatchFilters(observation, context.appliedFilters);
    const submitted = filtersSubmittedForAssertion(context);

    return {
      expectedIndex,
      expectedText: expected,
      status:
        !submitted || filterCheck.status === "not_checkable"
          ? "manual"
          : filterCheck.status === "failed"
            ? "failed"
            : filterCheck.status === "passed"
              ? "passed"
              : "manual",
      confidence:
        !submitted || filterCheck.status === "not_checkable"
          ? "medium"
          : filterCheck.status === "passed" || filterCheck.status === "failed"
            ? "high"
            : "medium",
      actual: filterCheck.actual,
      notes: [
        "Generic table filter assertion based on applied filters and sampled table rows.",
        `Applied filters: ${formatAppliedFilters(context.appliedFilters)}.`,
        ...formatFilterSubmissionNotes(context.filterSubmissions)
      ]
    };
  }

  if (/\b(column|columns|header|headers|table header)\b/.test(normalizedExpected)) {
    const explicitHeaders = quoted.filter((value) => !/^-+$/.test(value.trim()));
    const headerCheck = checkTableHeadersInOrder(observation, explicitHeaders);

    if (headerCheck.status !== "not_checkable") {
      return {
        expectedIndex,
        expectedText: expected,
        status: headerCheck.status === "passed" ? "passed" : "failed",
        confidence: "high",
        actual: headerCheck.actual,
        notes: ["Generic table-header order assertion."]
      };
    }
  }

  if (/\b(null|empty|undefined)\b/.test(normalizedExpected) && /\b(table|cell|data|row)\b/.test(normalizedExpected)) {
    const nullCheck = checkNoRawNullInTableSamples(observation);

    if (nullCheck.status !== "not_checkable") {
      return {
        expectedIndex,
        expectedText: expected,
        status: nullCheck.status === "passed" ? "passed" : "failed",
        confidence: "medium",
        actual: nullCheck.actual,
        notes: ["Generic sampled table null-display assertion."]
      };
    }
  }

  if (/no data|no results|no records|empty state/.test(normalizedExpected)) {
    const rowCount = observation.tables.reduce((total, table) => total + table.rowCount, 0);
    const hasEmptyState = /no data|no results|no records|empty/i.test(visibleText);
    const passed = hasEmptyState || rowCount === 0;

    return {
      expectedIndex,
      expectedText: expected,
      status: passed ? "passed" : "failed",
      confidence: "high",
      actual: passed
        ? "Observed an empty result state or zero table rows."
        : `Expected an empty result state, but observed ${rowCount} table row(s).`,
      notes: ["Generic empty-state expected assertion."]
    };
  }

  if (isValidationExpected(normalizedExpected)) {
    const expectedMessages = inferExpectedValidationMessages(expected, quoted);
    const normalizedVisible = normalizeText(visibleText);
    const matchedMessage = expectedMessages.find((message) =>
      normalizedVisible.includes(normalizeText(message))
    );
    const passed = expectedMessages.length > 0
      ? Boolean(matchedMessage)
      : /\b(required|mandatory|invalid|error|failed|cannot|missing)\b/.test(normalizedVisible);

    return {
      expectedIndex,
      expectedText: expected,
      status: passed ? "passed" : "failed",
      confidence: quoted.length > 0 || expectedMessages.length > 0 ? "medium" : "low",
      actual: passed
        ? matchedMessage
          ? `Observed validation/error text matching "${matchedMessage}".`
          : "Observed validation/error-like text on the page."
        : `Expected validation/error feedback was not found in the observed page text.`,
      notes: ["Generic validation/toast/error assertion."]
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
        confidence: "high",
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
      confidence: "medium",
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
    confidence: "low",
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

function isSearchResultExpected(normalizedExpected: string): boolean {
  return (
    /\b(search|matching|criteria|keyword)\b/.test(normalizedExpected) &&
    /\b(table|row|rows|result|results|show|display|updates?)\b/.test(normalizedExpected)
  );
}

function isFilterResultExpected(normalizedExpected: string): boolean {
  return (
    /\b(filter|filters|criteria|matching|specified criteria|and logic)\b/.test(normalizedExpected) &&
    /\b(table|row|rows|record|records|result|results|display|show)\b/.test(normalizedExpected)
  );
}

function filtersSubmittedForAssertion(context: DynamicExecutionContext): boolean {
  return context.appliedFilters.length > 0 &&
    context.filterSubmissions.length > 0 &&
    context.filterSubmissions.every((submission) => submission.submitted);
}

function isValidationExpected(normalizedExpected: string): boolean {
  return /\b(required|mandatory|invalid|validation|toast|error|warning|missing|failed|failure|cannot save|not allow|not allowed)\b/.test(normalizedExpected);
}

function inferExpectedValidationMessages(expected: string, quoted: string[]): string[] {
  const messages = [...quoted];
  const colonMatch = expected.match(/\b(?:message|error|toast|warning|value)\s*:\s*(.+?)(?:\.|$)/i);
  if (colonMatch?.[1]) {
    messages.push(colonMatch[1].trim());
  }

  const missingMandatoryMatch = expected.match(/\bmissing mandatory value:\s*([^.;]+)/i);
  if (missingMandatoryMatch?.[1]) {
    messages.push(`Missing mandatory value: ${missingMandatoryMatch[1].trim()}`);
    messages.push(missingMandatoryMatch[1].trim());
  }

  return Array.from(new Set(messages.map((message) => message.trim()).filter(Boolean)));
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

function formatUnderstandingNotes(understanding: CaseUnderstanding): string[] {
  return [
    `v0.9 case understanding: site=${understanding.site} (${understanding.siteConfidence}), module=${understanding.module} (${understanding.moduleConfidence}), action=${understanding.action}, confidence=${understanding.confidence}.`,
    understanding.routeHints.moduleLabels.length
      ? `Module discovery labels: ${understanding.routeHints.moduleLabels.join(" | ")}.`
      : "Module discovery labels: none.",
    understanding.routeHints.candidateRoutes.length
      ? `Candidate routes: ${understanding.routeHints.candidateRoutes.join(" | ")}.`
      : "Candidate routes: none; page discovery will start from the site root.",
    understanding.preconditions.length
      ? `Understood preconditions: ${understanding.preconditions.map((item) => `${item.kind}: ${item.text}`).join(" | ")}.`
      : "Understood preconditions: none.",
    understanding.assertions.length
      ? `Understood expected assertions: ${understanding.assertions.map((item) => item.kind).join(" | ")}.`
      : "Understood expected assertions: none."
  ];
}

function formatFillCheckNotes(fillChecks: FillCheckRecord[]): string[] {
  if (fillChecks.length === 0) return [];

  return [
    `Table checks after fill steps: ${fillChecks.length}.`,
    ...fillChecks.map((record) =>
      `Fill check step ${record.stepIndex}${record.fieldPreference ? ` (${record.fieldPreference})` : ""}: ${record.check.actual}`
    )
  ];
}

function formatAppliedFilterNotes(filters: AppliedTableFilter[]): string[] {
  if (filters.length === 0) return [];

  return [`Applied table filters: ${formatAppliedFilters(filters)}.`];
}

function formatFilterSubmissionNotes(submissions: FilterSubmissionRecord[]): string[] {
  if (submissions.length === 0) return [];

  return [
    `Filter submissions: ${submissions.length}.`,
    ...submissions.map((submission) =>
      `Filter submission step ${submission.stepIndex}: ${submission.submitted ? "submitted" : "not submitted"} - ${submission.actual}`
    )
  ];
}

function formatAppliedFilters(filters: AppliedTableFilter[]): string {
  return filters.map((filter) => {
    if (filter.kind === "one_of") {
      return `${filter.label} in [${filter.values.join(", ")}]`;
    }

    return `${filter.label} between ${filter.min} and ${filter.max}`;
  }).join("; ");
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
    result_confidence: confidenceForBlockedStatus(input.status),
    classification_reason: classificationReasonForBlockedStatus(input.status, input.failureReason),
    precondition_result: "Dynamic runner attempted to interpret the uploaded case text.",
    actual_result: input.actualResult,
    expected_result: input.testCase.expected_result,
    failure_reason: input.failureReason,
    evidence_path: input.evidencePath,
    created_test_data: [],
    depends_on_data: [],
    traceability: buildDynamicTrace(input.testCase, input.plan, input.stepResults),
    notes: [
      "v0.9 dynamic runner attempted this case without requiring a prewritten executor.",
      ...(input.extraNotes ?? []),
      ...formatObservationNotes(input.lastObservation)
    ]
  };
}

function confidenceForBlockedStatus(status: QaStatus): ResultConfidence {
  if (status === "SETUP_BLOCKED" || status === "ENV_BLOCKED" || status === "SCRIPT_BLOCKED") {
    return "high";
  }

  if (status === "AGENT_BLOCKED") {
    return "medium";
  }

  return "low";
}

function classificationReasonForBlockedStatus(status: QaStatus, reason: string): string {
  switch (status) {
    case "SETUP_BLOCKED":
      return `Prerequisite or test data blocked execution: ${reason}`;
    case "ENV_BLOCKED":
      return `Environment or authentication blocked execution: ${reason}`;
    case "SCRIPT_BLOCKED":
      return `Runtime/script guard blocked execution: ${reason}`;
    case "AGENT_BLOCKED":
      return `Agent capability gap blocked execution: ${reason}`;
    case "PRODUCT_BUG":
      return `High-confidence product mismatch: ${reason}`;
    case "PASS":
      return "All automated checks passed.";
    case "MANUAL_REVIEW":
      return `Manual review required: ${reason}`;
  }
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
        assertion
          ? `${assertion.actual} (confidence=${assertion.confidence})`
          :
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
    contract_id: `${testCase.stable_id}.dynamic.v0.9`,
    precondition_trace: preconditionTrace,
    step_trace: stepTrace,
    expected_trace: expectedTrace,
    coverage_summary: summarizeCoverage(entries),
    alignment_notes: [
      "Dynamic execution trace was generated from uploaded natural-language steps.",
      "v0.9 understanding and page discovery were used before generic browser execution.",
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

interface InferredFillValue {
  target: string;
  value: string;
  reason: string;
}

function inferFillValueFromObservation(
  step: DynamicActionStep,
  observation: BrowserObservation,
  context: DynamicExecutionContext
): InferredFillValue | undefined {
  const source = step.sourceText.toLowerCase();
  if (!/\b(type|enter|input|fill)\b/.test(source)) return undefined;

  const fieldPreference = inferTableFieldPreference(source);
  const value = fieldPreference
    ? valueFromTableField(observation, fieldPreference) ?? context.tableValues.get(fieldPreference)
    : firstTableSampleValue(observation);

  if (!value) return undefined;

  const adjustedValue = /partial/.test(source) && value.length > 3
    ? value.slice(0, Math.max(3, Math.ceil(value.length / 2)))
    : value;

  return {
    target: inferFillTargetFromObservation(observation) ?? step.target ?? "Search",
    value: adjustedValue,
    reason: `Inferred input value from current table sample${fieldPreference ? ` (${fieldPreference})` : ""}.`
  };
}

function cacheTableValues(context: DynamicExecutionContext, observation: BrowserObservation): void {
  for (const field of ["user name", "email", "phone", "agency", "remark", "campaign"]) {
    if (!context.tableValues.has(field)) {
      const value = valueFromTableField(observation, field);
      if (value) {
        context.tableValues.set(field, value);
      }
    }
  }
}

function inferFillTargetFromObservation(observation: BrowserObservation): string | undefined {
  const input = observation.inputs.find((candidate) => {
    const haystack = normalizeForMatch(
      [
        candidate.placeholder,
        candidate.ariaLabel,
        candidate.title,
        candidate.name,
        candidate.id,
        candidate.nearText
      ].join(" ")
    );

    return /search|keyword|please enter|query/.test(haystack);
  });

  return input?.placeholder || input?.ariaLabel || input?.title || input?.name || input?.id || undefined;
}

function chooseFillTarget(
  explicitTarget: string | undefined,
  inferredTarget: string | undefined
): string | undefined {
  if (explicitTarget && !isGenericSearchTarget(explicitTarget)) {
    return explicitTarget;
  }

  return inferredTarget ?? explicitTarget;
}

function isGenericSearchTarget(target: string): boolean {
  return /^(search|keyword|query|search input)$/i.test(target.trim());
}

function inferTableFieldPreference(source: string): string | undefined {
  if (/user\s*name|username/.test(source)) return "user name";
  if (/\bemail\b/.test(source)) return "email";
  if (/\bphone\b/.test(source)) return "phone";
  if (/\bagency\b/.test(source)) return "agency";
  if (/\bremark\b/.test(source)) return "remark";
  if (/\bcampaign\b/.test(source)) return "campaign";
  return undefined;
}

function valueFromTableField(
  observation: BrowserObservation,
  fieldPreference: string
): string | undefined {
  const normalizedPreference = normalizeForMatch(fieldPreference);
  const headerIndexes = observation.tables.flatMap((table) =>
    table.headers
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => headerMatchesField(header, normalizedPreference))
  );

  for (const { index } of headerIndexes) {
    for (const table of observation.tables) {
      for (const row of table.sampleRows) {
        const value = alignedRowValue(row, table.headers, index);
        if (isUsableSampleValue(value)) return value;
      }
    }
  }

  for (const table of observation.tables) {
    const headerIndex = table.headers.findIndex((header) =>
      headerMatchesField(header, normalizedPreference)
    );
    if (headerIndex < 0) continue;

    for (const row of table.sampleRows) {
      const value = alignedRowValue(row, table.headers, headerIndex);
      if (isUsableSampleValue(value)) return value;
    }
  }

  return undefined;
}

function headerMatchesField(header: string, normalizedPreference: string): boolean {
  const normalizedHeader = normalizeForMatch(header);
  if (!normalizedHeader.includes(normalizedPreference)) return false;

  if (
    normalizedPreference === "agency" &&
    /\bis under agency\b|\bagency status\b|\bagency type\b/.test(normalizedHeader)
  ) {
    return false;
  }

  return true;
}

function alignedRowValue(
  row: string[],
  headers: string[],
  headerIndex: number
): string | undefined {
  const hasLeadingEmptyCell =
    headers.length > 0 &&
    !isUsableSampleValue(row[0]) &&
    isUsableSampleValue(row[headerIndex + 1]);

  if (hasLeadingEmptyCell) {
    return row[headerIndex + 1]?.trim();
  }

  const directValue = row[headerIndex]?.trim();
  if (isUsableSampleValue(directValue)) return directValue;

  return directValue;
}

function firstTableSampleValue(observation: BrowserObservation): string | undefined {
  for (const table of observation.tables) {
    for (const row of table.sampleRows) {
      const value = row.find(isUsableSampleValue);
      if (value) return value;
    }
  }

  return undefined;
}

function isUsableSampleValue(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed !== "-" && !/^n\/a$/i.test(trimmed);
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
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
