import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { runCases } from "../../src/runner/runCases.js";
import {
  selectCasesForPackageRun,
  selectImplementedCases
} from "../../src/pipeline/runPackage.js";
import type { RuntimeConfig } from "../../src/runtime/config.js";
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

test("run report uses report section as evidence when no browser screenshot exists", async () => {
  const evidenceDir = await mkdtemp(path.join(tmpdir(), "qa-evidence-fallback-"));
  const [testCase] = makeR6FixtureCases();
  const manualCase = {
    ...testCase,
    automation_status: "manual_review" as const
  };

  const result = await runCases("R6", [manualCase], runtimeConfig(evidenceDir));
  const caseResult = result.report.case_results[0];

  expect(caseResult.evidence_path).toBe(`${result.markdownPath}#${manualCase.stable_id}`);
  expect(caseResult.pilot_output?.evidence_path).toBe(caseResult.evidence_path);
  expect(caseResult.traceability.expected_trace[0].evidence_path).toBe(caseResult.evidence_path);
});

function runtimeConfig(evidenceDir: string): RuntimeConfig {
  return {
    adminBaseUrl: "https://example.test/admin",
    adminUsername: "user@example.test",
    adminPassword: "password",
    forceRelogin: false,
    storageTtlMs: 1000,
    headless: true,
    evidenceDir,
    caseTimeoutMs: 1000,
    llmEnabled: false,
    llmModel: "gpt-test",
    llmTimeoutMs: 1000
  };
}
