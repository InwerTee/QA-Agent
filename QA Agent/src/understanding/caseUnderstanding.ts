import type { NormalizedCase, PrdCaseContext, PrdKnowledgePack, Site } from "../types.js";
import { findPrdContextForCase } from "../knowledge/prdKnowledge.js";

export type UnderstandingConfidence = "high" | "medium" | "low";

export type BusinessAction =
  | "create"
  | "search"
  | "filter"
  | "edit"
  | "view"
  | "delete"
  | "approve"
  | "reject"
  | "bind"
  | "upload"
  | "export"
  | "paginate"
  | "submit"
  | "assert"
  | "unknown";

export interface CaseUnderstanding {
  caseId: string;
  site: Site;
  siteConfidence: UnderstandingConfidence;
  module: string;
  moduleKey: string;
  moduleConfidence: UnderstandingConfidence;
  businessObject: string;
  action: BusinessAction;
  confidence: UnderstandingConfidence;
  requiredCapabilities: string[];
  preconditions: UnderstandingItem[];
  assertions: UnderstandingItem[];
  routeHints: RouteHints;
  prdContext?: PrdCaseContext;
  evidence: string[];
}

export interface UnderstandingItem {
  kind: string;
  text: string;
}

export interface RouteHints {
  moduleLabels: string[];
  candidateRoutes: string[];
  fieldLabels: string[];
  actionLabels: string[];
}

interface ModuleDefinition {
  name: string;
  key: string;
  patterns: RegExp[];
  labels: string[];
  adminRoutes: string[];
}

const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    name: "Master Campaign",
    key: "master_campaign",
    patterns: [/master\s+campaign/i],
    labels: ["Master Campaign"],
    adminRoutes: ["/masterCampaign/master-campaign-list"]
  },
  {
    name: "Lock Stock",
    key: "lock_stock",
    patterns: [/lock\s*stock/i, /lock-stock/i],
    labels: ["Lock Stock", "Lock Stock Batch"],
    adminRoutes: ["/lockStock/lock-stock-list", "/lockStock", "/lock-stock"]
  },
  {
    name: "Sample Order",
    key: "sample_order",
    patterns: [/sample\s+order/i],
    labels: ["Sample Order"],
    adminRoutes: ["/sampleOrder/sample-order-list", "/sampleOrder", "/sample-order"]
  },
  {
    name: "KR Request",
    key: "kr_request",
    patterns: [/\bkr\s+request/i, /\bkoc\s+request/i],
    labels: ["KR Request", "KOC Request"],
    adminRoutes: ["/krRequest/kr-request-list", "/krRequest", "/kr-request"]
  },
  {
    name: "Shopee Binding",
    key: "shopee_binding",
    patterns: [/shopee\s+(binding|bind|account)/i],
    labels: ["Shopee Binding", "Shopee Account"],
    adminRoutes: ["/shopeeBinding/shopee-binding-list", "/shopeeBinding", "/shopee-binding"]
  },
  {
    name: "Ads Campaign",
    key: "ads_campaign",
    patterns: [/\bads?\s+campaign/i, /\bad\s+campaign/i],
    labels: ["Ads Campaign", "Ad Campaign"],
    adminRoutes: ["/adsCampaign/ads-campaign-list", "/adsCampaign", "/ads-campaign"]
  },
  {
    name: "Campaign",
    key: "campaign",
    patterns: [/\bcampaign\b/i],
    labels: ["Campaign"],
    adminRoutes: ["/campaign/campaign-list", "/campaign/list", "/campaign"]
  },
  {
    name: "Creator Account",
    key: "creator_account",
    patterns: [
      /creator\s+account/i,
      /all\s+creators/i,
      /creator\s+account\s+list/i,
      /creator\s+menu/i
    ],
    labels: ["Creator Account", "All Creators", "Creators"],
    adminRoutes: ["/authors/public-page"]
  },
  {
    name: "Creator",
    key: "creator",
    patterns: [/\bcreator\b/i],
    labels: ["Creator"],
    adminRoutes: ["/creator/creator-list", "/creator/list", "/creator"]
  },
  {
    name: "Agency Account",
    key: "agency_account",
    patterns: [
      /agency\s+account/i,
      /registration\s+internal\s+trigger/i,
      /self\s+registration/i,
      /internal\s+registration\s+flow/i,
      /external\s+registration\s+flow/i,
      /agency\s+(row|data|applications?|registration|invitation)/i
    ],
    labels: [
      "Agency Account",
      "Agency/Community Application",
      "Registration Internal Trigger",
      "Self Registration"
    ],
    adminRoutes: [
      "/agency/application",
      "/agency/registration-internal-trigger",
      "/agency/self-registration",
      "/agency/agency-list",
      "/agency"
    ]
  },
  {
    name: "Agency",
    key: "agency",
    patterns: [/\bagency\b/i],
    labels: ["Agency"],
    adminRoutes: ["/agency/agency-list", "/agency/list", "/agency"]
  }
];

