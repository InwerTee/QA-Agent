import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  NormalizedCase,
  NormalizedCasePrdContext,
  PrdActionKnowledge,
  PrdCaseContext,
  PrdExtractionStatus,
  PrdFieldKnowledge,
  PrdKnowledgePack,
  PrdKnowledgeRunSummary,
  PrdModuleKnowledge,
  PrdPageKnowledge,
  ResultConfidence,
  Site
} from "../types.js";

const execFileAsync = promisify(execFile);

interface BuildPrdKnowledgeInput {
  release: string;
  title: string;
  prdPath?: string;
  cases: NormalizedCase[];
  outDir: string;
}

interface ExtractedPrdText {
  text: string;
  status: PrdExtractionStatus;
  method: PrdKnowledgePack["extraction"]["method"];
  notes: string[];
}

interface KnownModuleSignal {
  name: string;
  key: string;
  aliases: string[];
  patterns: RegExp[];
}

const MODULE_SIGNALS: KnownModuleSignal[] = [
  signal("Master Campaign", "master_campaign", ["Master Campaign"], [/master\s+campaign/i]),
  signal("Creator Account", "creator_account", ["Creator Account", "Creator Database", "All Creators"], [
    /creator\s+account/i,
    /creator\s+database/i,
    /all\s+creators/i
  ]),
  signal("Campaign", "campaign", ["Campaign", "Campaign List", "Campaign Applicant Dashboard"], [
    /\bcampaign\b/i,
    /applicant\s+dashboard/i
  ]),
  signal("Agency Account", "agency_account", ["Agency Account", "Agency Registration", "Agency Application"], [
    /agency\s+account/i,
    /agency\s+registration/i,
    /agency\s+application/i,
    /registration\s+internal\s+trigger/i,
    /self\s+registration/i
  ]),
  signal("Lock Stock", "lock_stock", ["Lock Stock", "Lock Stock Batch"], [/lock\s*stock/i]),
  signal("Sample Order", "sample_order", ["Sample Order"], [/sample\s+order/i]),
  signal("KR Request", "kr_request", ["KR Request", "KOC Request"], [/\bkr\s+request/i, /\bkoc\s+request/i]),
  signal("Shopee Binding", "shopee_binding", ["Shopee Binding", "Shopee Account"], [/shopee\s+(binding|account)/i]),
  signal("Ads Campaign", "ads_campaign", ["Ads Campaign", "Ad Campaign"], [/\bads?\s+campaign/i])
];

const ACTION_PATTERNS: Array<{ name: string; kind: string; pattern: RegExp }> = [
  { name: "Create", kind: "create", pattern: /\b(add|create|new)\b/i },
  { name: "Search", kind: "search", pattern: /\b(search|keyword)\b/i },
  { name: "Filter", kind: "filter", pattern: /\b(filter|sort)\b/i },
  { name: "Edit", kind: "edit", pattern: /\b(edit|modify|update|change)\b/i },
  { name: "View Detail", kind: "view", pattern: /\b(view|detail|dashboard|open)\b/i },
  { name: "Delete", kind: "delete", pattern: /\b(delete|remove)\b/i },
  { name: "Approve", kind: "approve", pattern: /\bapprove\b/i },
  { name: "Reject", kind: "reject", pattern: /\breject\b/i },
  { name: "Upload", kind: "upload", pattern: /\b(upload|import)\b/i },
  { name: "Export", kind: "export", pattern: /\b(export|download)\b/i },
  { name: "Submit", kind: "submit", pattern: /\bsubmit\b/i }
];

const FIELD_CANDIDATES = [
  "Username",
  "Creator Name",
  "Phone Number",
  "Email",
  "Status",
  "Campaign Name",
  "Campaign Status",
  "Master Campaign Name",
  "Brand",
  "Platform",
  "Start Date",
  "End Date",
  "Agency Name",
  "Invitation Status",
  "Registration Status",
  "Lock Stock Batch",
  "Sample Order",
  "GMV",
  "Views"
];

export async function buildPrdKnowledgePack(input: BuildPrdKnowledgeInput): Promise<PrdKnowledgePack> {
  const extracted = await extractPrdText(input.prdPath);
  const sourceText = [
    input.release,
    input.title,
    input.prdPath ? path.basename(input.prdPath) : "",
    extracted.text,
    ...input.cases.map(caseText)
  ].join("\n");

  const modules = inferModules(sourceText, input.cases);
  const pages = inferPages(sourceText, modules, input.cases);
  const fields = inferFields(sourceText, modules, pages);
  const actions = inferActions(sourceText, modules, pages);
  const caseAlignment = alignCases(input.cases, modules);

  return {
    version: "prd_knowledge.v1",
    release: input.release,
    title: input.title,
    generated_at: new Date().toISOString(),
    source_path: input.prdPath ? relativeTo(input.outDir, input.prdPath) : undefined,
    extraction: {
      status: extracted.status,
      method: extracted.method,
      character_count: extracted.text.length,
      notes: extracted.notes
    },
    modules,
    pages,
    fields,
    actions,
    business_rules: inferBusinessRules(extracted.text),
    glossary: [],
    case_alignment: caseAlignment,
    notes: [
      "PRD Knowledge Pack is a conservative local extraction used as context for case understanding.",
      "Paragon test cases remain the execution authority; PRD context only helps disambiguate modules, pages, fields, and actions.",
      ...extracted.notes
    ]
  };
}

