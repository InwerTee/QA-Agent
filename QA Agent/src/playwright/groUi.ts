import type { Locator, Page } from "@playwright/test";

export async function pickFirstElOption(
  page: Page,
  selectLocator: Locator,
  options: { timeout?: number } = {}
): Promise<void> {
  const timeout = options.timeout ?? 5000;
  await selectLocator.click();
  const option = page.locator(".el-select-dropdown__item").filter({ visible: true }).first();
  await option.waitFor({ state: "visible", timeout });
  await page.waitForTimeout(250);
  await option.click({ timeout: 6000 });
}

export async function pickDateRange(
  page: Page,
  triggerInput: Locator,
  options: { startNth?: number; endNth?: number; timeout?: number } = {}
): Promise<void> {
  const startNth = options.startNth ?? 5;
  const endNth = options.endNth ?? 20;
  const timeout = options.timeout ?? 5000;

  await triggerInput.click();
  const days = page.locator(".el-date-table td.available:not(.disabled)");
  await days.first().waitFor({ state: "visible", timeout });
  await days.nth(startNth).click();
  await days.nth(endNth).click();
}

export async function fillTinyMCE(
  scope: Locator,
  text: string,
  options: { iframe?: string; timeout?: number; clear?: boolean } = {}
): Promise<void> {
  const iframe = options.iframe ?? "iframe.tox-edit-area__iframe";
  const timeout = options.timeout ?? 8000;

  await scope.scrollIntoViewIfNeeded().catch(() => undefined);
  await scope.locator(iframe).waitFor({ state: "attached", timeout });
  const body = scope.frameLocator(iframe).locator("body");
  await body.click();
  if (options.clear) {
    await body.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await body.press("Backspace");
  }
  await body.pressSequentially(text, { timeout });
}

export function visibleText(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).filter({ visible: true });
}

export async function closeOverlay(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => undefined);
}
