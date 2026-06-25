import type { Page } from "@playwright/test";

export const CLICKABLE_TARGET_SELECTOR = [
  "button:visible",
  'a:visible',
  '[role="button"]:visible',
  '[onclick]:visible',
  '[aria-haspopup]:visible',
  ".el-button:visible",
  ".el-dropdown:visible",
  ".el-select:visible",
  ".el-icon:visible",
  '[class*="button" i]:visible',
  '[class*="filter" i]:visible',
  '[class*="setting" i]:visible',
  '[class*="search" i]:visible',
  '[style*="cursor" i]:visible'
].join(", ");

export const INPUT_TARGET_SELECTOR = [
  "input:visible",
  "textarea:visible",
  '[contenteditable="true"]:visible',
  '[role="textbox"]:visible',
  '[role="combobox"]:visible',
  ".el-input__inner:visible"
].join(", ");

export interface ElementCandidate {
  index: number;
  nth: number;
  tag: string;
  role: string;
  text: string;
  ariaLabel: string;
  title: string;
  placeholder: string;
  id: string;
  name: string;
  type: string;
  className: string;
  testId: string;
  href: string;
  nearText: string;
  iconHint: string;
  disabled: boolean;
}

export interface InputCandidate extends ElementCandidate {
  value: string;
}

export interface TableSnapshot {
  headers: string[];
  rowCount: number;
  sampleRows: string[][];
}

export interface BrowserObservation {
  url: string;
  title: string;
  visibleTextSample: string;
  buttons: string[];
  clickables: ElementCandidate[];
  inputs: InputCandidate[];
  tableHeaders: string[];
  tables: TableSnapshot[];
}

export async function observePage(page: Page): Promise<BrowserObservation> {
  const [url, title, visibleTextSample, clickables, inputs, tables] = await Promise.all([
    Promise.resolve(page.url()),
    page.title().catch(() => ""),
    readVisibleText(page),
    readClickables(page),
    readInputs(page),
    readTables(page)
  ]);

  const tableHeaders = Array.from(new Set(tables.flatMap((table) => table.headers))).slice(0, 40);

  return {
    url,
    title,
    visibleTextSample,
    buttons: clickables.map((candidate) => candidate.text || candidate.ariaLabel || candidate.title).filter(Boolean),
    clickables,
    inputs,
    tableHeaders,
    tables
  };
}

async function readVisibleText(page: Page): Promise<string> {
  const text = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  return compact(text).slice(0, 2000);
}

async function readClickables(page: Page): Promise<ElementCandidate[]> {
  return page
    .locator(CLICKABLE_TARGET_SELECTOR)
    .evaluateAll((elements) => {
      function compactInBrowser(value: string): string {
        return value.replace(/\s+/g, " ").trim();
      }

      function nestedAttribute(element: Element, attribute: string): string {
        return element.querySelector(`[${attribute}]`)?.getAttribute(attribute) ?? "";
      }

      function nearbyText(element: Element): string {
        const chunks: string[] = [];
        const formItem = element.closest(".el-form-item");
        const formLabel = formItem?.querySelector(".el-form-item__label, label");

        if (formLabel) {
          chunks.push((formLabel as HTMLElement).innerText || formLabel.textContent || "");
        }

        let current: Element | null = element;
        for (let depth = 0; current && depth < 4; depth += 1) {
          const previous = current.previousElementSibling;
          if (previous) {
            chunks.push((previous as HTMLElement).innerText || previous.textContent || "");
          }
          current = current.parentElement;
        }

        const parent = element.parentElement;
        const grandparent = parent?.parentElement;

        if (parent) {
          chunks.push((parent as HTMLElement).innerText || parent.textContent || "");
        }
        if (grandparent) {
          chunks.push((grandparent as HTMLElement).innerText || grandparent.textContent || "");
        }

        return compactInBrowser(chunks.join(" "));
      }

      function implicitRole(element: Element): string {
        const tag = element.tagName.toLowerCase();
        if (tag === "button") return "button";
        if (tag === "a") return "link";
        if (tag === "input" || tag === "textarea") return "textbox";
        return "";
      }

      function readElementCandidate(element: Element, index: number): ElementCandidate {
        const htmlElement = element as HTMLElement;
        const text = compactInBrowser(htmlElement.innerText || element.textContent || "");
        const className = element.getAttribute("class") ?? "";
        const iconHint = compactInBrowser(
          [
            className,
            element.querySelector("svg use")?.getAttribute("href") ?? "",
            element.querySelector("svg use")?.getAttribute("xlink:href") ?? "",
            element.querySelector("i")?.getAttribute("class") ?? "",
            element.querySelector("[class*='icon' i]")?.getAttribute("class") ?? ""
          ].join(" ")
        );

        return {
          index,
          nth: index,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") ?? implicitRole(element),
          text: text.slice(0, 180),
          ariaLabel: element.getAttribute("aria-label") ?? "",
          title: element.getAttribute("title") ?? "",
          placeholder: element.getAttribute("placeholder") ?? nestedAttribute(element, "placeholder"),
          id: element.getAttribute("id") ?? "",
          name: element.getAttribute("name") ?? nestedAttribute(element, "name"),
          type: element.getAttribute("type") ?? nestedAttribute(element, "type"),
          className,
          testId: element.getAttribute("data-testid") ?? element.getAttribute("data-test") ?? "",
          href: element.getAttribute("href") ?? "",
          nearText: nearbyText(element).slice(0, 260),
          iconHint: iconHint.slice(0, 260),
          disabled:
            element.hasAttribute("disabled") ||
            element.getAttribute("aria-disabled") === "true" ||
            /\bis-disabled\b|disabled/i.test(className)
        };
      }

      return elements.map((element, index) => readElementCandidate(element, index)).slice(0, 80);
    })
    .catch(() => []);
}

