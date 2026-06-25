import { expect, test } from "@playwright/test";
import { loadCases } from "../../src/cases/loadCases.js";

test("R6 pilot cases are normalized and addressable by stable id", async () => {
  const cases = await loadCases("R6");
  const stableIds = cases.map((testCase) => testCase.stable_id);
  const caseById = new Map(cases.map((testCase) => [testCase.stable_id, testCase]));

  expect(cases).toHaveLength(53);
  expect(stableIds).toContain("R6-B7.2-TC01");
  expect(stableIds).toContain("R6-B7.1-TC01");
  expect(caseById.get("R6-B7.2-TC01")?.automation_status).toBe("ready");
  expect(caseById.get("R6-B7.1-TC01")?.automation_status).toBe("ready");
  expect(caseById.get("R6-B7.1-TC01")?.dependencies[0].stable_id).toBe("R6-B7.2-TC01");
});
