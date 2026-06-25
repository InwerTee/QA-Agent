import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { loadCases } from "../../src/cases/loadCases.js";
import { selectImplementedCases } from "../../src/pipeline/runPackage.js";
import { triageRelease } from "../../src/triage/triageCases.js";

test("run-package selects implemented R6 cases in executable dependency order", async () => {
  const cases = await loadCases("R6");
  const outDir = await mkdtemp(path.join(tmpdir(), "r6-run-package-"));
  const triage = await triageRelease("R6", cases, { outDir });
  const selected = selectImplementedCases(cases, triage.automationMap);

  expect(selected.map((testCase) => testCase.stable_id)).toEqual([
    "R6-B7.2-TC01",
    "R6-B7.1-TC01",
    "R6-B7.3-TC01"
  ]);
});
