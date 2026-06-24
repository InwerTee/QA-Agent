import type { NormalizedCase, SetupPlan } from "../types.js";

export function buildSetupPlan(testCase: NormalizedCase): SetupPlan {
  const dependencyCaseIds = testCase.dependencies.map((dependency) => dependency.stable_id);
  const notes: string[] = [];

  if (dependencyCaseIds.length > 0) {
    notes.push(`Depends on prior case(s): ${dependencyCaseIds.join(", ")}.`);
  }

  if (testCase.precondition.toLowerCase().includes("exists")) {
    notes.push("Requires existing staging data or a setup step that creates that data.");
  }

  if (testCase.site === "admin") {
    notes.push("Requires Admin Site access.");
  }

  return {
    case_id: testCase.stable_id,
    precondition: testCase.precondition,
    dependency_case_ids: dependencyCaseIds,
    can_attempt_automatically: dependencyCaseIds.length === 0,
    notes
  };
}
