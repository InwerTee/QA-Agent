import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import type { RuntimeConfig } from "../runtime/config.js";
import type {
  CaseResult,
  ExecutionMemory,
  NormalizedCase,
  TestDataRecord,
  TestDataReference
} from "../types.js";
import { closeAdminPage, openAdminPage, QaBlockedError } from "../playwright/adminSession.js";
import { fillTinyMCE, pickDateRange, pickFirstElOption, visibleText } from "../playwright/groUi.js";

export async function executeR6MasterCampaignCase(
  testCase: NormalizedCase,
  config: RuntimeConfig,
  runDir: string,
  memory: ExecutionMemory
): Promise<CaseResult | undefined> {
  if (testCase.stable_id === "R6-B7.2-TC01") {
    return createMasterCampaign(testCase, config, runDir, memory);
  }

  if (testCase.stable_id === "R6-B7.1-TC01") {
    return searchMasterCampaign(testCase, config, runDir, memory);
  }

  return undefined;
}

export function hasR6MasterCampaignExecutor(stableId: string): boolean {
  return stableId === "R6-B7.2-TC01" || stableId === "R6-B7.1-TC01";
}

async function createMasterCampaign(
  testCase: NormalizedCase,
  config: RuntimeConfig,
  runDir: string,
  memory: ExecutionMemory
): Promise<CaseResult> {
  const session = await openAdminPage(config);
  const campaignName = `QA-R6-MC-${String(Date.now()).slice(-7)}`;

  try {
    const { page } = session;
    await page.goto(adminUrl(config, "/masterCampaign/master-campaign-list"), {
      waitUntil: "domcontentloaded"
    });
    await visibleText(page, "Master Campaign Name").first().waitFor({
      state: "visible",
      timeout: 15_000
    });

    await page.getByRole("button", { name: /Add Master Campaign/i }).first().click();
    const dialog = page.locator(".el-dialog:visible, [role=dialog]:visible").first();
    await dialog.getByText(/Create Master Campaign/i).waitFor({ state: "visible", timeout: 8000 });

    await dialog.locator('input[type="text"]').first().fill(campaignName);
    await pickFirstElOption(page, dialog.locator(".el-form-item", { hasText: "Brand" }).first().locator(".el-select"));
    await pickDateRange(page, dialog.locator(".el-form-item", { hasText: "Period" }).first().locator("input").first());
    await fillTinyMCE(
      dialog.locator(".el-form-item", { hasText: /Brief Description/i }).first(),
      `QA R6 Master Campaign ${campaignName}`
    );
    await fillTargetInputs(dialog);

    await dialog.getByRole("button", { name: /^Save$/i }).click();
    await dialog.waitFor({ state: "hidden", timeout: 12_000 });

    await searchByName(page, config, campaignName);
    await waitForCampaignRow(page, campaignName);

    const evidencePath = await screenshot(page, runDir, `${testCase.stable_id}.png`);
    const createdData = createMasterCampaignRecord(testCase.stable_id, campaignName, evidencePath);
    memory.createdMasterCampaign = createdData;

    return {
      stable_id: testCase.stable_id,
      title: testCase.title,
      status: "PASS",
      precondition_result: "Admin Site was reachable and the Add Master Campaign dialog was visible.",
      actual_result: `Created Master Campaign ${campaignName} and verified it appears in the list.`,
      expected_result: testCase.expected_result,
      evidence_path: evidencePath,
      created_test_data: [createdData],
      depends_on_data: [],
      notes: ["Executed with selectors and UI idioms from a previously verified Gro UI flow."]
    };
  } catch (error) {
    return toBlockedResult(testCase, error, "Unable to complete Master Campaign creation.");
  } finally {
    await closeAdminPage(session);
  }
}

async function searchMasterCampaign(
  testCase: NormalizedCase,
  config: RuntimeConfig,
  runDir: string,
  memory: ExecutionMemory
): Promise<CaseResult> {
  const session = await openAdminPage(config);
  const campaignName = memory.createdMasterCampaign?.display_name ?? "Summer Beauty Campaign 2024";
  const searchTerm = memory.createdMasterCampaign?.display_name ?? "Summer";
  const dataDependency = memory.createdMasterCampaign
    ? [toDataReference(memory.createdMasterCampaign)]
    : [];

  if (memory.createdMasterCampaign) {
    addUsedByCase(memory.createdMasterCampaign, testCase.stable_id);
  }

  try {
    const { page } = session;
    await searchByName(page, config, searchTerm);

    await waitForCampaignRow(page, campaignName);
    const searchInput = page.locator('input[placeholder*="earch"], .el-input__inner').first();
    const inputValue = await searchInput.inputValue().catch(() => "");
    const visibleNames = await readVisibleCampaignNames(page);
    const evidencePath = await screenshot(page, runDir, `${testCase.stable_id}.png`);

    if (visibleNames.length > 0 && visibleNames.some((name) => !name.includes(searchTerm))) {
      return {
        stable_id: testCase.stable_id,
        title: testCase.title,
        status: "PRODUCT_BUG",
        precondition_result: memory.createdMasterCampaign
          ? `Used Master Campaign created by R6-B7.2-TC01: ${campaignName}.`
          : "Used the test case's existing-data precondition: Summer Beauty Campaign 2024.",
        actual_result: `Searched "${searchTerm}" and found "${campaignName}", but non-matching rows were still visible: ${visibleNames.join(", ")}.`,
        expected_result: testCase.expected_result,
        evidence_path: evidencePath,
        failure_reason: "Search result table did not display only matching Master Campaign names.",
        created_test_data: [],
        depends_on_data: dataDependency,
        notes: [
          "This is now validated against visible table rows, not just the search input text.",
          "If the product search is intentionally broad across other fields, this case needs manual review or expected-result clarification."
        ]
      };
    }

    return {
      stable_id: testCase.stable_id,
      title: testCase.title,
      status: "PASS",
      precondition_result: memory.createdMasterCampaign
        ? `Used Master Campaign created by R6-B7.2-TC01: ${campaignName}.`
        : "Used the test case's existing-data precondition: Summer Beauty Campaign 2024.",
      actual_result: `Searched "${searchTerm}" and found "${campaignName}". Search input value: "${inputValue}". Visible campaign rows: ${visibleNames.join(", ")}.`,
      expected_result: testCase.expected_result,
      evidence_path: evidencePath,
      created_test_data: [],
      depends_on_data: dataDependency,
      notes: memory.createdMasterCampaign
        ? ["Search case used the previous create case as setup data."]
        : ["No created campaign was available in memory, so the original precondition data was used."]
    };
  } catch (error) {
    return toBlockedResult(testCase, error, `Unable to verify search result for ${campaignName}.`);
  } finally {
    await closeAdminPage(session);
  }
}

