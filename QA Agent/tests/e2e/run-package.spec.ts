import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  selectCasesForPackageRun,
  selectImplementedCases
} from "../../src/pipeline/runPackage.js";
import { triageRelease } from "../../src/triage/triageCases.js";
import { makeR6FixtureCases } from "../fixtures/r6FixtureCases.js";

test("run-package defaults to processing every normalized case", () => {
  const cases = makeR6FixtureCases();
  const selected = selectCasesForPackageRun(cases);

  expect(selected.map((testCase) => testCase.stable_id)).toEqual([
    "R6-B7.2-TC01",
    "R6-B7.1-TC01",
    "R6-B7.3-TC01",
    "R6-B7.4-TC01",
    "R6-B7.4-TC03",
    "R6-B7.5-TC01"
  ]);
});

test("run-package can still filter to explicitly requested cases", () => {
  const cases = makeR6FixtureCases();
  const selected = selectCasesForPackageRun(cases, ["R6-B7.1-TC01"]);

  expect(selected.map((testCase) => testCase.stable_id)).toEqual(["R6-B7.1-TC01"]);
});

test("implemented-only selection remains available for automation triage", async () => {
  const cases = makeR6FixtureCases();
  const outDir = await mkdtemp(path.join(tmpdir(), "r6-run-package-"));
  const triage = await triageRelease("R6", cases, { outDir });
  const selected = selectImplementedCases(cases, triage.automationMap);

  expect(selected.map((testCase) => testCase.stable_id)).toEqual([
    "R6-B7.2-TC01",
    "R6-B7.1-TC01",
    "R6-B7.3-TC01"
  ]);
});
