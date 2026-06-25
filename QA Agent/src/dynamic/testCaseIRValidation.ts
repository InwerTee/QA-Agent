import type {
  NormalizedCase,
  TestCaseIR,
  TestCaseIRCapability,
  TestCaseIRNode,
  TestCaseIRNodeKind,
  TestCaseIRSourceType,
  TestCaseIRType
} from "../types.js";

export interface TestCaseIRValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const ALLOWED_NODE_KINDS: TestCaseIRNodeKind[] = ["precondition", "action", "assertion"];
const ALLOWED_SOURCE_TYPES: TestCaseIRSourceType[] = ["precondition", "test_step", "expected_result"];
const ALLOWED_CAPABILITIES: TestCaseIRCapability[] = ["executable", "attemptable", "manual", "blocked"];
const ALLOWED_IR_TYPES: TestCaseIRType[] = [
  "precondition_page",
  "precondition_existing_data",
  "precondition_auth",
  "precondition_general",
  "navigate_to_page",
  "navigate_back",
  "click_target",
  "click_row_action",
  "click_table_link",
  "click_dialog_action",
  "fill_field",
  "select_option",
  "wait_for_update",
  "observe_only",
  "assert_visible_text",
  "assert_navigation",
  "assert_modal_visible",
  "assert_modal_closed",
  "assert_toast_visible",
  "assert_table_filtered",
  "assert_table_row_updated",
  "assert_table_headers",
  "assert_no_raw_null",
  "assert_form_validation",
  "assert_download_content",
  "assert_manual_review"
];

export function validateTestCaseIR(testCase: NormalizedCase, ir: TestCaseIR): TestCaseIRValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(ir)) {
    return {
      ok: false,
      errors: ["IR payload is not an object."],
      warnings
    };
  }

  if (ir.version !== "test_case_ir.v1") {
    errors.push(`IR version must be test_case_ir.v1, got ${String(ir.version)}.`);
  }
  if (ir.case_id !== testCase.stable_id) {
    errors.push(`IR case_id must match ${testCase.stable_id}, got ${String(ir.case_id)}.`);
  }

  const preconditions = Array.isArray(ir.preconditions) ? ir.preconditions : [];
  const actions = Array.isArray(ir.actions) ? ir.actions : [];
  const assertions = Array.isArray(ir.assertions) ? ir.assertions : [];

  if (!Array.isArray(ir.preconditions)) errors.push("IR preconditions must be an array.");
  if (!Array.isArray(ir.actions)) errors.push("IR actions must be an array.");
  if (!Array.isArray(ir.assertions)) errors.push("IR assertions must be an array.");

  validateNodeList(testCase, preconditions, "precondition", errors, warnings);
  validateNodeList(testCase, actions, "action", errors, warnings);
  validateNodeList(testCase, assertions, "assertion", errors, warnings);

  assertSourceCoverage(testCase, preconditions, "precondition", errors, warnings);
  assertSourceCoverage(testCase, actions, "test_step", errors, warnings);
  assertSourceCoverage(testCase, assertions, "expected_result", errors, warnings);

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function validateNodeList(
  testCase: NormalizedCase,
  nodes: TestCaseIRNode[],
  expectedKind: TestCaseIRNodeKind,
  errors: string[],
  warnings: string[]
): void {
  for (const node of nodes) {
    const label = nodeLabel(node);
    if (!isObject(node)) {
      errors.push(`${expectedKind} node is not an object.`);
      continue;
    }

    if (!ALLOWED_NODE_KINDS.includes(node.kind)) {
      errors.push(`${label} has unsupported kind ${String(node.kind)}.`);
    }
    if (node.kind !== expectedKind) {
      errors.push(`${label} must have kind ${expectedKind}, got ${String(node.kind)}.`);
    }
    if (!ALLOWED_SOURCE_TYPES.includes(node.source_type)) {
      errors.push(`${label} has unsupported source_type ${String(node.source_type)}.`);
    }
    if (!ALLOWED_IR_TYPES.includes(node.ir_type)) {
      errors.push(`${label} has unsupported ir_type ${String(node.ir_type)}.`);
    }
    if (!ALLOWED_CAPABILITIES.includes(node.capability)) {
      errors.push(`${label} has unsupported capability ${String(node.capability)}.`);
    }
    if (node.confidence !== "high" && node.confidence !== "medium" && node.confidence !== "low") {
      errors.push(`${label} has unsupported confidence ${String(node.confidence)}.`);
    }

    const sourceText = sourceTextFor(testCase, node.source_type, node.source_index);
    if (!sourceText) {
      errors.push(`${label} points to missing source ${node.source_type}:${node.source_index}.`);
      continue;
    }
    if (normalizeText(node.source_text) !== normalizeText(sourceText)) {
      errors.push(`${label} source_text does not match original ${node.source_type}:${node.source_index}.`);
    }
    if (node.kind === "assertion" && node.capability === "executable") {
      warnings.push(`${label} assertion is executable; verify the runner has a deterministic checker for it.`);
    }
  }
}

function assertSourceCoverage(
  testCase: NormalizedCase,
  nodes: TestCaseIRNode[],
  sourceType: TestCaseIRSourceType,
  errors: string[],
  warnings: string[]
): void {
  const expectedCount = sourceCount(testCase, sourceType);
  if (expectedCount === 0) return;

  const covered = new Set(nodes.filter((node) => node.source_type === sourceType).map((node) => node.source_index));
  for (let index = 1; index <= expectedCount; index += 1) {
    if (!covered.has(index)) {
      const message = `IR does not cover original ${sourceType}:${index}.`;
      if (sourceType === "expected_result" || sourceType === "test_step") {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }
  }
}

function sourceTextFor(testCase: NormalizedCase, sourceType: TestCaseIRSourceType, index: number): string | undefined {
  if (!Number.isInteger(index) || index < 1) return undefined;
  if (sourceType === "precondition") return index === 1 ? testCase.precondition : undefined;
  if (sourceType === "test_step") return testCase.steps[index - 1];
  return testCase.expected_result[index - 1];
}

function sourceCount(testCase: NormalizedCase, sourceType: TestCaseIRSourceType): number {
  if (sourceType === "precondition") return testCase.precondition ? 1 : 0;
  if (sourceType === "test_step") return testCase.steps.length;
  return testCase.expected_result.length;
}

function nodeLabel(node: Partial<TestCaseIRNode>): string {
  return `${node.kind ?? "unknown"} ${node.source_type ?? "unknown"}:${node.source_index ?? "?"}`;
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
