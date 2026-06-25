import { expect, test } from "@playwright/test";
import { buildDynamicActionPlan } from "../../src/dynamic/actionPlan.js";
import type { NormalizedCase } from "../../src/types.js";

test("dynamic action plan is generated from uploaded case text", () => {
  const plan = buildDynamicActionPlan(
    fakeCase({
      precondition: "User is on the Campaign List Page.",
      steps: [
        "User clicks the \"Filter\" button.",
        "In the Status dropdown, user selects \"In Progress\".",
        "User clicks \"Apply\".",
        "User waits for the table to refresh."
      ],
      expectedResult: [
        "The table displays only In Progress campaigns.",
        "The active filter state is shown."
      ]
    })
  );

  expect(plan.caseId).toBe("GEN-TC01");
  expect(plan.steps.map((step) => step.action)).toEqual([
    "navigate",
    "click",
    "select",
    "click",
    "wait"
  ]);
  expect(plan.steps[1]).toEqual(
    expect.objectContaining({
      action: "click",
      target: "Filter"
    })
  );
  expect(plan.steps[2]).toEqual(
    expect.objectContaining({
      action: "select",
      target: "Status dropdown",
      value: "In Progress"
    })
  );
  expect(plan.expectedChecks).toHaveLength(2);
});

test("dynamic action plan treats unknown wording as observation instead of pretending certainty", () => {
  const plan = buildDynamicActionPlan(
    fakeCase({
      steps: ["User validates that the business rule is correct."],
      expectedResult: ["All values are correct."]
    })
  );

  expect(plan.steps[0]).toEqual(
    expect.objectContaining({
      action: "observe",
      confidence: "low"
    })
  );
});

test("dynamic action plan treats wait with Enter as a trigger instead of a fill step", () => {
  const plan = buildDynamicActionPlan(
    fakeCase({
      steps: ["User waits for the search to trigger (auto or presses Enter)."],
      expectedResult: ["The search result updates."]
    })
  );

  expect(plan.steps[0]).toEqual(
    expect.objectContaining({
      action: "wait"
    })
  );
  expect(plan.steps[0]).not.toHaveProperty("value");
});

test("dynamic action plan does not treat typed values as field targets", () => {
  const plan = buildDynamicActionPlan(
    fakeCase({
      steps: ['User types "11" (a value greater than the total pages).'],
      expectedResult: ["The page does not navigate."]
    })
  );

  expect(plan.steps[0]).toEqual(
    expect.objectContaining({
      action: "fill",
      target: undefined,
      value: "11"
    })
  );
});

test("dynamic action plan normalizes pagination symbols into named controls", () => {
  const plan = buildDynamicActionPlan(
    fakeCase({
      steps: ['User clicks the ">" (Next) button.'],
      expectedResult: ["The next page is shown."]
    })
  );

  expect(plan.steps[0]).toEqual(
    expect.objectContaining({
      action: "click",
      target: "Next"
    })
  );
});

function fakeCase(input: {
  precondition?: string;
  steps: string[];
  expectedResult: string[];
}): NormalizedCase {
  return {
    stable_id: "GEN-TC01",
    release: "GEN",
    sheet: "Sheet1",
    source_row: 2,
    scenario_group: "Generic Section",
    case_no: 1,
    scenario: "Generic Scenario",
    title: "Generic dynamic case",
    site: "admin",
    module: "Generic",
    type: "Positive",
    intent: "Verify a generic uploaded case.",
    precondition: input.precondition ?? "",
    steps: input.steps,
    expected_result: input.expectedResult,
    dependencies: [],
    automation_status: "needs_mapping",
    source: {
      workbook: "uploaded.xlsx"
    },
    raw_source: {
      scenario: "Generic Scenario",
      test_case: "Generic dynamic case",
      pre_requisite: input.precondition ?? "",
      test_steps: input.steps.join("\n"),
      expected_result: input.expectedResult.join("\n"),
      type: "Positive"
    }
  };
}
