import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NormalizedCase } from "../types.js";

export async function loadCases(release: string): Promise<NormalizedCase[]> {
  const casesPath = path.join("inputs", release, "cases.normalized.json");
  return loadCasesFromFile(casesPath);
}

export async function loadCasesFromFile(casesPath: string): Promise<NormalizedCase[]> {
  const raw = await readFile(casesPath, "utf8");
  const cases = JSON.parse(raw) as NormalizedCase[];

  return cases.map(validateCase);
}

export function filterCases(
  cases: NormalizedCase[],
  requestedIds: string[]
): NormalizedCase[] {
  if (requestedIds.length === 0) {
    return cases;
  }

  const caseById = new Map(cases.map((testCase) => [testCase.stable_id, testCase]));
  const missing = requestedIds.filter((id) => !caseById.has(id));

  if (missing.length > 0) {
    throw new Error(`Unknown case id(s): ${missing.join(", ")}`);
  }

  return requestedIds.map((id) => caseById.get(id)!);
}

function validateCase(testCase: NormalizedCase): NormalizedCase {
  const requiredStrings: Array<keyof NormalizedCase> = [
    "stable_id",
    "release",
    "sheet",
    "scenario_group",
    "scenario",
    "title",
    "site",
    "module",
    "intent"
  ];

  for (const key of requiredStrings) {
    if (typeof testCase[key] !== "string" || testCase[key].length === 0) {
      throw new Error(`Invalid case ${testCase.stable_id || "(unknown)"}: missing ${key}`);
    }
  }

  if (!Array.isArray(testCase.steps)) {
    throw new Error(`Invalid case ${testCase.stable_id}: missing steps`);
  }

  if (!Array.isArray(testCase.expected_result) || testCase.expected_result.length === 0) {
    throw new Error(`Invalid case ${testCase.stable_id}: missing expected_result`);
  }

  if (!testCase.raw_source || typeof testCase.raw_source.test_case !== "string") {
    throw new Error(`Invalid case ${testCase.stable_id}: missing raw_source traceability`);
  }

  return testCase;
}