export function understandCase(testCase: NormalizedCase, prdKnowledge?: PrdKnowledgePack): CaseUnderstanding {
  const text = caseText(testCase);
  const prdContext = findPrdContextForCase(testCase, prdKnowledge);
  const site = inferSiteFromText(text, testCase.site);
  const moduleDefinition = inferModuleDefinition(
    prdContext?.module ? `${prdContext.module.name} ${prdContext.module.aliases.join(" ")} ${text}` : text,
    prdContext?.module?.name ?? testCase.module
  );
  const action = inferAction(text);
  const preconditions = inferPreconditions(testCase.precondition);
  const assertions = testCase.expected_result.map((expected) => ({
    kind: inferAssertionKind(expected),
    text: expected
  }));
  const requiredCapabilities = inferRequiredCapabilities(site.site, moduleDefinition.key, action);
  const moduleConfidence = moduleDefinition.key === "unknown"
    ? "low"
    : prdContext?.module
      ? prdContext.confidence
    : moduleDefinition.name === testCase.module
      ? "high"
      : "medium";
  const moduleLabels = mergeUnique([
    ...moduleDefinition.labels,
    ...(prdContext?.module ? [prdContext.module.name, ...prdContext.module.aliases] : []),
    ...(prdContext?.pages.flatMap((page) => [page.name, ...page.aliases]) ?? [])
  ]);
  const candidateRoutes = mergeUnique([
    ...(site.site === "admin" ? moduleDefinition.adminRoutes : []),
    ...(prdContext?.pages.flatMap((page) => page.candidate_routes) ?? [])
  ]);

  return {
    caseId: testCase.stable_id,
    site: site.site,
    siteConfidence: site.confidence,
    module: moduleDefinition.name,
    moduleKey: moduleDefinition.key,
    moduleConfidence,
    businessObject: moduleDefinition.name,
    action,
    confidence: combineConfidence(site.confidence, moduleConfidence, action === "unknown" ? "low" : "medium"),
    requiredCapabilities,
    preconditions,
    assertions,
    routeHints: {
      moduleLabels,
      candidateRoutes,
      fieldLabels: prdContext?.fields.map((field) => field.name) ?? [],
      actionLabels: prdContext?.actions.map((actionHint) => actionHint.name) ?? []
    },
    prdContext,
    evidence: [
      `site=${site.site} (${site.confidence})`,
      `module=${moduleDefinition.name} (${moduleConfidence})`,
      `action=${action}`,
      ...(prdContext?.evidence ?? [])
    ]
  };
}

export function inferModuleNameFromText(text: string): string {
  return inferModuleDefinition(text, "Unknown").name;
}

export function inferModuleKeyFromText(text: string): string {
  return inferModuleDefinition(text, "Unknown").key;
}

export function moduleDefinitions(): ModuleDefinition[] {
  return MODULE_DEFINITIONS;
}

