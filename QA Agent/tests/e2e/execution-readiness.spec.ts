import { expect, test } from "@playwright/test";
import {
  assessExecutionReadiness,
  summarizeExecutionReadiness
} from "../../src/dynamic/executionReadiness.js";
import type { NormalizedCase } from "../../src/types.js";
import type { RuntimeConfig } from "../../src/runtime/config.js";

test("conservative readiness allows simple supported browser plans", async () => {
  const result = await assessExecutionReadiness(
    fakeCase({
      steps: ["User clicks \"Search\" button."],
      expectedResult: ["The correct page is displayed."]
    }),
    configuredRuntime()
  );

  expect(result.decision.can_execute).toBe(true);
  expect(result.decision.status).toBe("ready");
  expect(result.decision.issues).toEqual([]);
});

test("conservative readiness blocks before browser when environment is missing", async () => {
  const result = await assessExecutionReadiness(
    fakeCase({
      site: "creator",
      steps: ["User clicks \"Search\" button."],
      expectedResult: ["The correct page is displayed."]
    }),
    configuredRuntime({ creatorUsername: undefined })
  );

  expect(result.decision.can_execute).toBe(false);
  expect(result.decision.recommended_status).toBe("ENV_BLOCKED");
  expect(result.decision.issues.map((issue) => issue.code)).toContain("env_missing");
});

test("conservative readiness blocks existing-data prerequisites without known setup dependency", async () => {
  const result = await assessExecutionReadiness(
    fakeCase({
      precondition: "At least one creator account exists in the table.",
      steps: ["User clicks \"Edit\" button."],
      expectedResult: ["The edit modal is displayed."]
    }),
    configuredRuntime()
  );

  expect(result.decision.can_execute).toBe(false);
  expect(result.decision.recommended_status).toBe("SETUP_BLOCKED");
  expect(result.decision.issues.map((issue) => issue.code)).toContain("setup_data_required");
});

test("conservative readiness blocks unsupported actions and manual assertions", async () => {
  const dropdown = await assessExecutionReadiness(
    fakeCase({
      steps: ["User selects \"Active\" from the Status dropdown."],
      expectedResult: ["Only matching records are displayed."]
    }),
    configuredRuntime()
  );
  const download = await assessExecutionReadiness(
    fakeCase({
      steps: ["User clicks \"Export\" button."],
      expectedResult: ["The downloaded file contains only invalid rows."]
    }),
    configuredRuntime()
  );

  expect(dropdown.decision.can_execute).toBe(false);
  expect(dropdown.decision.recommended_status).toBe("AGENT_BLOCKED");
  expect(dropdown.decision.issues.map((issue) => issue.code)).toContain("unsupported_action");
  expect(download.decision.can_execute).toBe(false);
  expect(download.decision.recommended_status).toBe("MANUAL_REVIEW");
  expect(download.decision.issues.map((issue) => issue.code)).toContain("unsupported_assertion");
});

test("conservative readiness does not block cases already mapped to implemented executors", async () => {
  const result = await assessExecutionReadiness(
    fakeCase({
      steps: ["User selects \"Active\" from the Status dropdown."],
      expectedResult: ["The downloaded file contains only invalid rows."],
      automationStatus: "ready"
    }),
    configuredRuntime()
  );

  expect(result.decision.can_execute).toBe(true);
  expect(result.decision.status).toBe("ready");
  expect(result.decision.issues).toEqual([]);
});

test("readiness summary separates ready cases from not-executed recommended statuses", async () => {
  const ready = await assessExecutionReadiness(
    fakeCase({
      stableId: "GEN-TC01",
      steps: ["User clicks \"Search\" button."],
      expectedResult: ["The correct page is displayed."]
    }),
    configuredRuntime()
  );
  const blocked = await assessExecutionReadiness(
    fakeCase({
      stableId: "GEN-TC02",
      precondition: "At least one creator account exists in the table.",
      steps: ["User clicks \"Edit\" button."],
      expectedResult: ["The edit modal is displayed."]
    }),
    configuredRuntime()
  );

  const summary = summarizeExecutionReadiness([ready.decision, blocked.decision]);

  expect(summary.ready).toBe(1);
  expect(summary.blocked).toBe(1);
  expect(summary.by_recommended_status.SETUP_BLOCKED).toBe(1);
  expect(summary.by_recommended_status.MANUAL_REVIEW).toBe(0);
});

function configuredRuntime(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    adminBaseUrl: "https://staging.example.test",
    adminLoginUrl: "https://staging.example.test/login",
    adminUsername: "admin@example.test",
    adminPassword: "password",
    creatorBaseUrl: "https://creator.example.test",
    creatorLoginUrl: "https://creator.example.test/login",
    creatorUsername: "creator@example.test",
    creatorPassword: "password",
    agencyBaseUrl: "https://agency.example.test",
    agencyLoginUrl: "https://agency.example.test/login",
    agencyUsername: "agency@example.test",
    agencyPassword: "password",
    forceRelogin: false,
    storageTtlMs: 86_400_000,
    headless: true,
    evidenceDir: "reports/runs",
    caseTimeoutMs: 90_000,
    llmEnabled: false,
    llmModel: "gpt-5.2",
    llmTimeoutMs: 20_000,
    ...overrides
  };
}

function fakeCase(input: {
  stableId?: string;
  site?: NormalizedCase["site"];
  precondition?: string;
  steps: string[];
  expectedResult: string[];
  automationStatus?: NormalizedCase["automation_status"];
}): NormalizedCase {
  return {
    stable_id: input.stableId ?? "GEN-TC01",
    release: "GEN",
    sheet: "Sheet1",
    source_row: 2,
    scenario_group: "Generic Section",
    case_no: 1,
    scenario: "Generic Scenario",
    title: "Generic dynamic case",
    site: input.site ?? "admin",
    module: "Creator Account",
    type: "Positive",
    intent: "Verify a generic uploaded case.",
    precondition: input.precondition ?? "User is on the Creator Account List Page.",
    steps: input.steps,
    expected_result: input.expectedResult,
    dependencies: [],
    automation_status: input.automationStatus ?? "needs_mapping",
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
