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
import { caseExecutionId, testDataId } from "../core/runIdentity.js";
import {
  closeAdminPage,
  openAdminPage,
  QaBlockedError,
  type AdminPageSession
} from "../playwright/adminSession.js";
import { fillTinyMCE, pickDateRange, pickFirstElOption, visibleText } from "../playwright/groUi.js";
import { buildNotExecutedTrace } from "../traceability/caseTraceability.js";
import { buildR6ExecutionTrace } from "../traceability/r6TraceContracts.js";

export async function executeR6MasterCampaignCase(
  testCase: NormalizedCase,
  config: RuntimeConfig,
  runDir: string,
  memory: ExecutionMemory,
  runId: string,
  options: { adminSession?: AdminPageSession } = {}
): Promise<CaseResult | undefined> {
  if (testCase.stable_id === "R6-B7.2-TC01") {
    return createMasterCampaign(testCase, config, runDir, memory, runId, options);
  }

  if (testCase.stable_id === "R6-B7.1-TC01") {
    return searchMasterCampaign(testCase, config, runDir, memory, runId, options);
  }

  if (testCase.stable_id === "R6-B7.3-TC01") {
    return editMasterCampaignBasicInfo(testCase, config, runDir, memory, runId, options);
  }

  return undefined;
}

export function hasR6MasterCampaignExecutor(stableId: string): boolean {
  return (
    stableId === "R6-B7.2-TC01" ||
    stableId === "R6-B7.1-TC01" ||
    stableId === "R6-B7.3-TC01"
  );
}

async function createMasterCampaign(
  testCase: NormalizedCase,
  config: RuntimeConfig,
  runDir: string,
  memory: ExecutionMemory,
  runId: string,
  options: { adminSession?: AdminPageSession }
): Promise<CaseResult> {
  const session = options.adminSession ?? (await openAdminPage(config));
  const shouldCloseSession = !options.adminSession;
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
    const createdData = createMasterCampaignRecord(
      runId,
      testCase.stable_id,
      campaignName,
      evidencePath
    );
    memory.createdMasterCampaign = createdData;

    return {
      run_id: runId,
      case_execution_id: caseExecutionId(runId, testCase.stable_id),
      stable_id: testCase.stable_id,
      title: testCase.title,
      status: "PASS",
      precondition_result: "Admin Site was reachable and the Add Master Campaign dialog was visible.",
      actual_result: `Created Master Campaign ${campaignName} and verified it appears in the list.`,
      expected_result: testCase.expected_result,
      evidence_path: evidencePath,
      created_test_data: [createdData],
      depends_on_data: [],
      traceability: buildR6ExecutionTrace(testCase, evidencePath),
      notes: [
        "Executed with selectors and UI idioms from a previously verified Gro UI flow.",
        ...(options.adminSession ? ["Reused the shared Admin browser session for this run."] : [])
      ]
    };
  } catch (error) {
    const evidencePath = await screenshot(session.page, runDir, `${testCase.stable_id}.failure.png`).catch(() => undefined);
    return toBlockedResult(
      testCase,
      error,
      "Unable to complete Master Campaign creation.",
      runId,
      [],
      evidencePath
    );
  } finally {
    if (shouldCloseSession) {
      await closeAdminPage(session);
    }
  }
}

async function searchMasterCampaign(
  testCase: NormalizedCase,
  config: RuntimeConfig,
  runDir: string,
  memory: ExecutionMemory,
  runId: string,
  options: { adminSession?: AdminPageSession }
): Promise<CaseResult> {
  const session = options.adminSession ?? (await openAdminPage(config));
  const shouldCloseSession = !options.adminSession;
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
        run_id: runId,
        case_execution_id: caseExecutionId(runId, testCase.stable_id),
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
        traceability: buildR6ExecutionTrace(testCase, evidencePath),
        notes: [
          "This is now validated against visible table rows, not just the search input text.",
          "If the product search is intentionally broad across other fields, this case needs manual review or expected-result clarification."
        ]
      };
    }

    return {
      run_id: runId,
      case_execution_id: caseExecutionId(runId, testCase.stable_id),
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
      traceability: buildR6ExecutionTrace(testCase, evidencePath),
      notes: memory.createdMasterCampaign
        ? [
            "Search case used the previous create case as setup data.",
            ...(options.adminSession ? ["Reused the shared Admin browser session for this run."] : [])
          ]
        : [
            "No created campaign was available in memory, so the original precondition data was used.",
            ...(options.adminSession ? ["Reused the shared Admin browser session for this run."] : [])
          ]
    };
  } catch (error) {
    const evidencePath = await screenshot(session.page, runDir, `${testCase.stable_id}.failure.png`).catch(() => undefined);
    return toBlockedResult(
      testCase,
      error,
      `Unable to verify search result for ${campaignName}.`,
      runId,
      dataDependency,
      evidencePath
    );
  } finally {
    if (shouldCloseSession) {
      await closeAdminPage(session);
    }
  }
}