export async function loadPrdKnowledgePack(filePath: string | undefined): Promise<PrdKnowledgePack | undefined> {
  if (!filePath) return undefined;

  try {
    const raw = await readFile(filePath, "utf8");
    const pack = JSON.parse(raw) as PrdKnowledgePack;
    return pack.version === "prd_knowledge.v1" ? pack : undefined;
  } catch {
    return undefined;
  }
}

export function summarizePrdKnowledge(pack: PrdKnowledgePack | undefined): PrdKnowledgeRunSummary | undefined {
  if (!pack) return undefined;

  return {
    source_path: pack.source_path,
    extraction_status: pack.extraction.status,
    modules: pack.modules.map((module) => module.name),
    pages: pack.pages.map((page) => page.name),
    notes: pack.notes.slice(0, 4)
  };
}

export function findPrdContextForCase(
  testCase: NormalizedCase,
  pack: PrdKnowledgePack | undefined
): PrdCaseContext | undefined {
  if (!pack) return undefined;

  const text = normalize(`${testCase.module} ${testCase.scenario_group} ${testCase.scenario} ${testCase.title} ${testCase.precondition} ${testCase.steps.join(" ")} ${testCase.expected_result.join(" ")}`);
  const matchedModules = pack.modules.filter((module) => matchesAny(text, [module.name, ...module.aliases, module.key]));
  const module = matchedModules[0] ?? (pack.modules.length === 1 && testCase.module === "Unknown" ? pack.modules[0] : undefined);
  const moduleKey = module?.key;
  const pages = pack.pages.filter((page) =>
    (moduleKey && page.module_key === moduleKey) || matchesAny(text, [page.name, ...page.aliases])
  );
  const fields = pack.fields.filter((field) =>
    matchesAny(text, [field.name, ...field.aliases]) || (moduleKey && field.module_key === moduleKey && pack.modules.length === 1)
  );
  const actions = pack.actions.filter((action) =>
    matchesAny(text, [action.name, action.kind]) || (moduleKey && action.module_key === moduleKey && actionMatchesCase(text, action))
  );
  const evidence = [
    module ? `PRD module context: ${module.name}.` : undefined,
    pages.length > 0 ? `PRD page context: ${pages.map((page) => page.name).join(", ")}.` : undefined,
    fields.length > 0 ? `PRD field hints: ${fields.slice(0, 6).map((field) => field.name).join(", ")}.` : undefined,
    actions.length > 0 ? `PRD action hints: ${actions.map((action) => action.name).join(", ")}.` : undefined
  ].filter((item): item is string => Boolean(item));

  if (!module && pages.length === 0 && fields.length === 0 && actions.length === 0) return undefined;

  return {
    module,
    pages,
    fields,
    actions,
    confidence: confidenceForContext(module, pages, fields, actions),
    evidence
  };
}

export function casePrdContextForOutput(
  testCase: NormalizedCase,
  pack: PrdKnowledgePack | undefined,
  knowledgePackPath?: string
): NormalizedCasePrdContext | undefined {
  const context = findPrdContextForCase(testCase, pack);
  if (!context) return undefined;

  return {
    knowledge_pack_path: knowledgePackPath,
    matched_module_keys: context.module ? [context.module.key] : [],
    matched_page_names: context.pages.map((page) => page.name),
    matched_fields: context.fields.map((field) => field.name),
    matched_actions: context.actions.map((action) => action.name),
    notes: context.evidence
  };
}

async function extractPrdText(prdPath: string | undefined): Promise<ExtractedPrdText> {
  if (!prdPath) {
    return {
      text: "",
      status: "unavailable",
      method: "case_context",
      notes: ["No PRD file was found in the input package."]
    };
  }

  const extension = path.extname(prdPath).toLowerCase();
  if (extension === ".txt" || extension === ".md") {
    const text = await readFile(prdPath, "utf8");
    return {
      text,
      status: text.trim() ? "available" : "partial",
      method: "text_file",
      notes: [`Read PRD text directly from ${path.basename(prdPath)}.`]
    };
  }

  if (extension === ".pdf") {
    const extracted = await extractPdfText(prdPath);
    if (extracted.trim()) {
      return {
        text: extracted,
        status: "available",
        method: "pdftotext",
        notes: [`Extracted PRD text from ${path.basename(prdPath)} using pdftotext.`]
      };
    }

    return {
      text: path.basename(prdPath, extension),
      status: "partial",
      method: "filename_only",
      notes: [
        "Could not extract PDF text with local pdftotext; PRD knowledge used filename plus test case context."
      ]
    };
  }

  return {
    text: path.basename(prdPath, extension),
    status: "partial",
    method: "filename_only",
    notes: [`Unsupported PRD extension ${extension}; used filename plus test case context.`]
  };
}

