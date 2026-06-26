import { expect, test } from "@playwright/test";
import { buildDynamicActionPlan } from "../../src/dynamic/actionPlan.js";
import { buildTestCaseIR } from "../../src/dynamic/testCaseIR.js";
import { buildGroKnowledgeLayer } from "../../src/knowledge/groKnowledgeLayer.js";
import type { RuntimeConfig } from "../../src/runtime/config.js";
import type { NormalizedCase, PrdKnowledgePack, TestCaseIR } from "../../src/types.js";

test("Gro Knowledge Layer records case understanding and knowledge gaps before execution", async () => {
  const testCase = fakeCase();
  const layer = await buildGroKnowledgeLayer(
    {
      release: "R1",
      title: "Creator Account",
      cases: [testCase],
      prdKnowledge: fakePrdKnowledge()
    },
    runtimeConfig({ llmEnabled: false })
  );

  expect(layer.version).toBe("gro_knowledge_layer.v1");
  expect(layer.summary.total_cases).toBe(1);
  expect(layer.summary.llm.disabled).toBe(1);
  expect(layer.summary.by_module.creator_account).toBe(1);

  const [record] = layer.cases;
  expect(record.understanding.module_key).toBe("creator_account");
  expect(record.understanding.route_hints.field_labels).toContain("Username");
  expect(record.test_case_ir.translation.status).toBe("llm_disabled");
  expect(record.knowledge_gaps.map((gap) => gap.code)).toContain("recipe_missing");
});

test("Gro Knowledge Layer records accepted OpenAI IR without trusting unvalidated browser execution", async () => {
  const testCase = fakeCase();
  const actionPlan = buildDynamicActionPlan(testCase);
  const candidate = stripTranslation(buildTestCaseIR(testCase, actionPlan));
  const layer = await buildGroKnowledgeLayer(
    {
      release: "R1",
      title: "Creator Account",
      cases: [testCase],
      prdKnowledge: fakePrdKnowledge()
    },
    runtimeConfig({ llmEnabled: true }),
    {
      openAIResponder: async () => ({
        output_text: JSON.stringify(candidate)
      })
    }
  );

  expect(layer.summary.llm.accepted).toBe(1);
  expect(layer.cases[0].test_case_ir.translation).toEqual(
    expect.objectContaining({
      provider: "openai",
      status: "llm_accepted",
      model: "gpt-test"
    })
  );
  expect(layer.cases[0].knowledge_gaps.map((gap) => gap.code)).toContain("recipe_missing");
});

function stripTranslation(ir: TestCaseIR): TestCaseIR {
  const clone = JSON.parse(JSON.stringify(ir)) as TestCaseIR;
  delete (clone as Partial<TestCaseIR>).translation;
  return clone;
}

function runtimeConfig(input: { llmEnabled: boolean }): RuntimeConfig {
  return {
    adminBaseUrl: "https://staging-gro.paradev.io",
    adminUsername: "user@example.com",
    adminPassword: "password",
    forceRelogin: false,
    storageTtlMs: 86_400_000,
    headless: true,
    evidenceDir: "reports/runs",
    caseTimeoutMs: 90_000,
    llmEnabled: input.llmEnabled,
    openaiApiKey: input.llmEnabled ? "test-key" : undefined,
    llmModel: "gpt-test",
    llmTimeoutMs: 1_000
  };
}

function fakeCase(): NormalizedCase {
  return {
    stable_id: "R1-G1-TC01",
    release: "R1",
    sheet: "Sheet1",
    source_row: 10,
    scenario_group: "Creator Account List Page",
    case_no: 1,
    scenario: "Search Bar",
    title: "Search by username",
    site: "admin",
    module: "Creator Account",
    type: "Positive",
    intent: "Verify Creator Account search by username.",
    precondition: "User is on the Creator Account List Page.",
    steps: ['User types "alice" into the Search Bar.', "User waits for the table to update."],
    expected_result: ["The Creator Account table shows matching creator rows."],
    dependencies: [],
    automation_status: "needs_mapping",
    source: {
      workbook: "R1.xlsx"
    },
    raw_source: {
      scenario: "Search Bar",
      test_case: "Search by username",
      pre_requisite: "User is on the Creator Account List Page.",
      test_steps: '1. User types "alice" into the Search Bar.\n2. User waits for the table to update.',
      expected_result: "The Creator Account table shows matching creator rows.",
      type: "Positive"
    },
    prd_context: {
      knowledge_pack_path: "inputs/R1/prd_knowledge.json",
      matched_module_keys: ["creator_account"],
      matched_page_names: ["Creator Account List Page"],
      matched_fields: ["Username"],
      matched_actions: ["Search"],
      notes: ["PRD module context: Creator Account."]
    }
  };
}

function fakePrdKnowledge(): PrdKnowledgePack {
  return {
    version: "prd_knowledge.v1",
    release: "R1",
    title: "Creator Account",
    generated_at: "2026-06-26T00:00:00.000Z",
    source_path: "PRD - R1.txt",
    extraction: {
      status: "available",
      method: "text_file",
      character_count: 160,
      notes: []
    },
    modules: [
      {
        name: "Creator Account",
        key: "creator_account",
        aliases: ["Creator Database", "All Creators"],
        sites: ["admin"],
        evidence: ["Creator Account module in PRD."]
      }
    ],
    pages: [
      {
        name: "Creator Account List Page",
        module_key: "creator_account",
        aliases: ["All Creators"],
        site: "admin",
        candidate_routes: ["/authors/public-page"],
        evidence: ["Creator Account List Page in PRD."]
      }
    ],
    fields: [
      {
        name: "Username",
        module_key: "creator_account",
        page_name: "Creator Account List Page",
        aliases: ["Creator Username"],
        evidence: ["Username field in PRD."]
      }
    ],
    actions: [
      {
        name: "Search",
        kind: "search",
        module_key: "creator_account",
        page_name: "Creator Account List Page",
        evidence: ["Search action in PRD."]
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
