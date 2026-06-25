import { expect, test } from "@playwright/test";
import { loadCases } from "../../src/cases/loadCases.js";
import { hasR6MasterCampaignExecutor } from "../../src/executors/r6MasterCampaign.js";
import {
  buildR6ExecutionTrace,
  hasR6TraceContract
} from "../../src/traceability/r6TraceContracts.js";

test("R6 normalized cases preserve raw Excel source text", async () => {
  const cases = await loadCases("R6");
  const createCase = cases.find((testCase) => testCase.stable_id === "R6-B7.2-TC01");

  expect(createCase?.source_row).toBe(28);
  expect(createCase?.raw_source.test_case).toBe("Create Master Campaign with All Fields");
  expect(createCase?.raw_source.pre_requisite).toContain("Add Master Campaign");
  expect(createCase?.raw_source.test_steps).toContain("User clicks the");
  expect(createCase?.raw_source.expected_result).toContain("A new Master Campaign record");
});

test("implemented R6 executors must declare traceability contracts", async () => {
  const cases = await loadCases("R6");
  const implementedCases = cases.filter((testCase) =>
    hasR6MasterCampaignExecutor(testCase.stable_id)
  );

  expect(implementedCases.map((testCase) => testCase.stable_id).sort()).toEqual([
    "R6-B7.1-TC01",
    "R6-B7.2-TC01"
  ]);

  for (const testCase of implementedCases) {
    expect(hasR6TraceContract(testCase.stable_id)).toBe(true);
    const trace = buildR6ExecutionTrace(testCase, "evidence.png");
    expect(trace.source_row).toBe(testCase.source_row);
    expect(trace.raw_test_case).toBe(testCase.raw_source.test_case);
    expect(trace.step_trace).toHaveLength(testCase.steps.length);
    expect(trace.expected_trace).toHaveLength(testCase.expected_result.length);
  }
});

test("R6 create smoke executor is traceable but not over-claimed as full coverage", async () => {
  const cases = await loadCases("R6");
  const createCase = cases.find((testCase) => testCase.stable_id === "R6-B7.2-TC01");

  expect(createCase).toBeDefined();
  const trace = buildR6ExecutionTrace(createCase!, "evidence.png");

  expect(trace.coverage_summary.not_covered).toBeGreaterThan(0);
  expect(trace.expected_trace.find((entry) => entry.source_index === 5)?.coverage).toBe(
    "not_covered"
  );
});
