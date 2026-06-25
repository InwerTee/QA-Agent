import type { Locator, Page } from "@playwright/test";
import {
  CLICKABLE_TARGET_SELECTOR,
  INPUT_TARGET_SELECTOR,
  type BrowserObservation,
  type ElementCandidate,
  type InputCandidate
} from "./browserObservation.js";

export type TargetAction = "click" | "fill" | "select";

export interface TargetQuery {
  action: TargetAction;
  target?: string;
  value?: string;
  sourceText?: string;
}

export interface RankedTargetCandidate {
  kind: "clickable" | "input";
  candidate: ElementCandidate | InputCandidate;
  score: number;
  reasons: string[];
}

export type TargetResolution =
  | {
      status: "found";
      locator: Locator;
      candidate: RankedTargetCandidate;
      candidates: RankedTargetCandidate[];
      reason: string;
    }
  | {
      status: "ambiguous" | "not_found";
      candidates: RankedTargetCandidate[];
      reason: string;
    };

export function resolveClickTarget(
  page: Page,
  observation: BrowserObservation,
  query: TargetQuery
): TargetResolution {
  const candidates = rankElementCandidates(observation.clickables, query, "clickable");
  return resolveRankedCandidates(page, candidates, CLICKABLE_TARGET_SELECTOR);
}

export function resolveInputTarget(
  page: Page,
  observation: BrowserObservation,
  query: TargetQuery
): TargetResolution {
  const candidates = rankElementCandidates(observation.inputs, query, "input");
  const resolution = resolveRankedCandidates(page, candidates, INPUT_TARGET_SELECTOR);

  if (resolution.status !== "found") {
    return resolution;
  }

  const candidate = resolution.candidate.candidate;
  const base = page.locator(INPUT_TARGET_SELECTOR).nth(candidate.nth);
  const locator = candidate.tag === "input" || candidate.tag === "textarea" || candidate.role === "textbox"
    ? base
    : base.locator('input, textarea, [contenteditable="true"], [role="textbox"]').first();

  return {
    ...resolution,
    locator
  };
}

export async function resolveSelectTarget(
  page: Page,
  observation: BrowserObservation,
  query: TargetQuery
): Promise<TargetResolution> {
  const labeledControl = await resolveLabeledFormControl(page, query);
  if (labeledControl) {
    return labeledControl;
  }

  const clickables = rankElementCandidates(observation.clickables, query, "clickable");
  const inputs = rankElementCandidates(observation.inputs, query, "input");
  const candidates = dedupeRankedCandidates([...clickables, ...inputs])
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
  const resolution = resolveRankedCandidates(page, candidates, CLICKABLE_TARGET_SELECTOR);

  if (resolution.status !== "found") {
    return resolution;
  }

  const selector =
    resolution.candidate.kind === "input" ? INPUT_TARGET_SELECTOR : CLICKABLE_TARGET_SELECTOR;

  return {
    ...resolution,
    locator: page.locator(selector).nth(resolution.candidate.candidate.nth)
  };
}

async function resolveLabeledFormControl(
  page: Page,
  query: TargetQuery
): Promise<TargetResolution | undefined> {
  const label = formLabelFromTarget(query.target);
  if (!label) return undefined;

  const dialog = page.locator('.el-dialog__wrapper:visible, [role="dialog"]:visible').last();
  const formItem = dialog
    .locator(".el-form-item, .form-item")
    .filter({ hasText: new RegExp(`\\b${escapeRegExp(label)}\\b`, "i") })
    .first();
  const locator = formItem
    .locator('input, textarea, [role="combobox"], .el-select, .el-date-editor, .el-input__inner')
    .first();

  if (!(await locator.isVisible({ timeout: 500 }).catch(() => false))) {
    return undefined;
  }

  const candidate = syntheticCandidate(label);

  return {
    status: "found",
    locator,
    candidate: {
      kind: "input",
      candidate,
      score: 120,
      reasons: [`dialog form label match: ${label}`]
    },
    candidates: [
      {
        kind: "input",
        candidate,
        score: 120,
        reasons: [`dialog form label match: ${label}`]
      }
    ],
    reason: `dialog form label match: ${label}`
  };
}

