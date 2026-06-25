import { expect, test } from "@playwright/test";
import { buildDynamicActionPlan } from "../../src/dynamic/actionPlan.js";
import { buildRuntimeTestCaseIR } from "../../src/dynamic/llmTestCaseIR.js";
import { buildTestCaseIR } from "../../src/dynamic/testCaseIR.js";
import { validateTestCaseIR } from "../../src/dynamic/testCaseIRValidation.js";
import type { RuntimeConfig } from "../../src/runtime/config.js";
import type { NormalizedCase, TestCaseIR } from "../../src/types.js";

test("validated OpenAI candidate IR is accepted when it preserves source traceability", async () => {
  const testCase = fakeCase();
  const plan = buildDynamicActionPlan(testCase);
  const candidate = buildTestCaseIR(testCase, plan);

  const result = await buildRuntimeTestCaseIR(testCase, plan, llmConfig(), {
    openAIResponder: async () => ({
      output_text: JSON.stringify(stripTranslation(candidate))
    })
  });

  expect(result.ir.translation).toEqual(
    expect.objectContaining({
      provider: "openai",
      status: "llm_accepted",
      model: "gpt-test"
    })
  );
  expect(result.validation.ok).toBe(true);
});

test("OpenAI candidate IR falls back to rules when it changes original source text", async () => {
  const testCase = fakeCase();
  const plan = buildDynamicActionPlan(testCase);
  const candidate = stripTranslation(buildTestCaseIR(testCase, plan));
  candidate.actions[0] = {
    ...candidate.actions[0],
    source_text: "Click something else."
  };

  const result = await buildRuntimeTestCaseIR(testCase, plan, llmConfig(), {
    openAIResponder: async () => ({
      output_text: JSON.stringify(candidate)
    })
  });

  expect(result.ir.translation).toEqual(
    expect.objectContaining({
      provider: "rules",
      status: "llm_rejected"
    })
  );
  expect(result.notes.join("\n")).toContain("rejected");
  expect(result.ir.actions[0].source_text).toBe(testCase.steps[0]);
});

test("test case IR validator rejects candidates that drop an expected result", () => {
  const testCase = fakeCase({
    expectedResult: [
      "The modal appears.",
      "A success message is shown after saving."
    ]
  });
  const plan = buildDynamicActionPlan(testCase);
  const candidate = buildTestCaseIR(testCase, plan);
  candidate.assertions = candidate.assertions.filter((node) => node.source_index !== 2);

  const validation = validateTestCaseIR(testCase, candidate);

  expect(validation.ok).toBe(false);
  expect(validation.errors).toContain("IR does not cover original expected_result:2.");
});

function stripTranslation(ir: TestCaseIR): TestCaseIR {
  const clone = JSON.parse(JSON.stringify(ir)) as TestCaseIR;
  delete (clone as Partial<TestCaseIR>).translation;
  return clone;
}

function llmConfig(): RuntimeConfig {
  return {
    adminBaseUrl: "https://staging-gro.paradev.io",
    adminUsername: "user@example.com",
    adminPassword: "password",
    forceRelogin: false,
    storageTtlMs: 86_400_000,
    headless: true,
    evidenceDir: "reports/runs",
    caseTimeoutMs: 90_000,
    llmEnabled: true,
    openaiApiKey: "test-key",
    llmModel: "gpt-test",
    llmTimeoutMs: 1_000
  };
}

function fakeCase(input: {
  precondition?: string;
  steps?: string[];
  expectedResult?: string[];
} = {}): NormalizedCase {
  const steps = input.steps ?? [
    "Click the Edit button on a row.",
    "Click Save button."
  ];
  const expectedResult = input.expectedResult ?? [
    "The edit modal appears with Save and Cancel buttons.",
    "After saving, a success message is shown and the modal closes."
  ];
  const precondition = input.precondition ?? "Creator accounts are listed in the table.";

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
    precondition,
    steps,
    expected_result: expectedResult,
    dependencies: [],
    automation_status: "needs_mapping",
    source: {
      workbook: "uploaded.xlsx"
    },
    raw_source: {
      scenario: "Generic Scenario",
      test_case: "Generic dynamic case",
      pre_requisite: precondition,
      test_steps: steps.join("\n"),
      expected_result: expectedResult.join("\n"),
      type: "Positive"
    }
  };
}
