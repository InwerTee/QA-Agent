import { expect, test } from "@playwright/test";
import { isObservableObservation } from "../../src/dynamic/pageReadiness.js";
import type { BrowserObservation } from "../../src/dynamic/browserObservation.js";

test("page readiness treats visible controls as observable", () => {
  expect(
    isObservableObservation(
      observation({
        visibleTextSample: "Master Campaign List Page",
        clickables: [candidate("Filter")],
        inputs: [inputCandidate("Search by campaign name")]
      })
    )
  ).toBe(true);
});

test("page readiness treats blank observations as not observable", () => {
  expect(isObservableObservation(observation())).toBe(false);
});

function observation(input: Partial<BrowserObservation> = {}): BrowserObservation {
  return {
    url: "https://staging-gro.paradev.io/admin/masterCampaign/master-campaign-list",
    title: "",
    visibleTextSample: "",
    buttons: [],
    clickables: [],
    inputs: [],
    tableHeaders: [],
    tables: [],
    ...input
  };
}

function candidate(text: string): BrowserObservation["clickables"][number] {
  return {
    index: 0,
    nth: 0,
    tag: "button",
    role: "button",
    text,
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
    disabled: false
  };
}

function inputCandidate(placeholder: string): BrowserObservation["inputs"][number] {
  return {
    ...candidate(""),
    tag: "input",
    role: "textbox",
    placeholder,
    value: ""
  };
}