export function rankElementCandidates(
  elements: Array<ElementCandidate | InputCandidate>,
  query: TargetQuery,
  kind: "clickable" | "input"
): RankedTargetCandidate[] {
  return elements
    .filter((candidate) => !candidate.disabled)
    .map((candidate) => scoreCandidate(candidate, query, kind))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
}

export function describeResolution(resolution: TargetResolution, target?: string): string {
  const label = target ? `"${target}"` : "the requested target";
  const candidateText = resolution.candidates.length
    ? ` Top candidates: ${resolution.candidates.map(formatRankedCandidate).join("; ")}.`
    : "";

  if (resolution.status === "found") {
    return `Resolved ${label} to ${formatRankedCandidate(resolution.candidate)}.`;
  }

  return `${resolution.reason}${candidateText}`;
}

function resolveRankedCandidates(
  page: Page,
  candidates: RankedTargetCandidate[],
  selector: string
): TargetResolution {
  const [best, second] = candidates;

  if (!best || best.score < 35) {
    return {
      status: "not_found",
      candidates,
      reason: "Could not identify a strong enough matching page element from the current observation."
    };
  }

  if (second && second.score >= 35 && best.score - second.score < 10) {
    return {
      status: "ambiguous",
      candidates,
      reason: "Multiple page elements matched the requested target with similar confidence."
    };
  }

  return {
    status: "found",
    locator: page.locator(selector).nth(best.candidate.nth),
    candidate: best,
    candidates,
    reason: best.reasons.join(", ")
  };
}

function scoreCandidate(
  candidate: ElementCandidate | InputCandidate,
  query: TargetQuery,
  kind: "clickable" | "input"
): RankedTargetCandidate {
  const target = normalize(query.target || inferTargetFromSourceText(query.sourceText) || "");
  const targetTokens = expandTokens(tokenize(target));
  const reasons: string[] = [];
  let score = 0;

  if (!target) {
    const fallbackScore = kind === "input" ? 20 : 5;
    return {
      kind,
      candidate,
      score: fallbackScore,
      reasons: ["No explicit target was available; using the first plausible candidate."]
    };
  }

  const primaryFields = [
    ["text", candidate.text],
    ["aria label", candidate.ariaLabel],
    ["title", candidate.title],
    ["placeholder", candidate.placeholder],
    ["test id", candidate.testId],
    ["name", candidate.name],
    ["id", candidate.id]
  ] as const;

  const hintFields = [
    ["class", candidate.className],
    ["icon", candidate.iconHint],
    ["nearby text", candidate.nearText],
    ["role", candidate.role],
    ["type", candidate.type]
  ] as const;

  for (const [fieldName, value] of primaryFields) {
    const fieldScore = scoreField(value, target, targetTokens, fieldName, reasons, true);
    score = Math.max(score, fieldScore);
  }

  for (const [fieldName, value] of hintFields) {
    const fieldScore = scoreField(value, target, targetTokens, fieldName, reasons, false);
    score = Math.max(score, fieldScore);
  }

  if (kind === "input" && /search|query|keyword/.test(target)) {
    const haystack = normalize(`${candidate.placeholder} ${candidate.ariaLabel} ${candidate.className} ${candidate.nearText}`);
    if (/search|query|keyword/.test(haystack)) {
      score = Math.max(score, 75);
      reasons.push("search-like input hint");
    }
  }

  if (query.action === "select") {
    const haystack = normalize(`${candidate.role} ${candidate.className} ${candidate.nearText}`);
    if (/select|dropdown|combobox|el-select/.test(haystack)) {
      score += 10;
      reasons.push("select-like control hint");
    }
  }

  if (kind === "clickable" && (candidate.tag === "button" || candidate.role === "button" || /el-button/i.test(candidate.className))) {
    score += 12;
    reasons.push("button-like control priority");
  }

  if (kind === "input" && (candidate.tag === "input" || candidate.tag === "textarea" || candidate.role === "textbox")) {
    score += 8;
    reasons.push("fillable control priority");
  }

  return {
    kind,
    candidate,
    score,
    reasons: Array.from(new Set(reasons)).slice(0, 4)
  };
}

function dedupeRankedCandidates(candidates: RankedTargetCandidate[]): RankedTargetCandidate[] {
  const byFingerprint = new Map<string, RankedTargetCandidate>();

  for (const candidate of candidates) {
    const fingerprint = candidateFingerprint(candidate.candidate);
    const existing = byFingerprint.get(fingerprint);

    if (!existing || candidate.score > existing.score) {
      byFingerprint.set(fingerprint, candidate);
    }
  }

  return Array.from(byFingerprint.values());
}

