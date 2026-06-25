import type { NormalizedCase } from "../types.js";

export type DynamicActionKind =
  | "precondition"
  | "navigate"
  | "click"
  | "fill"
  | "select"
  | "wait"
  | "observe"
  | "assert";

export interface DynamicActionStep {
  index: number;
  source: "precondition" | "test_step" | "expected_result";
  sourceText: string;
  action: DynamicActionKind;
  target?: string;
  value?: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface DynamicActionPlan {
  caseId: string;
  title: string;
  goal: string;
  steps: DynamicActionStep[];
  expectedChecks: DynamicActionStep[];
  notes: string[];
}

export function buildDynamicActionPlan(testCase: NormalizedCase): DynamicActionPlan {
  const steps: DynamicActionStep[] = [];

  if (testCase.precondition) {
    steps.push({
      index: 1,
      source: "precondition",
      sourceText: testCase.precondition,
      action: inferPreconditionAction(testCase.precondition),
      target: inferPageTarget(testCase.precondition),
      reason: "Derived from the original case precondition.",
      confidence: "low"
    });
  }

  steps.push(
    ...testCase.steps.map((step, index) => ({
      ...inferActionStep(step),
      index: index + 1,
      source: "test_step" as const,
      sourceText: step
    }))
  );

  const expectedChecks = testCase.expected_result.map((expected, index) => ({
    index: index + 1,
    source: "expected_result" as const,
    sourceText: expected,
    action: "assert" as const,
    target: inferAssertionTarget(expected),
    reason: "Derived from the original expected result.",
    confidence: "low" as const
  }));

  return {
    caseId: testCase.stable_id,
    title: testCase.title,
    goal: testCase.intent || testCase.title,
    steps,
    expectedChecks,
    notes: [
      "This is a dynamic plan generated from the uploaded test case text.",
      "It is not a prewritten executor and may stop if the page interaction is ambiguous."
    ]
  };
}

function inferActionStep(text: string): Omit<DynamicActionStep, "index" | "source" | "sourceText"> {
  const normalized = normalizeText(text);
  const quoted = quotedTexts(normalized);

  if (/\b(wait|refresh|trigger|load)\b/i.test(normalized)) {
    return {
      action: "wait",
      reason: "The step asks the user to wait for UI update or loading.",
      confidence: "medium"
    };
  }

  if (/\bpress(?:es)?\s+enter\b/i.test(normalized)) {
    return {
      action: "wait",
      reason: "The step asks the user to submit or trigger the current input with Enter.",
      confidence: "medium"
    };
  }

  if (isFillInstruction(normalized)) {
    return {
      action: "fill",
      target: inferFillTarget(normalized),
      value: quoted[0],
      reason: "The step asks the user to type, enter, input, or fill a value.",
      confidence: quoted[0] ? "medium" : "low"
    };
  }

  if (/\b(selects?|chooses?|picks?)\b/i.test(normalized)) {
    return {
      action: "select",
      target: inferSelectionTarget(normalized) ?? inferTargetAfter(normalized, ["in", "from"]) ?? inferFieldTarget(normalized),
      value: quoted[0],
      reason: "The step asks the user to select an option.",
      confidence: quoted[0] ? "medium" : "low"
    };
  }

  if (/\b(clicks?|opens?|focuses?|focus)\b/i.test(normalized)) {
    return {
      action: "click",
      target: normalizeQuotedTarget(quoted[0]) ?? inferTargetAfter(normalized, ["clicks", "click", "opens", "open", "focuses on", "focuses"]),
      reason: "The step asks the user to click, open, or focus a UI control.",
      confidence: quoted[0] ? "medium" : "low"
    };
  }

  if (/\b(verify|check|confirm|see|shown|display)\b/i.test(normalized)) {
    return {
      action: "assert",
      target: inferAssertionTarget(normalized),
      reason: "The step asks for a visible result or condition to be verified.",
      confidence: "low"
    };
  }

  return {
    action: "observe",
    target: inferFieldTarget(normalized),
    reason: "The step does not map cleanly to a safe generic browser action.",
    confidence: "low"
  };
}

function inferPreconditionAction(text: string): DynamicActionKind {
  if (/\bis on\b|\bpage\b/i.test(text)) return "navigate";
  if (/\bexists|existing|at least one|has\b/i.test(text)) return "precondition";
  return "observe";
}

function inferPageTarget(text: string): string | undefined {
  const match = text.match(/\bon the\s+(.+?)(?:\.|$)/i);
  return match?.[1]?.trim();
}

function inferFieldTarget(text: string): string | undefined {
  const quoted = quotedTexts(text);
  if (/search/i.test(text)) return "Search";
  if (/filter/i.test(text)) return "Filter";
  if (/dropdown/i.test(text)) return quoted[quoted.length - 1] ?? "Dropdown";
  if (/button/i.test(text)) return quoted[0] ?? "Button";
  return quoted[0];
}

function inferAssertionTarget(text: string): string | undefined {
  const quoted = quotedTexts(text);
  if (quoted.length > 0) return quoted[0];
  if (/no data|no results|empty state/i.test(text)) return "empty state";
  if (/table|row|rows/i.test(text)) return "table";
  if (/keyword|search/i.test(text)) return "search input";
  return undefined;
}

function inferSelectionTarget(text: string): string | undefined {
  const inTheMatch = text.match(/\bin the\s+(.+?),\s*user\s+selects?/i);
  if (inTheMatch?.[1]) return cleanupSelectionTarget(inTheMatch[1]);

  const dropdownMatch = text.match(/\bin the\s+(.+?\bdropdown\b)/i);
  if (dropdownMatch?.[1]) return cleanupSelectionTarget(dropdownMatch[1]);

  return undefined;
}

function inferFillTarget(text: string): string | undefined {
  const explicitTarget = inferTargetAfter(text, ["into", "in", "on"]);
  if (explicitTarget) return explicitTarget;
  if (/search/i.test(text)) return "Search";
  if (/go to|page input|page field/i.test(text)) return "Go to";
  if (/input field|input box|text box|textbox|field/i.test(text)) return "input field";
  return undefined;
}

function isFillInstruction(text: string): boolean {
  if (/\b(types?|enters?|fills?)\b/i.test(text)) return true;
  return /\binputs?\s+(?:"[^"]+"|'[^']+'|\d+)/i.test(text);
}

function inferTargetAfter(text: string, markers: string[]): string | undefined {
  for (const marker of markers) {
    const pattern = new RegExp(`${escapeRegExp(marker)}\\s+(.+?)(?:\\.|$)`, "i");
    const match = text.match(pattern);
    if (match?.[1]) {
      return cleanupTarget(match[1]);
    }
  }

  return undefined;
}

function quotedTexts(text: string): string[] {
  return Array.from(text.matchAll(/"([^"]+)"|'([^']+)'/g))
    .map((match) => match[1] ?? match[2])
    .filter(Boolean);
}

function normalizeText(text: string): string {
  return text
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupTarget(value: string): string {
  return value
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/\s+(button|field|input|dropdown|bar|page)$/i, " $1")
    .trim();
}

function cleanupSelectionTarget(value: string): string {
  return cleanupTarget(value)
    .replace(/^(master campaign|campaign|filter)\s+/i, "")
    .replace(/\s*\((multi[- ]?select|multiselect)\)\s*$/i, " dropdown")
    .trim();
}

function normalizeQuotedTarget(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === ">") return "Next";
  if (trimmed === "<") return "Previous";
  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