async function readInputs(page: Page): Promise<BrowserObservation["inputs"]> {
  return page
    .locator(INPUT_TARGET_SELECTOR)
    .evaluateAll((elements) => {
      function compactInBrowser(value: string): string {
        return value.replace(/\s+/g, " ").trim();
      }

      function nestedAttribute(element: Element, attribute: string): string {
        return element.querySelector(`[${attribute}]`)?.getAttribute(attribute) ?? "";
      }

      function nearbyText(element: Element): string {
        const chunks: string[] = [];
        const formItem = element.closest(".el-form-item");
        const formLabel = formItem?.querySelector(".el-form-item__label, label");

        if (formLabel) {
          chunks.push((formLabel as HTMLElement).innerText || formLabel.textContent || "");
        }

        let current: Element | null = element;
        for (let depth = 0; current && depth < 4; depth += 1) {
          const previous = current.previousElementSibling;
          if (previous) {
            chunks.push((previous as HTMLElement).innerText || previous.textContent || "");
          }
          current = current.parentElement;
        }

        const parent = element.parentElement;
        const grandparent = parent?.parentElement;

        if (parent) {
          chunks.push((parent as HTMLElement).innerText || parent.textContent || "");
        }
        if (grandparent) {
          chunks.push((grandparent as HTMLElement).innerText || grandparent.textContent || "");
        }

        return compactInBrowser(chunks.join(" "));
      }

      function implicitRole(element: Element): string {
        const tag = element.tagName.toLowerCase();
        if (tag === "button") return "button";
        if (tag === "a") return "link";
        if (tag === "input" || tag === "textarea") return "textbox";
        return "";
      }

      function readElementCandidate(element: Element, index: number): ElementCandidate {
        const htmlElement = element as HTMLElement;
        const text = compactInBrowser(htmlElement.innerText || element.textContent || "");
        const className = element.getAttribute("class") ?? "";
        const iconHint = compactInBrowser(
          [
            className,
            element.querySelector("svg use")?.getAttribute("href") ?? "",
            element.querySelector("svg use")?.getAttribute("xlink:href") ?? "",
            element.querySelector("i")?.getAttribute("class") ?? "",
            element.querySelector("[class*='icon' i]")?.getAttribute("class") ?? ""
          ].join(" ")
        );

        return {
          index,
          nth: index,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") ?? implicitRole(element),
          text: text.slice(0, 180),
          ariaLabel: element.getAttribute("aria-label") ?? "",
          title: element.getAttribute("title") ?? "",
          placeholder: element.getAttribute("placeholder") ?? nestedAttribute(element, "placeholder"),
          id: element.getAttribute("id") ?? "",
          name: element.getAttribute("name") ?? nestedAttribute(element, "name"),
          type: element.getAttribute("type") ?? nestedAttribute(element, "type"),
          className,
          testId: element.getAttribute("data-testid") ?? element.getAttribute("data-test") ?? "",
          href: element.getAttribute("href") ?? "",
          nearText: nearbyText(element).slice(0, 260),
          iconHint: iconHint.slice(0, 260),
          disabled:
            element.hasAttribute("disabled") ||
            element.getAttribute("aria-disabled") === "true" ||
            /\bis-disabled\b|disabled/i.test(className)
        };
      }

      return elements.slice(0, 80).map((element, index) => {
        const input = element as HTMLInputElement | HTMLTextAreaElement;
        return {
          ...readElementCandidate(element, index),
          value: input.value ?? ""
        };
      });
    })
    .catch(() => []);
}

async function readTables(page: Page): Promise<TableSnapshot[]> {
  return page
    .locator("table:visible, .el-table:visible")
    .evaluateAll((elements) =>
      elements.slice(0, 10).map((element) => {
        function compactInBrowser(value: string): string {
          return value.replace(/\s+/g, " ").trim();
        }

        const headers = Array.from(element.querySelectorAll("th, .el-table__header th"))
          .map((header) => compactInBrowser((header as HTMLElement).innerText || header.textContent || ""))
          .filter(Boolean)
          .slice(0, 30);
        const rows = Array.from(element.querySelectorAll("tbody tr, .el-table__body tr"));
        const sampleRows = rows.slice(0, 5).map((row) =>
          Array.from(row.querySelectorAll("td"))
            .map((cell) => compactInBrowser((cell as HTMLElement).innerText || cell.textContent || ""))
            .slice(0, 30)
        );

        return {
          headers,
          rowCount: rows.length,
          sampleRows
        };
      })
    )
    .catch(() => []);
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
