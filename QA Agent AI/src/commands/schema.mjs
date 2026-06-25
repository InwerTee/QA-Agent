export const PLAN_VERSION = "qa_agent_ai_plan.v1";

export const ALLOWED_COMMAND_TYPES = new Set([
  "open",
  "goto",
  "snapshot",
  "click",
  "fill",
  "press",
  "select",
  "screenshot",
  "assert_text",
  "assert_url",
  "assert_snapshot_contains",
  "close"
]);

const SOURCE_KINDS = new Set(["precondition", "test_step", "expected_result"]);
const PLAN_STATUSES = new Set(["ready", "blocked", "manual_review"]);
const SAFETY_VALUES = new Set(["safe", "needs_review"]);

export function validatePlan(plan) {
  const errors = [];

  if (!plan || typeof plan !== "object") {
    return { ok: false, errors: ["Plan must be an object."] };
  }

  if (plan.version !== PLAN_VERSION) {
    errors.push(`Plan version must be ${PLAN_VERSION}.`);
  }
  if (!stringValue(plan.case_id)) errors.push("case_id is required.");
  if (!stringValue(plan.objective)) errors.push("objective is required.");
  if (!PLAN_STATUSES.has(plan.status)) errors.push("status must be ready, blocked, or manual_review.");
  if (!Array.isArray(plan.blockers)) errors.push("blockers must be an array.");
  if (!Array.isArray(plan.commands)) errors.push("commands must be an array.");
  if (!Array.isArray(plan.final_assertions)) errors.push("final_assertions must be an array.");

  for (const [index, command] of (plan.commands ?? []).entries()) {
    validateCommand(command, index, errors);
  }

  for (const [index, assertion] of (plan.final_assertions ?? []).entries()) {
    if (!assertion || typeof assertion !== "object") {
      errors.push(`final_assertions[${index}] must be an object.`);
      continue;
    }
    validateSource(assertion.source, `final_assertions[${index}].source`, errors);
    if (!stringValue(assertion.check)) errors.push(`final_assertions[${index}].check is required.`);
    if (!["automated", "manual"].includes(assertion.automation)) {
      errors.push(`final_assertions[${index}].automation must be automated or manual.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateCommand(command, index = 0, errors = []) {
  if (!command || typeof command !== "object") {
    errors.push(`commands[${index}] must be an object.`);
    return errors;
  }

  if (!stringValue(command.id)) errors.push(`commands[${index}].id is required.`);
  if (!ALLOWED_COMMAND_TYPES.has(command.type)) {
    errors.push(`commands[${index}].type is not allowed: ${String(command.type)}.`);
  }
  validateSource(command.source, `commands[${index}].source`, errors);
  if (!command.args || typeof command.args !== "object" || Array.isArray(command.args)) {
    errors.push(`commands[${index}].args must be an object.`);
  }
  if (!stringValue(command.expected_observation)) {
    errors.push(`commands[${index}].expected_observation is required.`);
  }
  if (!SAFETY_VALUES.has(command.safety)) {
    errors.push(`commands[${index}].safety must be safe or needs_review.`);
  }

  return errors;
}

export function isExecutableCommand(command) {
  return command?.safety === "safe" && ALLOWED_COMMAND_TYPES.has(command.type);
}

function validateSource(source, label, errors) {
  if (!source || typeof source !== "object") {
    errors.push(`${label} is required.`);
    return;
  }

  if (!SOURCE_KINDS.has(source.kind)) errors.push(`${label}.kind is invalid.`);
  if (!Number.isInteger(source.index) || source.index < 1) errors.push(`${label}.index must be a positive integer.`);
  if (!stringValue(source.text)) errors.push(`${label}.text is required.`);
}

function stringValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}
