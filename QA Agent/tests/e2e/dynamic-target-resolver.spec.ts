import { expect, test } from "@playwright/test";
import {
  rankElementCandidates,
  resolveSelectTarget,
  type RankedTargetCandidate
} from "../../src/dynamic/targetResolver.js";
import type { Page } from "@playwright/test";
import type { ElementCandidate, InputCandidate } from "../../src/dynamic/browserObservation.js";

test("target resolver ranks icon and class hints for filter controls", () => {
  const [best] = rankElementCandidates(
    [
      candidate({ text: "", className: "el-button qa-filter-button", iconHint: "el-icon-filter" }),
      candidate({ text: "Export", className: "el-button" })
    ],
    { action: "click", target: "Filter" },
    "clickable"
  );

  expect(label(best)).toContain("qa-filter-button");
  expect(best.score).toBeGreaterThanOrEqual(60);
});

test("target resolver can use setting icon hints for column settings", () => {
  const [best] = rankElementCandidates(
    [
      candidate({ text: "", className: "el-icon-setting column-config" }),
      candidate({ text: "Export", className: "el-button" })
    ],
    { action: "click", target: "Column Settings" },
    "clickable"
  );

  expect(label(best)).toContain("column-config");
  expect(best.score).toBeGreaterThanOrEqual(45);
});

test("target resolver ranks search-like input fields", () => {
  const [best] = rankElementCandidates(
    [
      inputCandidate({ placeholder: "Search by campaign name", className: "el-input__inner" }),
      inputCandidate({ placeholder: "Created Date", className: "el-input__inner" })
    ],
    { action: "fill", target: "Search Bar", value: "Summer" },
    "input"
  );

  expect(label(best)).toContain("Search by campaign name");
  expect(best.score).toBeGreaterThanOrEqual(70);
});

test("target resolver keeps similarly ranked candidates visible for ambiguity handling", () => {
  const ranked = rankElementCandidates(
    [
      candidate({ text: "Apply", className: "el-button primary" }),
      candidate({ text: "Apply", className: "el-button secondary" })
    ],
    { action: "click", target: "Apply" },
    "clickable"
  );

  expect(ranked).toHaveLength(2);
  expect(ranked[0].score).toBe(ranked[1].score);
});

test("target resolver finds labeled select controls inside drawers", async ({ page }) => {
  await page.setContent(`
    <div class="el-drawer">
      <div class="el-drawer__body">
        <div class="el-form-item">
          <label class="el-form-item__label">Platform</label>
          <div class="el-select">
            <input class="el-input__inner" placeholder="Select" />
          </div>
        </div>
      </div>
    </div>
  `);

  const resolution = await resolveSelectTarget(page as Page, emptyObservation(), {
    action: "select",
    target: "Platform dropdown",
    value: "TikTok"
  });

  expect(resolution.status).toBe("found");
  if (resolution.status === "found") {
    expect(resolution.reason).toContain("form label match: Platform");
  }
});

function label(candidate: RankedTargetCandidate): string {
  const element = candidate.candidate;
  return [
    element.text,
    element.placeholder,
    element.ariaLabel,
    element.title,
    element.className,
    element.iconHint
  ].join(" ");
}

function candidate(input: Partial<ElementCandidate>): ElementCandidate {
  return {
    index: 0,
    nth: 0,
    tag: "button",
    role: "button",
    text: "",
    ariaLabel: "",
    title: "",
    placeholder: "",
    id: "",
    name: "",
    type: "",
    className: "",
    testId: "",
    href: "",
    nearText: "",
    iconHint: "",
    disabled: false,
    ...input
  };
}

function inputCandidate(input: Partial<InputCandidate>): InputCandidate {
  return {
    ...candidate({
      tag: "input",
      role: "textbox"
    }),
    value: "",
    ...input
  };
}

function emptyObservation() {
  return {
    url: "about:blank",
    title: "",
    visibleTextSample: "",
    buttons: [],
    clickables: [],
    inputs: [],
    tableHeaders: [],
    tables: []
  };
}