function inferModuleDefinition(text: string, fallbackModule: string): ModuleDefinition {
  const fallback = MODULE_DEFINITIONS.find((definition) =>
    definition.name.toLowerCase() === fallbackModule.toLowerCase()
  );
  if (fallback) return fallback;

  const found = MODULE_DEFINITIONS.find((definition) =>
    definition.patterns.some((pattern) => pattern.test(text))
  );

  return found ?? {
    name: fallbackModule && fallbackModule !== "Unknown" ? fallbackModule : "Unknown",
    key: fallbackModule && fallbackModule !== "Unknown" ? normalizeKey(fallbackModule) : "unknown",
    patterns: [],
    labels: fallbackModule && fallbackModule !== "Unknown" ? [fallbackModule] : [],
    adminRoutes: []
  };
}

function inferSiteFromText(text: string, fallback: Site): { site: Site; confidence: UnderstandingConfidence } {
  if (/creator\s+(site|portal)|creator\s+center/i.test(text)) {
    return { site: "creator", confidence: "high" };
  }
  if (/agency\s+(site|portal|center)/i.test(text)) {
    return { site: "agency", confidence: "high" };
  }
  if (/admin\s+(site|portal|center)|backoffice|back office/i.test(text)) {
    return { site: "admin", confidence: "high" };
  }

  return { site: fallback, confidence: fallback === "admin" ? "medium" : "low" };
}

function inferAction(text: string): BusinessAction {
  const checks: Array<[BusinessAction, RegExp]> = [
    ["create", /\b(add|create|new|submit\s+new)\b/i],
    ["search", /\b(search|keyword)\b/i],
    ["filter", /\b(filter|sort)\b/i],
    ["edit", /\b(edit|update|modify|change)\b/i],
    ["delete", /\b(delete|remove)\b/i],
    ["approve", /\b(approve|approval)\b/i],
    ["reject", /\b(reject)\b/i],
    ["bind", /\b(bind|binding|connect)\b/i],
    ["upload", /\b(upload|import)\b/i],
    ["export", /\b(export|download)\b/i],
    ["paginate", /\b(pagination|next\s+page|previous\s+page|next\/prev)\b/i],
    ["view", /\b(view|detail|details|open)\b/i],
    ["submit", /\b(submit|request)\b/i],
    ["assert", /\b(verify|check|confirm|should|display|shown)\b/i]
  ];

  return checks.find(([, pattern]) => pattern.test(text))?.[0] ?? "unknown";
}

function inferPreconditions(precondition: string): UnderstandingItem[] {
  if (!precondition.trim()) return [];

  const items: UnderstandingItem[] = [];
  if (/\blogged\s+in|login|access\b/i.test(precondition)) {
    items.push({ kind: "auth", text: precondition });
  }
  if (/\b(on|open)\b.+\bpage\b/i.test(precondition)) {
    items.push({ kind: "page", text: precondition });
  }
  if (/\bexists|existing|at least one|already exists|prepared|created\b/i.test(precondition)) {
    items.push({ kind: "existing_data", text: precondition });
  }

  return items.length > 0 ? items : [{ kind: "general", text: precondition }];
}

function inferAssertionKind(expected: string): string {
  if (/no data|no results|empty state/i.test(expected)) return "empty_state";
  if (/disabled|not clickable/i.test(expected)) return "disabled_control";
  if (/table|row|list/i.test(expected)) return "table_state";
  if (/toast|message|success|error/i.test(expected)) return "feedback_message";
  if (/status/i.test(expected)) return "status";
  return "visible_state";
}

function inferRequiredCapabilities(site: Site, moduleKey: string, action: BusinessAction): string[] {
  const capabilities = [`${site}.${moduleKey}.discover`];

  if (action !== "unknown") {
    capabilities.push(`${site}.${moduleKey}.${action}`);
  }
  capabilities.push(`${site}.${moduleKey}.assert`);

  return capabilities;
}

function combineConfidence(...values: UnderstandingConfidence[]): UnderstandingConfidence {
  if (values.includes("low")) return "low";
  if (values.includes("medium")) return "medium";
  return "high";
}

function caseText(testCase: NormalizedCase): string {
  return [
    testCase.module,
    testCase.scenario_group,
    testCase.scenario,
    testCase.title,
    testCase.intent,
    testCase.precondition,
    ...testCase.steps,
    ...testCase.expected_result
  ].join(" ");
}

function normalizeKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function mergeUnique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
