import { expect, test } from "@playwright/test";
import { buildDynamicActionPlan } from "../../src/dynamic/actionPlan.js";
import { buildTestCaseIR } from "../../src/dynamic/testCaseIR.js";
import type { NormalizedCase } from "../../src/types.js";

test("test case IR compiles Paragon steps into executable browser capabilities", () => {
  const testCase = fakeCase({
    precondition: "Creator accounts are listed in the table.",
    steps: [
      "Click the Edit button on a row.",
      "In the edit modal, change an editable field (e.g., Phone Number).",
      "Click Save button.",
      "Navigate back to the list page.",
      "On the same row, click the hyperlinked \"Username\"."
    ],
    expectedResult: [
      "The edit modal appears with Save and Cancel buttons.",
      "After saving, a success message is shown, the modal closes, and the table row updates with the new data.",
      "The user is correctly redirected to the Creator Account Detail Page."
    ]
  });
  const plan = buildDynamicActionPlan(testCase);
  const ir = buildTestCaseIR(testCase, plan);

  expect(ir.version).toBe("test_case_ir.v1");
  expect(ir.preconditions[0]).toEqual(
    expect.objectContaining({
      ir_type: "precondition_existing_data",
      capability: "blocked"
    })
  );
  expect(ir.actions.map((node) => node.ir_type)).toEqual([
    "click_row_action",
    "fill_field",
    "click_dialog_action",
    "navigate_back",
    "click_table_link"
  ]);
  expect(ir.actions[0]).toEqual(
    expect.objectContaining({
      target: "Edit",
      row: "first_visible_or_contextual_row",
      capability: "executable"
    })
  );
  expect(ir.actions[1]).toEqual(
    expect.objectContaining({
      target: "Phone Number",
      value: "safe_generated_value",
      capability: "attemptable"
    })
  );
  expect(ir.actions[2]).toEqual(
    expect.objectContaining({
      target: "Save",
      scope: "visible_dialog_or_drawer"
    })
  );
  expect(ir.assertions.map((node) => node.ir_type)).toEqual(
    expect.arrayContaining([
      "assert_modal_visible",
      "assert_toast_visible",
      "assert_modal_closed",
      "assert_table_row_updated",
      "assert_navigation"
    ])
  );
  expect(ir.assertions.length).toBeGreaterThan(3);
});

test("test case IR marks downloaded file assertions as manual until download parsing exists", () => {
  const testCase = fakeCase({
    steps: ["Click Export Data button."],
    expectedResult: [
      "The downloaded file contains only the invalid rows, with an additional column detailing the specific error."
    ]
  });
  const ir = buildTestCaseIR(testCase, buildDynamicActionPlan(testCase));

  expect(ir.assertions[0]).toEqual(
    expect.objectContaining({
      ir_type: "assert_download_content",
      capability: "manual",
      confidence: "low"
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
    module: "Creator Account",
    type: "Positive",
    intent: "Verify a generic uploaded case.",
    precondition: input.precondition ?? "User is on the Creator Account List Page.",
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
      pre_requisite: input.precondition ?? "User is on the Creator Account List Page.",
      test_steps: input.steps.join("\n"),
      expected_result: input.expectedResult.join("\n"),
      type: "Positive"
    }
  };
}
