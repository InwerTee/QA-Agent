import { expect, test } from "@playwright/test";
import {
  inferModuleNameFromText,
  understandCase
} from "../../src/understanding/caseUnderstanding.js";
import type { NormalizedCase, PrdKnowledgePack } from "../../src/types.js";

test("case understanding recognizes a new Lock Stock module without case-id routing", () => {
  const understanding = understandCase(
    fakeCase({
      title: "Create Lock Stock Batch",
      scenario: "Lock Stock creation",
      precondition: "User is logged into Admin Site and has an existing campaign.",
      steps: [
        'User opens the "Lock Stock" page.',
        'User clicks "Create".',
        'User selects "Draft" in the Status dropdown.'
      ],
      expectedResult: ["A new Lock Stock batch is displayed in Draft status."]
    })
  );

  expect(understanding.site).toBe("admin");
  expect(understanding.module).toBe("Lock Stock");
  expect(understanding.moduleKey).toBe("lock_stock");
  expect(understanding.action).toBe("create");
  expect(understanding.requiredCapabilities).toContain("admin.lock_stock.create");
  expect(understanding.preconditions.map((item) => item.kind)).toContain("existing_data");
  expect(understanding.assertions.map((item) => item.kind)).toContain("status");
  expect(understanding.routeHints.moduleLabels).toContain("Lock Stock");
});

test("case understanding can infer non-admin target site separately from module", () => {
  const understanding = understandCase(
    fakeCase({
      title: "Agency user views campaign detail",
      scenario: "Agency Site campaign detail",
      precondition: "User is logged into Agency Site.",
      steps: ['User opens the "Campaign" detail page.'],
      expectedResult: ["Campaign detail is displayed."],
      site: "admin"
    })
  );

  expect(understanding.site).toBe("agency");
  expect(understanding.siteConfidence).toBe("high");
  expect(understanding.module).toBe("Campaign");
});

test("case understanding does not treat ordinary page wording as pagination", () => {
  const understanding = understandCase(
    fakeCase({
      title: "Open valid invitation link",
      scenario: "Agency Site: Internal Registration Flow",
      precondition: "User has active registration link (<3 days).",
      steps: ["User clicks the link.", "System validates token."],
      expectedResult: ["Password creation page loads successfully."],
      site: "agency"
    })
  );

  expect(understanding.site).toBe("agency");
  expect(understanding.module).toBe("Agency Account");
  expect(understanding.action).toBe("view");
});

test("case understanding still detects explicit pagination", () => {
  const understanding = understandCase(
    fakeCase({
      title: "Pagination Works",
      scenario: "Admin Site agency application list",
      precondition: ">10 rows exist.",
      steps: ["Admin clicks Next/Prev."],
      expectedResult: ["User navigates pages correctly."]
    })
  );

  expect(understanding.action).toBe("paginate");
});

test("case understanding uses PRD knowledge when the case text is ambiguous", () => {
  const understanding = understandCase(
    fakeCase({
      title: "Verify successful edit",
      scenario: "Edit record",
      precondition: "User is on the list page.",
      steps: ["Click Edit on a row.", "Change Phone Number.", "Click Save."],
      expectedResult: ["Success message is shown and the row updates."],
      module: "Unknown"
    }),
    fakePrdKnowledge()
  );

  expect(understanding.module).toBe("Creator Account");
  expect(understanding.moduleKey).toBe("creator_account");
  expect(understanding.moduleConfidence).toBe("high");
  expect(understanding.routeHints.moduleLabels).toEqual(
    expect.arrayContaining(["Creator Account", "Creator Account List Page"])
  );
  expect(understanding.routeHints.fieldLabels).toContain("Phone Number");
  expect(understanding.evidence.join("\n")).toContain("PRD module context");
});

test("module inference covers common Gro business objects", () => {
  expect(inferModuleNameFromText("Bind Shopee account")).toBe("Shopee Binding");
  expect(inferModuleNameFromText("Submit KR Request")).toBe("KR Request");
  expect(inferModuleNameFromText("Prepare Sample Order")).toBe("Sample Order");
  expect(inferModuleNameFromText("Ads Campaign list")).toBe("Ads Campaign");
  expect(inferModuleNameFromText("Creator Account List Page")).toBe("Creator Account");
  expect(inferModuleNameFromText("Navigate to the Creator Menu and click Creator Account section")).toBe("Creator Account");
  expect(inferModuleNameFromText("Agency row exists in Pending Invitation status")).toBe("Agency Account");
  expect(inferModuleNameFromText("J2.1 Admin Site: Self Registration Page")).toBe("Agency Account");
});

function fakeCase(input: {
  title: string;
  scenario: string;
  precondition: string;
  steps: string[];
  expectedResult: string[];
  site?: NormalizedCase["site"];
  module?: string;
}): NormalizedCase {
  return {
    stable_id: "GEN-B1-TC01",
    release: "GEN",
    sheet: "Sheet1",
    source_row: 2,
    scenario_group: "B1 Generic Module",
    case_no: 1,
    scenario: input.scenario,
    title: input.title,
    site: input.site ?? "admin",
    module: input.module ?? "Unknown",
    type: "Positive",
    intent: `Verify ${input.title}.`,
    precondition: input.precondition,
    steps: input.steps,
    expected_result: input.expectedResult,
    dependencies: [],
    automation_status: "needs_mapping",
    source: {
      workbook: "uploaded.xlsx"
    },
    raw_source: {
      scenario: input.scenario,
      test_case: input.title,
      pre_requisite: input.precondition,
      test_steps: input.steps.join("\n"),
      expected_result: input.expectedResult.join("\n"),
      type: "Positive"
    }
  };
}

function fakePrdKnowledge(): PrdKnowledgePack {
  return {
    version: "prd_knowledge.v1",
    release: "R1",
    title: "R1 Revamp Creator Database",
    generated_at: "2026-06-25T00:00:00.000Z",
    source_path: "PRD - R1.txt",
    extraction: {
      status: "available",
      method: "text_file",
      character_count: 200,
      notes: []
    },
    modules: [
      {
        name: "Creator Account",
        key: "creator_account",
        aliases: ["Creator Database", "All Creators"],
        sites: ["admin"],
        evidence: ["Found Creator Account."]
      }
    ],
    pages: [
      {
        name: "Creator Account List Page",
        module_key: "creator_account",
        aliases: ["Creator Account List", "List Page"],
        site: "admin",
        candidate_routes: [],
        evidence: ["Detected page-like phrase."]
      }
    ],
    fields: [
      {
        name: "Phone Number",
        module_key: "creator_account",
        page_name: "Creator Account List Page",
        aliases: ["Phone Number"],
        evidence: ["Detected field."]
      }
    ],
    actions: [
      {
        name: "Edit",
        kind: "edit",
        module_key: "creator_account",
        page_name: "Creator Account List Page",
        evidence: ["Detected action."]
      }
    ],
    business_rules: [],
    glossary: [],
    case_alignment: {
      case_count: 1,
      module_case_counts: {
        creator_account: 1
      },
      unmatched_case_count: 0
    },
    notes: []
  };
}
