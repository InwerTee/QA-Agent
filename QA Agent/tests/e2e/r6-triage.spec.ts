import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { loadCases } from "../../src/cases/loadCases.js";
import { triageRelease } from "../../src/triage/triageCases.js";

test("R6 triage identifies main flow and next automation candidates", async () => {
  const cases = await loadCases("R6");
  const outDir = await mkdtemp(path.join(tmpdir(), "r6-triage-"));
  const result = await triageRelease("R6", cases, { outDir });
  const triageById = new Map(
    result.automationMap.cases.map((triage) => [triage.stable_id, triage])
  );

  expect(result.automationMap.total_cases).toBe(53);
  expect(result.automationMap.main_flow).toEqual([
    "R6-B7.2-TC01",
    "R6-B7.1-TC01",
    "R6-B7.3-TC01",
    "R6-B7.4-TC01",
    "R6-B7.4-TC03",
    "R6-B7.5-TC01"
  ]);
  expect(result.automationMap.summary.by_readiness.implemented).toBe(3);
  expect(result.automationMap.next_candidate_ids[0]).toBe("R6-B7.4-TC03");
  expect(triageById.get("R6-B7.3-TC01")?.readiness).toBe("implemented");
  expect(triageById.get("R6-B7.3-TC01")?.traceability.has_executor_contract).toBe(true);
  expect(triageById.get("R6-B7.5-TC01")?.executor_key).toBe(
    "master_campaign.detail.dashboard"
  );
});
