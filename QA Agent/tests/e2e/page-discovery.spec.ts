import { expect, test } from "@playwright/test";
import { scorePageMatch } from "../../src/dynamic/pageDiscovery.js";
import { understandCase } from "../../src/understanding/caseUnderstanding.js";
import type { BrowserObservation } from "../../src/dynamic/browserObservation.js";
import type { NormalizedCase } from "../../src/types.js";

test("page discovery scoring recognizes module labels and URL tokens", () => {
  const understanding = understandCase(fakeCase("Create Lock Stock Batch"));
  const match = scorePageMatch(
    observation({
      url: "https://staging.example.com/lockStock/lock-stock-list",
      visibleTextSample: "Lock Stock Batch Create Status",
      tableHeaders: ["Batch Name", "Status", "Operation"]
    }),
    understanding
  );

  expect(match.score).toBeGreaterThanOrEqual(4);
  expect(match.confidence).toBe("high");
  expect(match.reasons.join(" ")).toContain("Lock Stock");
});

test("page discovery scoring stays low when a new module cannot be confirmed", () => {
  const understanding = understandCase(fakeCase("Create Lock Stock Batch"));
  const match = scorePageMatch(
    observation({
      url: "https://staging.example.com/dashboard",
      visibleTextSample: "Dashboard Overview",
      tableHeaders: []
    }),
    understanding
  );

  expect(match.confidence).toBe("low");
  expect(match.reasons).toContain("no module-specific page signal found");
});

function observation(input: Partial<BrowserObservation>): BrowserObservation {
  return {
    url: "",
    title: "",
    visibleTextSample: "",
    buttons: [],
    clickables: [],
    inputs: [],
    tableHeaders: [],
    tables: [],
    ...input
  };
}

function fakeCase(title: string): NormalizedCase {
  return {
    stable_id: "GEN-B1-TC01",
    release: "GEN",
    sheet: "Sheet1",
    source_row: 2,
    scenario_group: "B1 Lock Stock",
    case_no: 1,
    scenario: "Lock Stock",
    title,
    site: "admin",
    module: "Unknown",
    type: "Positive",
    intent: `Verify ${title}.`,
    precondition: "User is logged into Admin Site.",
    steps: ['User opens the "Lock Stock" page.'],
    expected_result: ["Lock Stock page is displayed."],
    dependencies: [],
    automation_status: "needs_mapping",
    source: {
      workbook: "uploaded.xlsx"
    },
    raw_source: {
      scenario: "Lock Stock",
      test_case: title,
      pre_requisite: "User is logged into Admin Site.",
      test_steps: 'User opens the "Lock Stock" page.',
      expected_result: "Lock Stock page is displayed.",
      type: "Positive"
    }
  };
}
