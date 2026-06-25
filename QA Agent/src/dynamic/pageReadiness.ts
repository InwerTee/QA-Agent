import type { Page } from "@playwright/test";
import { observePage, type BrowserObservation } from "./browserObservation.js";

export interface PageReadinessResult {
  ready: boolean;
  observation: BrowserObservation;
  notes: string[];
}

export async function waitForObservablePage(
  page: Page,
  options: {
    timeoutMs?: number;
    reloads?: number;
  } = {}
): Promise<PageReadinessResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const reloads = options.reloads ?? 1;
  const notes: string[] = [];
  let observation = await observePage(page);

  for (let attempt = 0; attempt <= reloads; attempt += 1) {
    const startedAt = Date.now();

    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);

    while (Date.now() - startedAt < timeoutMs) {
      observation = await observePage(page);

      if (isObservableObservation(observation)) {
        notes.push(
          `Page became observable on attempt ${attempt + 1}: text=${observation.visibleTextSample.length}, clickables=${observation.clickables.length}, inputs=${observation.inputs.length}, tables=${observation.tables.length}.`
        );
        return {
          ready: true,
          observation,
          notes
        };
      }

      await page.waitForTimeout(1000);
    }

    notes.push(
      `Page was still not observable after attempt ${attempt + 1}: url=${page.url()}, title=${await page.title().catch(() => "")}, text=${observation.visibleTextSample.length}, clickables=${observation.clickables.length}, inputs=${observation.inputs.length}, tables=${observation.tables.length}.`
    );

    if (attempt < reloads) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
  }

  return {
    ready: false,
    observation,
    notes
  };
}

export function isObservableObservation(observation: BrowserObservation): boolean {
  return (
    observation.visibleTextSample.length > 20 ||
    observation.clickables.length > 0 ||
    observation.inputs.length > 0 ||
    observation.tableHeaders.length > 0 ||
    observation.tables.some((table) => table.headers.length > 0 || table.rowCount > 0)
  );
}
