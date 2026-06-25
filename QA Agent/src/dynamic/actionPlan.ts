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
  const filterSelection = inferFilterSelection(normalized);

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

  if (/\bnavigate\s+back\b|\bgo\s+back\b|\bback\s+to\b/i.test(normalized)) {
    return {
      action: "navigate",
      target: "back",
      reason: "The step asks the user to return to the previous page or list.",
      confidence: "medium"
    };
  }

  if (/\bnavigate\s+to\b/i.test(normalized) && /\b(menu|page|section)\b/i.test(normalized)) {
    return {
      action: "navigate",
      target: inferNavigationTarget(normalized),
      reason: "The step asks the user to reach a page or menu section; page discovery handles the actual navigation.",
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

  if (filterSelection) {
    return {
      action: "select",
      target: filterSelection.target,
      value: filterSelection.value,
      reason: "The step describes a filter field and option value using field: option syntax.",
      confidence: "medium"
    };
  }

  const quotedSetSelection = inferQuotedSetSelection(normalized);
  if (quotedSetSelection) {
    return {
      action: "select",
      target: quotedSetSelection.target,
      value: quotedSetSelection.value,
      reason: "The step sets a quoted field to a quoted option value.",
      confidence: "medium"
    };
  }

  if (/\b(selects?|chooses?|picks?|sets?|filters?\s+by)\b/i.test(normalized)) {
    return {
      action: "select",
      target: inferSelectionTarget(normalized) ?? inferTargetAfter(normalized, ["in", "from"]) ?? inferFieldTarget(normalized),
      value: quoted[0] ?? inferSelectionValue(normalized),
      reason: "The step asks the user to select an option.",
      confidence: quoted[0] || inferSelectionValue(normalized) ? "medium" : "low"
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

function inferNavigationTarget(text: string): string | undefined {
  const quoted = quotedTexts(text);
  if (quoted.length > 0) return quoted[quoted.length - 1];

  const match = text.match(/\bnavigate\s+to\s+(.+?)(?:\.|$)/i);
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
  const filterSelection = inferFilterSelection(text);
  if (filterSelection) return filterSelection.target;

  const inTheMatch = text.match(/\bin the\s+(.+?),\s*user\s+selects?/i);
  if (inTheMatch?.[1]) return cleanupSelectionTarget(inTheMatch[1]);

  const dropdownMatch = text.match(/\bin the\s+(.+?\bdropdown\b)/i);
  if (dropdownMatch?.[1]) return cleanupSelectionTarget(dropdownMatch[1]);

  return undefined;
}

function inferSelectionValue(text: string): string | undefined {
  const filterSelection = inferFilterSelection(text);
  if (filterSelection) return filterSelection.value;

  const quotedSetSelection = inferQuotedSetSelection(text);
  if (quotedSetSelection) return quotedSetSelection.value;

  const selectInMatch = text.match(/\b(?:selects?|chooses?|picks?)\s+(.+?)\s+in\s+the\s+.+?\bdropdown\b/i);
  if (selectInMatch?.[1]) return cleanupSelectionValue(selectInMatch[1]);

  const selectFromMatch = text.match(/\b(?:selects?|chooses?|picks?)\s+(.+?)\s+from\s+the\s+.+?\bdropdown\b/i);
  if (selectFromMatch?.[1]) return cleanupSelectionValue(selectFromMatch[1]);

  const toMatch = text.match(/\b(?:to|as)\s+(.+?)(?:\.|$)/i);
  if (toMatch?.[1]) return cleanupSelectionValue(toMatch[1]);

  const optionMatch = text.match(/\boption\s+(.+?)(?:\.|$)/i);
  if (optionMatch?.[1]) return cleanupSelectionValue(optionMatch[1]);

  return undefined;
}

function inferQuotedSetSelection(text: string): { target: string; value: string } | undefined {
  if (!/\bsets?\b/i.test(text)) return undefined;

  const quoted = quotedTexts(text);
  if (quoted.length < 2) return undefined;

  const [target, value] = quoted;
  if (!target || !value) return undefined;

  return {
    target: cleanupSelectionTarget(target),
    value: cleanupSelectionValue(value)
  };
}

function inferFilterSelection(text: string): { target: string; value: string } | undefined {
  const filterScope = /\b(filter|dropdown|select|option|criteria|platform|status|type|account|source|campaign)\b/i.test(text);
  if (!filterScope) return undefined;

  const colonText = text
    .replace(/\buser\s+(?:sets?|selects?|chooses?|picks?|filters?\s+by|inputs?|enters?)\s+/i, "")
    .replace(/\bin\s+the\s+filter\b\.?$/i, "")
    .trim();

  const colonMatch = colonText.match(/\b([A-Z][A-Za-z0-9 /&()_-]{1,40})\s*:\s*([^.;]+)(?:[.;]|$)/);
  if (colonMatch?.[1] && colonMatch[2]) {
    return {
      target: cleanupSelectionTarget(`${colonMatch[1]} dropdown`),
      value: cleanupSelectionValue(colonMatch[2])
    };
  }

  const lowerColonMatch = colonText.match(/\b(platform|status|account type|creator source|bind type|campaign type)\s*:\s*([^.;]+)(?:[.;]|$)/i);
  if (lowerColonMatch?.[1] && lowerColonMatch[2]) {
    return {
      target: cleanupSelectionTarget(`${lowerColonMatch[1]} dropdown`),
      value: cleanupSelectionValue(lowerColonMatch[2])
    };
  }

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
  if (/\b(enters?|fills?|typed|typing|filled)\b/i.test(text)) return true;
  if (/\btypes?\b/i.test(text) && !/\btypes?\s+of\b/i.test(text)) return true;
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
    .replace(/\s+(field|filter|select|selection)$/i, " dropdown")
    .trim();
}

function cleanupSelectionValue(value: string): string {
  return value
    .replace(/\b(and|or)\b/gi, ",")
    .replace(/[)"']+$/g, "")
    .replace(/^["'(]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/,$/, "")
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