function candidateFingerprint(candidate: ElementCandidate | InputCandidate): string {
  return normalize(
    [
      candidate.tag,
      candidate.role,
      candidate.text,
      candidate.ariaLabel,
      candidate.title,
      candidate.placeholder,
      candidate.id,
      candidate.name,
      candidate.className,
      candidate.nearText.slice(0, 80)
    ].join(" ")
  );
}

function scoreField(
  value: string,
  target: string,
  targetTokens: string[],
  fieldName: string,
  reasons: string[],
  primary: boolean
): number {
  const normalized = normalize(value);
  if (!normalized) return 0;

  if (normalized === target) {
    reasons.push(`${fieldName} exact match`);
    return primary ? 100 : 80;
  }

  if (normalized.includes(target) || target.includes(normalized)) {
    reasons.push(`${fieldName} contains target`);
    return primary ? 85 : 65;
  }

  const haystackTokens = expandTokens(tokenize(normalized));
  const matchedTokens = targetTokens.filter((token) => haystackTokens.includes(token));

  if (targetTokens.length > 0 && matchedTokens.length === targetTokens.length) {
    reasons.push(`${fieldName} matches all target tokens`);
    return primary ? 75 : 60;
  }

  if (matchedTokens.length > 0) {
    reasons.push(`${fieldName} matches token(s): ${matchedTokens.join(", ")}`);
    return primary ? 45 + matchedTokens.length * 5 : 30 + matchedTokens.length * 5;
  }

  return 0;
}

function inferTargetFromSourceText(sourceText?: string): string {
  if (!sourceText) return "";
  if (/filter/i.test(sourceText)) return "filter";
  if (/column|setting/i.test(sourceText)) return "column settings";
  if (/search|keyword/i.test(sourceText)) return "search";
  if (/apply/i.test(sourceText)) return "apply";
  if (/reset|clear/i.test(sourceText)) return "reset";
  return "";
}

function formLabelFromTarget(target?: string): string | undefined {
  if (!target) return undefined;

  const label = target
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/^(master campaign|campaign|filter)\s+/i, "")
    .replace(/\b(dropdown|select|multiselect|multi-select|field|input|control|filter)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return label.length > 1 ? label : undefined;
}

function syntheticCandidate(label: string): ElementCandidate {
  return {
    index: -1,
    nth: -1,
    tag: "input",
    role: "combobox",
    text: label,
    ariaLabel: label,
    title: "",
    placeholder: "",
    id: "",
    name: "",
    type: "",
    className: "dialog-form-control",
    testId: "",
    href: "",
    nearText: label,
    iconHint: "",
    disabled: false
  };
}

function expandTokens(tokens: string[]): string[] {
  const expanded = new Set<string>();

  for (const token of tokens) {
    expanded.add(token);
    for (const synonym of synonymsFor(token)) {
      expanded.add(synonym);
    }
  }

  return Array.from(expanded);
}

function synonymsFor(token: string): string[] {
  const synonyms: Record<string, string[]> = {
    filter: ["funnel"],
    filters: ["filter", "funnel"],
    column: ["columns", "field", "fields"],
    columns: ["column", "field", "fields"],
    setting: ["settings", "gear", "cog", "configure", "configuration"],
    settings: ["setting", "gear", "cog", "configure", "configuration"],
    search: ["query", "keyword", "magnify", "magnifier"],
    keyword: ["search", "query"],
    apply: ["confirm", "ok", "submit"],
    reset: ["clear"],
    clear: ["reset"],
    dropdown: ["select", "combobox"],
    select: ["dropdown", "combobox"]
  };

  return synonyms[token] ?? [];
}

function formatRankedCandidate(candidate: RankedTargetCandidate): string {
  const element = candidate.candidate;
  const label =
    element.text ||
    element.ariaLabel ||
    element.title ||
    element.placeholder ||
    element.testId ||
    element.id ||
    element.className ||
    element.tag;
  return `${candidate.kind} ${element.tag}[${element.nth}] "${label.slice(0, 60)}" score=${candidate.score}`;
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function normalize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_/\\.-]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