async function editMasterCampaignBasicInfo(
  testCase: NormalizedCase,
  config: RuntimeConfig,
  runDir: string,
  memory: ExecutionMemory,
  runId: string,
  options: { adminSession?: AdminPageSession }
): Promise<CaseResult> {
  const session = options.adminSession ?? (await openAdminPage(config));
  const shouldCloseSession = !options.adminSession;
  const campaignName = memory.createdMasterCampaign?.display_name ?? "Summer Beauty Campaign 2024";
  const updatedDescription = `QA R6 edit ${campaignName} ${String(Date.now()).slice(-6)}`;
  const dataDependency = memory.createdMasterCampaign
    ? [toDataReference(memory.createdMasterCampaign)]
    : [];

  if (memory.createdMasterCampaign) {
    addUsedByCase(memory.createdMasterCampaign, testCase.stable_id);
  }

  try {
    const { page } = session;
    const dialog = await openMasterCampaignEditDialog(page, config, campaignName);

    await updateBriefDescription(dialog, updatedDescription);
    await dialog.getByRole("button", { name: /^Update$/i }).click();
    await dialog.waitFor({ state: "hidden", timeout: 15_000 });

    await openMasterCampaignDetail(page, config, campaignName);
    await page.getByText(updatedDescription, { exact: false }).first().waitFor({
      state: "visible",
      timeout: 12_000
    });

    const evidencePath = await screenshot(page, runDir, `${testCase.stable_id}.png`);

    return {
      run_id: runId,
      case_execution_id: caseExecutionId(runId, testCase.stable_id),
      stable_id: testCase.stable_id,
      title: testCase.title,
      status: "PASS",
      precondition_result: memory.createdMasterCampaign
        ? `Used Master Campaign created by R6-B7.2-TC01: ${campaignName}.`
        : `Used the test case's existing-data precondition: ${campaignName}.`,
      actual_result: `Opened ${campaignName} from the list Edit action, edited only the Brief Description, clicked Update, opened Detail, and verified the updated description is visible.`,
      expected_result: testCase.expected_result,
      evidence_path: evidencePath,
      created_test_data: [],
      depends_on_data: dataDependency,
      traceability: buildR6ExecutionTrace(testCase, evidencePath),
      notes: [
        "This executor intentionally covers the Basic Information edit path only.",
        "Current Gro UI exposes Edit from the Master Campaign list Operation column, so the trace contract records that source-wording difference.",
        "Target-value and Updated Date assertions remain explicit traceability gaps.",
        ...(options.adminSession ? ["Reused the shared Admin browser session for this run."] : [])
      ]
    };
  } catch (error) {
    const evidencePath = await screenshot(session.page, runDir, `${testCase.stable_id}.failure.png`).catch(() => undefined);
    return toBlockedResult(
      testCase,
      error,
      `Unable to edit Basic Information for ${campaignName}.`,
      runId,
      dataDependency,
      evidencePath
    );
  } finally {
    if (shouldCloseSession) {
      await closeAdminPage(session);
    }
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
    .locator(".el-table__fixed .el-table__fixed-body-wrapper tbody tr")
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

async function openMasterCampaignDetail(
  page: Page,
  config: RuntimeConfig,
  campaignName: string
): Promise<void> {
  await searchByName(page, config, campaignName);
  await clickMasterCampaignListOperation(page, campaignName, "Detail");
  if (await waitForDetailPage(page, 10_000)) return;

  throw new Error(`Could not open Master Campaign detail page for ${campaignName}.`);
}

async function openMasterCampaignEditDialog(
  page: Page,
  config: RuntimeConfig,
  campaignName: string
): Promise<Locator> {
  await searchByName(page, config, campaignName);
  await clickMasterCampaignListOperation(page, campaignName, "Edit");

  const dialog = page
    .locator(".el-dialog:visible, [role=dialog]:visible")
    .filter({ hasText: /Edit Master Campaign/i })
    .first();
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  await dialog.locator('input[placeholder="Enter here"]').first().waitFor({
    state: "visible",
    timeout: 10_000
  });
  await dialog.locator("iframe.tox-edit-area__iframe").waitFor({
    state: "attached",
    timeout: 10_000
  });
  await dialog.getByRole("button", { name: /^Update$/i }).first().waitFor({
    state: "visible",
    timeout: 10_000
  });

  return dialog;
}

async function clickMasterCampaignListOperation(
  page: Page,
  campaignName: string,
  operationName: "Detail" | "Edit"
): Promise<void> {
  await waitForCampaignRow(page, campaignName);

  const leftRows = page
    .locator(".el-table__fixed .el-table__fixed-body-wrapper tbody tr")
    .filter({ visible: true });
  const targetIndex = await leftRows.evaluateAll((rows, name) => {
    return rows.findIndex((row) => row.textContent?.includes(String(name)));
  }, campaignName);

  if (targetIndex < 0) {
    throw new Error(`Could not locate fixed Master Campaign row for ${campaignName}.`);
  }

  const rightRows = page
    .locator(".el-table__fixed-right .el-table__fixed-body-wrapper tbody tr")
    .filter({ visible: true });
  const rightRowCount = await rightRows.count();
  if (rightRowCount <= targetIndex) {
    throw new Error(
      `Could not locate Operation row ${targetIndex} for ${campaignName}; only ${rightRowCount} operation rows were visible.`
    );
  }

  const operation = rightRows
    .nth(targetIndex)
    .getByText(new RegExp(`^${operationName}$`, "i"))
    .first();
  await operation.waitFor({ state: "visible", timeout: 10_000 });
  await operation.scrollIntoViewIfNeeded().catch(() => undefined);
  await operation.click({ timeout: 8000 });
}

async function updateBriefDescription(dialog: Locator, description: string): Promise<void> {
  const briefField = dialog.locator(".el-form-item", { hasText: /Brief Description/i }).first();
  await briefField.waitFor({ state: "visible", timeout: 8000 });

  const iframeCount = await briefField.locator("iframe.tox-edit-area__iframe").count();
  if (iframeCount > 0) {
    await fillTinyMCE(briefField, description, { clear: true });
    return;
  }

  const textarea = briefField.locator("textarea").first();
  if (await textarea.isVisible().catch(() => false)) {
    await textarea.fill(description);
    return;
  }

  const input = briefField.locator("input").first();
  if (await input.isVisible().catch(() => false)) {
    await input.fill(description);
    return;
  }

  throw new Error("Could not locate editable Brief Description field.");
}

async function waitForDetailPage(page: Page, timeout: number): Promise<boolean> {
  return page
    .waitForURL(/\/masterCampaign\/master-campaign-detail/, { timeout })
    .then(async () => {
      await page.getByText(/Dashboard Overview/i).first().waitFor({
        state: "visible",
        timeout
      });
      return true;
    })
    .catch(() => false);
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
  actualResult: string,
  runId: string,
  dependsOnData: TestDataReference[] = [],
  evidencePath?: string
): CaseResult {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof QaBlockedError ? error.status : "SCRIPT_BLOCKED";

  return {
    run_id: runId,
    case_execution_id: caseExecutionId(runId, testCase.stable_id),
    stable_id: testCase.stable_id,
    title: testCase.title,
    status,
    precondition_result:
      status === "ENV_BLOCKED"
        ? "Environment/authentication blocked browser execution."
        : "Browser execution started but the executor could not complete the UI flow.",
    actual_result: actualResult,
    expected_result: testCase.expected_result,
    evidence_path: evidencePath,
    failure_reason: message,
    created_test_data: [],
    depends_on_data: dependsOnData,
    traceability: buildNotExecutedTrace(testCase, message, undefined, evidencePath),
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
  runId: string,
  createdByCase: string,
  campaignName: string,
  evidencePath: string
): TestDataRecord {
  return {
    data_id: testDataId(runId, createdByCase, "master_campaign"),
    run_id: runId,
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
    run_id: data.run_id,
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
