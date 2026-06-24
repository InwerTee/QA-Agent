import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { RuntimeConfig } from "../runtime/config.js";

export class QaBlockedError extends Error {
  readonly status: "ENV_BLOCKED" | "SCRIPT_BLOCKED";

  constructor(status: "ENV_BLOCKED" | "SCRIPT_BLOCKED", message: string) {
    super(message);
    this.name = "QaBlockedError";
    this.status = status;
  }
}

export interface AdminPageSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function openAdminPage(config: RuntimeConfig): Promise<AdminPageSession> {
  if (!config.adminBaseUrl || !config.adminUsername || !config.adminPassword) {
    throw new QaBlockedError(
      "ENV_BLOCKED",
      "Admin Site is not fully configured. Required variables: QA_ADMIN_BASE_URL, QA_ADMIN_USERNAME, QA_ADMIN_PASSWORD."
    );
  }

  const browser = await chromium.launch({ headless: config.headless });

  try {
    const storageState = await ensureAdminStorageState(browser, config);
    const context = await browser.newContext({
      storageState,
      baseURL: config.adminBaseUrl,
      ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    return { browser, context, page };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

export async function closeAdminPage(session: AdminPageSession): Promise<void> {
  await session.context.close().catch(() => undefined);
  await session.browser.close().catch(() => undefined);
}

async function ensureAdminStorageState(
  browser: Browser,
  config: RuntimeConfig
): Promise<string> {
  const storageStatePath = path.resolve(config.adminStorageState ?? "storage-state/admin.json");

  if (!config.forceRelogin && (await isFresh(storageStatePath, config.storageTtlMs))) {
    return storageStatePath;
  }

  if (!config.adminLoginUrl) {
    throw new QaBlockedError(
      "ENV_BLOCKED",
      "Missing QA_ADMIN_LOGIN_URL. It is required when no fresh admin storage state exists."
    );
  }

  await mkdir(path.dirname(storageStatePath), { recursive: true });

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    await loginAdmin(page, config);
    await context.storageState({ path: storageStatePath });
    return storageStatePath;
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function loginAdmin(page: Page, config: RuntimeConfig): Promise<void> {
  await page.goto(config.adminLoginUrl!, { waitUntil: "domcontentloaded" });

  const accountField = page
    .getByPlaceholder("Account")
    .first()
    .or(page.getByRole("textbox", { name: /^Account$/i }).first());
  await accountField.waitFor({ state: "visible", timeout: 15_000 });
  await accountField.fill(config.adminUsername!);

  const passwordField = page
    .getByPlaceholder("Password")
    .first()
    .or(page.locator('input[type="password"]').first());
  await passwordField.fill(config.adminPassword!);

  const verifyField = page
    .getByPlaceholder("Verification code")
    .first()
    .or(page.getByRole("textbox", { name: /Verification/i }).first());
  const hasVerificationCode = await verifyField.isVisible({ timeout: 2000 }).catch(() => false);

  if (hasVerificationCode && config.adminVerificationCode) {
    await verifyField.fill(config.adminVerificationCode);
    await page.getByRole("button", { name: /^Log in$/i }).first().click();
  } else if (hasVerificationCode && config.headless) {
    throw new QaBlockedError(
      "ENV_BLOCKED",
      "Admin login requires a verification code. Set QA_ADMIN_VERIFICATION_CODE, run with QA_HEADLESS=false for manual login, or provide QA_ADMIN_STORAGE_STATE."
    );
  } else if (hasVerificationCode) {
    await waitForManualAdminLogin(page, accountField);
    return;
  } else {
    await page.getByRole("button", { name: /^Log in$/i }).first().click();
  }

  await waitForAdminAuth(page, accountField, 30_000);
}

async function waitForManualAdminLogin(page: Page, accountField: Locator): Promise<void> {
  await waitForAdminAuth(page, accountField, 180_000);
}

async function waitForAdminAuth(page: Page, accountField: Locator, timeoutMs: number): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const state = await page.context().storageState();
    const hasCookie = (state.cookies?.length ?? 0) > 0;
    const hasLocalStorage = (state.origins ?? []).some(
      (origin) => (origin.localStorage ?? []).length > 0
    );
    const accountStillVisible = await accountField.isVisible({ timeout: 500 }).catch(() => false);

    if ((hasCookie || hasLocalStorage) && !accountStillVisible) {
      return;
    }

    await page.waitForTimeout(3000);
  }

  throw new QaBlockedError(
    "ENV_BLOCKED",
    `Admin login did not complete within ${Math.round(timeoutMs / 1000)} seconds.`
  );
}

async function isFresh(filePath: string, ttlMs: number): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return Date.now() - fileStat.mtimeMs < ttlMs;
  } catch {
    return false;
  }
}