async function extractPdfText(prdPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", prdPath, "-"], {
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024
    });
    return stdout;
  } catch {
    return "";
  }
}

function inferModules(text: string, cases: NormalizedCase[]): PrdModuleKnowledge[] {
  const modules = MODULE_SIGNALS
    .filter((module) => module.patterns.some((pattern) => pattern.test(text)))
    .map((module) => ({
      name: module.name,
      key: module.key,
      aliases: module.aliases,
      sites: inferSitesForModule(module, text, cases),
      evidence: evidenceForPatterns(text, module.patterns, module.aliases)
    }));

  return dedupeBy(modules, (module) => module.key);
}

function inferPages(
  text: string,
  modules: PrdModuleKnowledge[],
  cases: NormalizedCase[]
): PrdPageKnowledge[] {
  const candidates = [
    ...extractPageNames(text),
    ...cases.flatMap((testCase) => extractPageNames(caseText(testCase)))
  ];

  const pages = candidates.map((name) => {
    const module = bestModuleForText(name, modules) ?? modules[0];
    const site = inferSiteFromText(name);
    return {
      name,
      module_key: module?.key ?? "unknown",
      aliases: pageAliases(name),
      site,
      candidate_routes: extractRoutes(text).filter((route) => routeMatches(route, name, module?.key)),
      evidence: [`Detected page-like phrase "${name}".`]
    };
  });

  return dedupeBy(pages, (page) => `${page.module_key}:${normalizeKey(page.name)}`).slice(0, 30);
}

function inferFields(
  text: string,
  modules: PrdModuleKnowledge[],
  pages: PrdPageKnowledge[]
): PrdFieldKnowledge[] {
  const quoted = extractQuotedTerms(text).filter((term) => looksLikeField(term));
  const known = FIELD_CANDIDATES.filter((field) => includesNormalized(text, field));
  const names = dedupeStrings([...known, ...quoted]).slice(0, 60);

  return names.map((name) => {
    const page = pages.find((candidate) => includesNormalized(textAround(text, name), candidate.name)) ?? pages[0];
    const module = (page && modules.find((candidate) => candidate.key === page.module_key)) ?? bestModuleForText(name, modules);
    return {
      name,
      module_key: module?.key,
      page_name: page?.name,
      aliases: [name],
      evidence: [`Detected field-like term "${name}".`]
    };
  });
}

function inferActions(
  text: string,
  modules: PrdModuleKnowledge[],
  pages: PrdPageKnowledge[]
): PrdActionKnowledge[] {
  const actions = ACTION_PATTERNS
    .filter((action) => action.pattern.test(text))
    .map((action) => ({
      name: action.name,
      kind: action.kind,
      module_key: modules[0]?.key,
      page_name: pages[0]?.name,
      evidence: [`Detected action verb for ${action.kind}.`]
    }));

  return dedupeBy(actions, (action) => action.kind);
}

function inferBusinessRules(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /\b(should|must|required|only|cannot|can not|display|validate|status|rule)\b/i.test(sentence))
    .slice(0, 25);
}

function alignCases(cases: NormalizedCase[], modules: PrdModuleKnowledge[]) {
  const moduleCaseCounts: Record<string, number> = {};
  let unmatchedCaseCount = 0;

  for (const testCase of cases) {
    const text = normalize(caseText(testCase));
    const module = modules.find((candidate) =>
      matchesAny(text, [candidate.name, candidate.key, ...candidate.aliases])
    ) ?? (modules.length === 1 ? modules[0] : undefined);

    if (module) {
      moduleCaseCounts[module.key] = (moduleCaseCounts[module.key] ?? 0) + 1;
    } else {
      unmatchedCaseCount += 1;
    }
  }

  return {
    case_count: cases.length,
    module_case_counts: moduleCaseCounts,
    unmatched_case_count: unmatchedCaseCount
  };
}

function extractPageNames(text: string): string[] {
  const matches = [
    ...text.matchAll(/\b([A-Z][A-Za-z0-9/& -]{2,80}?(?:List Page|Detail Page|Dashboard Page|Page|Dashboard|Module|Menu|List))\b/g),
    ...text.matchAll(/\b(Admin Site|Creator Site|Agency Site)[\s:-]+([A-Z][A-Za-z0-9/& -]{2,80}?(?:List Page|Detail Page|Dashboard Page|Page|Dashboard|Module|Menu|List))\b/g)
  ];

  return dedupeStrings(matches.map((match) => normalizeDisplay(match[2] ?? match[1]))).filter((name) =>
    !/^(Page|List|Module|Menu)$/i.test(name)
  );
}

