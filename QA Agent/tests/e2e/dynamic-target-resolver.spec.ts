import { expect, test } from "@playwright/test";
import {
  rankElementCandidates,
  type RankedTargetCandidate
} from "../../src/dynamic/targetResolver.js";
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