async function waitForCampaignRow(page: Page, campaignName: string): Promise<void> {
  await campaignRows(page, campaignName).first().waitFor({ state: "visible", timeout: 12_000 });
}

function campaignRows(page: Page, campaignName: string): Locator {
  return page
    .locator(".el-table__body-wrapper tbody tr, .el-table__fixed-body-wrapper tbody tr")
    .filter({ hasText: campaignName })
    .filter({ visible: true });
}

async function readVisibleCampaignNames(page: Page): Promise<string[]> {
  const rows = page
    .locator(".el-table__body-wrapper tbody tr")
    .filter({ visible: true });
  const rowCount = await rows.count();
  const names: string[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const firstCell = rows.nth(index).locator("td").first();
    const text = (await firstCell.innerText().catch(() => "")).trim();
    if (text && !names.includes(text)) {
      names.push(text);
    }
  }

  return names;
}

async function searchByName(page: Page, config: RuntimeConfig, value: string): Promise<void> {
  await page.goto(adminUrl(config, "/masterCampaign/master-campaign-list"), {
    waitUntil: "domcontentloaded"
  });
  const searchInput = page.locator('input[placeholder*="earch"], .el-input__inner').first();
  await searchInput.waitFor({ state: "visible", timeout: 15_000 });
  await searchInput.fill(value);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
}

async function fillTargetInputs(dialog: Locator): Promise<void> {
  const numericInputs = dialog.locator(
    'input[inputmode="numeric"], input[type="number"], .el-input-number input'
  );
  const values = ["10", "20", "1000", "100", "500", "100000"];
  const count = await numericInputs.count();

  for (let index = 0; index < count; index += 1) {
    const input = numericInputs.nth(index);
    const visible = await input.isVisible().catch(() => false);
    const enabled = await input.isEnabled().catch(() => false);
    if (!visible || !enabled) continue;

    await input.scrollIntoViewIfNeeded().catch(() => undefined);
    await input.fill(values[index % values.length]).catch(() => undefined);
  }
}

async function screenshot(page: Page, runDir: string, fileName: string): Promise<string> {
  await mkdir(runDir, { recursive: true });
  const evidencePath = path.join(runDir, fileName);
  await page.screenshot({ path: evidencePath, fullPage: true });
  return evidencePath;
}

function toBlockedResult(
  testCase: NormalizedCase,
  error: unknown,
  actualResult: string
): CaseResult {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof QaBlockedError ? error.status : "SCRIPT_BLOCKED";

  return {
    stable_id: testCase.stable_id,
    title: testCase.title,
    status,
    precondition_result:
      status === "ENV_BLOCKED"
        ? "Environment/authentication blocked browser execution."
        : "Browser execution started but the executor could not complete the UI flow.",
    actual_result: actualResult,
    expected_result: testCase.expected_result,
    failure_reason: message,
    created_test_data: [],
    depends_on_data: [],
    notes: [
      status === "ENV_BLOCKED"
        ? "Treat this as environment/auth setup work, not a Gro product bug."
        : "Treat this as executor/selector work until the failure is reproduced after the browser flow is stable."
    ]
  };
}

function adminUrl(config: RuntimeConfig, route: string): string {
  return `${config.adminBaseUrl!.replace(/\/$/, "")}${route}`;
}

function createMasterCampaignRecord(
  createdByCase: string,
  campaignName: string,
  evidencePath: string
): TestDataRecord {
  return {
    data_id: `master_campaign:${campaignName}`,
    data_type: "master_campaign",
    display_name: campaignName,
    created_by_case: createdByCase,
    used_by_cases: [],
    environment: "admin staging",
    evidence_path: evidencePath,
    cleanup_status: "not_attempted",
    notes: ["Created through Gro Admin Site Master Campaign form."]
  };
}

function toDataReference(data: TestDataRecord): TestDataReference {
  return {
    data_id: data.data_id,
    data_type: data.data_type,
    display_name: data.display_name,
    source_case: data.created_by_case
  };
}

function addUsedByCase(data: TestDataRecord, caseId: string): void {
  if (!data.used_by_cases.includes(caseId)) {
    data.used_by_cases.push(caseId);
  }
}
