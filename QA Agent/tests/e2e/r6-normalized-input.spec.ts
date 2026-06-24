import { expect, test } from "@playwright/test";
import { loadCases } from "../../src/cases/loadCases.js";

test("R6 pilot cases are normalized and addressable by stable id", async () => {
  const cases = await loadCases("R6");
  const stableIds = cases.map((testCase) => testCase.stable_id);

  expect(stableIds).toEqual(["R6-B7.2-TC01", "R6-B7.1-TC01"]);
  expect(cases[0].dependencies).toEqual([]);
  expect(cases[1].dependencies[0].stable_id).toBe("R6-B7.2-TC01");
});
