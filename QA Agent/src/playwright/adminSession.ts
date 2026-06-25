import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import {
  missingSiteEnv,
  runtimeSiteConfig,
  type RuntimeConfig,
  type RuntimeSiteConfig
} from "../runtime/config.js";
import type { Site } from "../types.js";

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
  site: Site;
}

export async function openAdminPage(config: RuntimeConfig): Promise<AdminPageSession> {
  return openSitePage(config, "admin");
}

export async function openSitePage(config: RuntimeConfig, site: Site): Promise<AdminPageSession> {
  const missing = missingSiteEnv(config, site);
  if (missing.length > 0) {
    throw new QaBlockedError(
      "ENV_BLOCKED",
      `${formatSite(site)} is not fully configured. Required variables: ${missing.join(", ")}.`
    );
  }

  const siteConfig = runtimeSiteConfig(config, site);
  const browser = await chromium.launch({ headless: config.headless });

  try {
    const storageState = await ensureSiteStorageState(browser, config, site, siteConfig);
    const context = await browser.newContext({
      storageState,
      baseURL: siteConfig.baseUrl,
      ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    return { browser, context, page, site };
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
  return ensureSiteStorageState(browser, config, "admin", runtimeSiteConfig(config, "admin"));
}

async function ensureSiteStorageState(
  browser: Browser,
  config: RuntimeConfig,
  site: Site,
  siteConfig: RuntimeSiteConfig
): Promise<string> {
  const storageStatePath = path.resolve(siteConfig.storageState ?? `storage-state/${site}.json`);

  if (!config.forceRelogin && (await isFresh(storageStatePath, config.storageTtlMs))) {
    return storageStatePath;
  }

  if (!siteConfig.loginUrl) {
    throw new QaBlockedError(
      "ENV_BLOCKED",
      `Missing ${siteEnvName(site, "LOGIN_URL")}. It is required when no fresh ${site} storage state exists.`
    );
  }

  await mkdir(path.dirname(storageStatePath), { recursive: true });

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    await loginSite(page, config, site, siteConfig);
    await context.storageState({ path: storageStatePath });
    return storageStatePath;
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function loginAdmin(page: Page, config: RuntimeConfig): Promise<void> {
  await loginSite(page, config, "admin", runtimeSiteConfig(config, "admin"));
}

async function loginSite(
  page: Page,
  config: RuntimeConfig,
  site: Site,
  siteConfig: RuntimeSiteConfig
): Promise<void> {
  await page.goto(siteConfig.loginUrl!, { waitUntil: "domcontentloaded" });

  const accountField = firstVisibleLocator(page, [
    page.getByPlaceholder("Account").first(),
    page.getByPlaceholder(/email|e-mail|username|account/i).first(),
    page.getByRole("textbox", { name: /account|email|e-mail|username/i }).first(),
    page.locator('input[type="email"]').first(),
    page.locator('input:not([type="password"]):visible').first()
  ]);
  await accountField.waitFor({ state: "visible", timeout: 15_000 });
  await accountField.fill(siteConfig.username!);

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

  if (hasVerificationCode && siteConfig.verificationCode) {
    await verifyField.fill(siteConfig.verificationCode);
    await page.getByRole("button", { name: /^Log in$/i }).first().click();
  } else if (hasVerificationCode && config.headless) {
    throw new QaBlockedError(
      "ENV_BLOCKED",
      `${formatSite(site)} login requires a verification code. Set ${siteEnvName(site, "VERIFICATION_CODE")}, run with QA_HEADLESS=false for manual login, or provide ${siteEnvName(site, "STORAGE_STATE")}.`
    );
  } else if (hasVerificationCode) {
    await waitForManualAdminLogin(page, accountField);
    return;
  } else {
    await page.getByRole("button", { name: /^Log in$/i }).first().click();
  }

  await waitForAdminAuth(page, accountField, 30_000);
}

function firstVisibleLocator(page: Page, locators: Locator[]): Locator {
  return locators.reduce((combined, locator) => combined.or(locator));
}

async function waitForManualAdminLogin(page: Page, accountField: Locator): Promise<void> {
  await waitForAdminAuth(page, accountField, 180_000);
}

function siteEnvName(
  site: Site,
  suffix: "LOGIN_URL" | "VERIFICATION_CODE" | "STORAGE_STATE"
): string {
  return `QA_${site.toUpperCase()}_${suffix}`;
}

function formatSite(site: Site): string {
  return `${site[0].toUpperCase()}${site.slice(1)} Site`;
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