function extractRoutes(text: string): string[] {
  return dedupeStrings([...text.matchAll(/\/[A-Za-z0-9_/-]{3,}/g)].map((match) => match[0]));
}

function extractQuotedTerms(text: string): string[] {
  return dedupeStrings([...text.matchAll(/["“]([^"”]{2,80})["”]/g)].map((match) => normalizeDisplay(match[1])));
}

function signal(name: string, key: string, aliases: string[], patterns: RegExp[]): KnownModuleSignal {
  return { name, key, aliases, patterns };
}

function inferSitesForModule(module: KnownModuleSignal, text: string, cases: NormalizedCase[]): Site[] {
  const sites = new Set<Site>();
  const moduleText = `${module.name} ${module.aliases.join(" ")}`;
  for (const testCase of cases) {
    if (matchesAny(normalize(caseText(testCase)), [moduleText, module.key])) {
      sites.add(testCase.site);
    }
  }
  if (/creator\s+site|creator\s+portal/i.test(text)) sites.add("creator");
  if (/agency\s+site|agency\s+portal/i.test(text)) sites.add("agency");
  if (/admin\s+site|admin\s+portal|backoffice|back office/i.test(text)) sites.add("admin");
  if (sites.size === 0) sites.add("admin");
  return Array.from(sites);
}

function bestModuleForText(text: string, modules: PrdModuleKnowledge[]): PrdModuleKnowledge | undefined {
  const normalized = normalize(text);
  return modules.find((module) => matchesAny(normalized, [module.name, module.key, ...module.aliases]));
}

function inferSiteFromText(text: string): Site | undefined {
  if (/creator\s+site|creator\s+portal/i.test(text)) return "creator";
  if (/agency\s+site|agency\s+portal/i.test(text)) return "agency";
  if (/admin\s+site|admin\s+portal|backoffice|back office/i.test(text)) return "admin";
  return undefined;
}

function pageAliases(name: string): string[] {
  return dedupeStrings([
    name,
    name.replace(/\bPage\b/i, "").trim(),
    name.replace(/\bList Page\b/i, "List").trim(),
    name.replace(/\bDashboard\b/i, "").trim()
  ]).filter(Boolean);
}

function routeMatches(route: string, pageName: string, moduleKey: string | undefined): boolean {
  const routeText = normalize(route);
  const pageTokens = normalize(pageName).split(" ").filter((token) => token.length > 2);
  return Boolean(moduleKey && routeText.includes(normalize(moduleKey).replace(/\s+/g, "-"))) ||
    pageTokens.some((token) => routeText.includes(token));
}

function actionMatchesCase(text: string, action: PrdActionKnowledge): boolean {
  return ACTION_PATTERNS.find((pattern) => pattern.kind === action.kind)?.pattern.test(text) ?? false;
}

function confidenceForContext(
  module: PrdModuleKnowledge | undefined,
  pages: PrdPageKnowledge[],
  fields: PrdFieldKnowledge[],
  actions: PrdActionKnowledge[]
): ResultConfidence {
  if (module && (pages.length > 0 || fields.length > 0 || actions.length > 0)) return "high";
  if (module || pages.length > 0) return "medium";
  return "low";
}

function evidenceForPatterns(text: string, patterns: RegExp[], aliases: string[]): string[] {
  const evidence = aliases.filter((alias) => includesNormalized(text, alias)).map((alias) => `Found "${alias}".`);
  if (evidence.length > 0) return evidence.slice(0, 4);
  return patterns.map((pattern) => `Matched ${String(pattern)}.`).slice(0, 2);
}

function looksLikeField(term: string): boolean {
  return /\b(name|status|date|type|number|email|phone|id|brand|platform|amount|views|gmv)\b/i.test(term);
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

function matchesAny(text: string, values: string[]): boolean {
  return values.some((value) => value && text.includes(normalize(value)));
}

function includesNormalized(text: string, value: string): boolean {
  return normalize(text).includes(normalize(value));
}

function textAround(text: string, term: string): string {
  const index = normalize(text).indexOf(normalize(term));
  if (index < 0) return text.slice(0, 500);
  return text.slice(Math.max(0, index - 250), index + term.length + 250);
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(item);
  }
  return result;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeDisplay).filter(Boolean)));
}

function normalize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeKey(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeDisplay(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function relativeTo(fromDir: string, filePath: string): string {
  return path.relative(fromDir, filePath).replaceAll(path.sep, "/");
}
