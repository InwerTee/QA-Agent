import type { Page } from "@playwright/test";
import { AGENT_BUILD_LABEL } from "../runtime/agentVersion.js";
import { runtimeSiteConfig, type RuntimeConfig } from "../runtime/config.js";
import type { NormalizedCase } from "../types.js";
import type { CaseUnderstanding } from "../understanding/caseUnderstanding.js";
import { observePage, type BrowserObservation } from "./browserObservation.js";
import { waitForObservablePage } from "./pageReadiness.js";

export interface PageDiscoveryResult {
  ready: boolean;
  route?: string;
  observation: BrowserObservation;
  match: PageMatch;
  notes: string[];
}

export interface PageMatch {
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

interface CandidateDiscoveryResult {
  route?: string;
  observation: BrowserObservation;
  match: PageMatch;
  ready: boolean;
  notes: string[];
}

export async function discoverStartingPage(
  page: Page,
  config: RuntimeConfig,
  testCase: NormalizedCase,
  understanding: CaseUnderstanding
): Promise<PageDiscoveryResult> {
  const baseUrl = runtimeSiteConfig(config, understanding.site).baseUrl?.replace(/\/$/, "");
  const notes = [
    `${AGENT_BUILD_LABEL} understanding: ${understanding.site}.${understanding.moduleKey}.${understanding.action}.`,
    `Required capabilities: ${understanding.requiredCapabilities.join(", ")}.`
  ];

  if (!baseUrl) {
    const observation = await observePage(page);
    return {
      ready: false,
      observation,
      match: scorePageMatch(observation, understanding),
      notes: [...notes, `No ${understanding.site} base URL is configured, so page discovery could not navigate.`]
    };
  }

  const routeCandidates = understanding.routeHints.candidateRoutes.slice(0, 4);
  const candidates: CandidateDiscoveryResult[] = [];

  for (const route of routeCandidates) {
    candidates.push(await visitCandidateRoute(page, `${baseUrl}${route}`, route, understanding));
    const latest = candidates[candidates.length - 1];
    if (latest.ready && latest.match.score >= 2) {
      return {
        ...latest,
        notes: [
          ...notes,
          ...latest.notes,
          `Selected candidate route ${route} with ${latest.match.confidence} page match.`
        ]
      };
    }
  }

  const baseResult = await visitCandidateRoute(page, baseUrl, "/", understanding);
  candidates.push(baseResult);
  const menuResult = await tryMenuDiscovery(page, understanding);

  if (menuResult) {
    candidates.push(menuResult);
  }

  const best = candidates.sort((left, right) => right.match.score - left.match.score)[0] ?? baseResult;
  return {
    ...best,
    ready: best.ready,
    notes: [
      ...notes,
      ...best.notes,
      best.match.score > 0
        ? `Proceeding with best discovered page (${best.match.confidence} match).`
        : "Proceeding from an observable page, but no strong module match was found."
    ]
  };
}

export function scorePageMatch(
  observation: BrowserObservation,
  understanding: CaseUnderstanding
): PageMatch {
  const reasons: string[] = [];
  let score = 0;
  const haystack = normalize(
    [
      observation.url,
      observation.title,
      observation.visibleTextSample,
      observation.tableHeaders.join(" ")
    ].join(" ")
  );
  const labels = understanding.routeHints.moduleLabels.length > 0
    ? understanding.routeHints.moduleLabels
    : [understanding.module, understanding.businessObject];

  for (const label of labels) {
    const normalizedLabel = normalize(label);
    if (!normalizedLabel) continue;

    if (haystack.includes(normalizedLabel)) {
      score += 2;
      reasons.push(`page contains module label "${label}"`);
    }
  }

  for (const token of understanding.moduleKey.split("_")) {
    if (token.length > 2 && normalize(observation.url).includes(token)) {
      score += 1;
      reasons.push(`URL contains module token "${token}"`);
    }
  }

  for (const label of [...understanding.routeHints.fieldLabels, ...understanding.routeHints.actionLabels].slice(0, 8)) {
    const normalizedLabel = normalize(label);
    if (normalizedLabel && haystack.includes(normalizedLabel)) {
      score += 1;
      reasons.push(`page contains PRD hint "${label}"`);
    }
  }

  if (observation.tableHeaders.length > 0) {
    score += 1;
    reasons.push("page exposes table headers");
  }

  return {
    score,
    confidence: score >= 4 ? "high" : score >= 2 ? "medium" : "low",
    reasons: reasons.length > 0 ? Array.from(new Set(reasons)) : ["no module-specific page signal found"]
  };
}

async function visitCandidateRoute(
  page: Page,
  url: string,
  route: string,
  understanding: CaseUnderstanding
): Promise<CandidateDiscoveryResult> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const readiness = await waitForObservablePage(page, {
    timeoutMs: 12_000,
    reloads: 0
  });
  const match = scorePageMatch(readiness.observation, understanding);

  return {
    route,
    observation: readiness.observation,
    match,
    ready: readiness.ready,
    notes: [
      `Explored route ${route}: ${match.confidence} match (${match.reasons.join("; ")}).`,
      ...readiness.notes
    ]
  };
}

async function tryMenuDiscovery(
  page: Page,
  understanding: CaseUnderstanding
): Promise<CandidateDiscoveryResult | undefined> {
  const labels = understanding.routeHints.moduleLabels;
  if (labels.length === 0) return undefined;

  for (const label of labels) {
    const menuItem = page
      .locator(
        'a:visible, button:visible, [role="menuitem"]:visible, .el-menu-item:visible, .el-sub-menu__title:visible'
      )
      .filter({ hasText: new RegExp(escapeRegExp(label), "i") })
      .first();

    if (!(await menuItem.isVisible({ timeout: 700 }).catch(() => false))) {
      continue;
    }

    await menuItem.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    const observation = await observePage(page);
    const match = scorePageMatch(observation, understanding);

    return {
      observation,
      match,
      ready: true,
      notes: [`Explored menu label "${label}": ${match.confidence} match (${match.reasons.join("; ")}).`]
    };
  }

  return undefined;
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
