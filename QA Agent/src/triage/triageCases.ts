import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AutomationMap,
  CaseTriage,
  NormalizedCase,
  PrdKnowledgePack,
  TriageComplexity,
  TriagePriority,
  TriageReadiness
} from "../types.js";
import { findPrdContextForCase, summarizePrdKnowledge } from "../knowledge/prdKnowledge.js";
import {
  getR6TraceContractCoverage,
  hasR6TraceContract
} from "../traceability/r6TraceContracts.js";

interface TriageOptions {
  outDir?: string;
  prdKnowledge?: PrdKnowledgePack;
}

export interface TriageResult {
  release: string;
  automationMap: AutomationMap;
  automationMapPath: string;
  reportPath: string;
}

const MAIN_FLOW_ORDER: Record<string, number> = {
  "R6-B7.2-TC01": 1,
  "R6-B7.1-TC01": 2,
  "R6-B7.3-TC01": 3,
  "R6-B7.4-TC01": 4,
  "R6-B7.4-TC03": 5,
  "R6-B7.5-TC01": 6
};

const PRIORITY_ORDER: Record<TriagePriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3
};

const READINESS_ORDER: Record<TriageReadiness, number> = {
  implemented: 0,
  candidate: 1,
  needs_fixture: 2,
  manual_review: 3
};

const COMPLEXITY_ORDER: Record<TriageComplexity, number> = {
  low: 0,
  medium: 1,
  high: 2
};

export async function triageRelease(
  release: string,
  cases: NormalizedCase[],
  options: TriageOptions = {}
): Promise<TriageResult> {
  const outDir = path.resolve(options.outDir ?? path.join("inputs", release));
  await mkdir(outDir, { recursive: true });

  const triagedCases = cases.map((testCase) => triageCase(testCase, options.prdKnowledge)).sort(compareTriage);
  const automationMap: AutomationMap = {
    release,
    generated_at: new Date().toISOString(),
    prd_context: summarizePrdKnowledge(options.prdKnowledge),
    total_cases: triagedCases.length,
    summary: summarize(triagedCases),
    main_flow: triagedCases
      .filter((testCase) => testCase.main_flow_order !== undefined)
      .sort((a, b) => (a.main_flow_order ?? 0) - (b.main_flow_order ?? 0))
      .map((testCase) => testCase.stable_id),
    next_candidate_ids: selectNextCandidates(triagedCases).map((testCase) => testCase.stable_id),
    cases: triagedCases
  };

  const automationMapPath = path.join(outDir, "automation_map.json");
  const reportPath = path.join(outDir, "triage_report.md");

  await writeFile(automationMapPath, `${JSON.stringify(automationMap, null, 2)}\n`);
  await writeFile(reportPath, formatTriageReport(automationMap));

  return {
    release,
    automationMap,
    automationMapPath,
    reportPath
  };
}

function triageCase(testCase: NormalizedCase, prdKnowledge?: PrdKnowledgePack): CaseTriage {
  const text = caseText(testCase);
  const prdContext = findPrdContextForCase(testCase, prdKnowledge);
  const executorKey = inferExecutorKey(testCase);
  const mainFlowOrder = MAIN_FLOW_ORDER[testCase.stable_id];
  const blockers = inferBlockers(testCase, text, executorKey);
  const readiness = inferReadiness(testCase, blockers);
  const priority = inferPriority(testCase, readiness, mainFlowOrder, text);
  const complexity = inferComplexity(testCase, text);
  const capabilities = inferRequiredCapabilities(testCase, executorKey, text, prdContext);
  const dependsOn = inferDependsOnCaseIds(testCase, mainFlowOrder, text);
  const rationale = inferRationale(testCase, readiness, priority, complexity, executorKey, blockers, prdContext);

  return {
    stable_id: testCase.stable_id,
    title: testCase.title,
    scenario_group: testCase.scenario_group,
    priority,
    readiness,
    complexity,
    executor_key: executorKey,
    main_flow_order: mainFlowOrder,
    required_capabilities: capabilities,
    depends_on_case_ids: dependsOn,
    blockers,
    rationale,
    traceability: {
      source_workbook: testCase.source.workbook,
      source_sheet: testCase.sheet,
      source_row: testCase.source_row,
      raw_test_case: testCase.raw_source.test_case,
      raw_step_count: testCase.steps.length,
      raw_expected_count: testCase.expected_result.length,
      has_executor_contract: hasR6TraceContract(testCase.stable_id),
      contract_coverage: getR6TraceContractCoverage(testCase)
    },
    next_action: inferNextAction(readiness, executorKey, blockers)
  };
}

function inferExecutorKey(testCase: NormalizedCase): string {
  const text = caseText(testCase);

  if (/B7\.1/i.test(testCase.scenario_group)) {
    if (/search/i.test(text)) return "master_campaign.list.search";
    if (/filter/i.test(text)) return "master_campaign.list.filter";
    if (/column settings|hide a column|reorder columns|reset columns/i.test(text)) {
      return "master_campaign.list.column_settings";
    }
    if (/pagination|next|previous|go to page/i.test(text)) return "master_campaign.list.pagination";
    if (/data display|default columns/i.test(text)) return "master_campaign.list.table_assertions";
    return "master_campaign.list";
  }

  if (/B7\.2/i.test(testCase.scenario_group)) {
    if (/missing|required|invalid/i.test(testCase.title)) return "master_campaign.create.validation";
    return "master_campaign.create";
  }

  if (/B7\.3/i.test(testCase.scenario_group)) {
    if (/required|invalid/i.test(testCase.title)) return "master_campaign.edit.validation";
    return "master_campaign.edit";
  }

  if (/B7\.4/i.test(testCase.scenario_group)) {
    if (/save allocation successfully/i.test(testCase.title)) return "master_campaign.allocation";
    if (/over-allocation|numeric|cancel|recalculation|highlight/i.test(text)) {
      return "master_campaign.allocation.validation";
    }
    return "master_campaign.allocation";
  }

  if (/B7\.5/i.test(testCase.scenario_group)) {
    if (/open master campaign detail dashboard/i.test(testCase.title)) {
      return "master_campaign.detail.dashboard";
    }
    if (/top 10/i.test(text)) return "master_campaign.detail.top_content";
    if (/content by type/i.test(text)) return "master_campaign.detail.content_by_type";
    if (/time|pillar|filter/i.test(text)) return "master_campaign.detail.filters";
    if (/division|fyp|productivity|calculation|aggregation/i.test(text)) {
      return "master_campaign.detail.metric_assertions";
    }
    if (/campaign detail from campaign list/i.test(text)) return "master_campaign.detail.cross_navigation";
    return "master_campaign.detail.dashboard";
  }

  return "unmapped";
}

function inferReadiness(testCase: NormalizedCase, blockers: string[]): TriageReadiness {
  if (testCase.automation_status === "ready") return "implemented";
  if (testCase.automation_status === "manual_review") return "manual_review";
  if (blockers.length > 0) return "needs_fixture";
  return "candidate";
}

function inferPriority(
  testCase: NormalizedCase,
  readiness: TriageReadiness,
  mainFlowOrder: number | undefined,
  text: string
): TriagePriority {
  if (mainFlowOrder !== undefined) return "P0";
  if (readiness === "manual_review") return "P3";
  if (/search with no results|filter by single|reset filter|missing required|invalid numeric|save disabled|numeric-only|cancel/i.test(text)) {
    return "P1";
  }
  if (/dashboard|allocation|column settings|pagination|date range|multi-select|aggregation|calculation/i.test(text)) {
    return "P2";
  }
  if (/negative|edge case/i.test(testCase.type)) return "P1";
  return "P2";
}

function inferComplexity(testCase: NormalizedCase, text: string): TriageComplexity {
  if (/dashboard|allocation|aggregation|calculation|division by zero|fyp|productivity|backend|network|external|cross-check/i.test(text)) {
    return "high";
  }
  if (/filter|column settings|pagination|edit|date range|multi-select|validation|numeric|required/i.test(text)) {
    return "medium";
  }
  if (/B7\.2/i.test(testCase.scenario_group)) return "medium";
  return "low";
}

function inferBlockers(testCase: NormalizedCase, text: string, executorKey: string): string[] {
  const blockers: string[] = [];

  if (/no master campaigns|new user logs in/i.test(text)) {
    blockers.push("Needs isolated empty-state fixture or a controlled account with no Master Campaign records.");
  }
  if (/multiple pages|page 1 of 10|total number of pages|rows per page/i.test(text)) {
    blockers.push("Needs deterministic list-size fixture for pagination assertions.");
  }
  if (/10 Planning|15 In Progress|5 Complete|various Brands|yesterday|last month/i.test(text)) {
    blockers.push("Needs seeded Master Campaign dataset with known status, brand, date, and metric values.");
  }
  if (/existing allocation|allocation updated|targets or allocations updated|pillar mappings/i.test(text)) {
    blockers.push("Needs Master Campaign allocation fixture with known pillar and target data.");
  }
  if (
    /detail|dashboard|top_content|content_by_type|metric_assertions/i.test(executorKey) &&
    /dashboard|kpi|gmv|views|contents|creators|top 10|content by type|median views|yellow cart/i.test(text)
  ) {
    blockers.push("Needs analytics/dashboard fixture with deterministic campaign and content metrics.");
  }
  if (/backend or network issue|fail to load|timeout/i.test(text)) {
    blockers.push("Needs backend failure control or network interception strategy.");
  }
  if (/new browser tab|original content|platform|external/i.test(text)) {
    blockers.push("Needs external-link policy and tab assertion strategy.");
  }
  if (/cross-checks underlying content data|detail view or export/i.test(text)) {
    blockers.push("Needs trusted source-of-truth data access beyond visible UI.");
  }

  return Array.from(new Set(blockers));
}

function inferRequiredCapabilities(
  testCase: NormalizedCase,
  executorKey: string,
  text: string,
  prdContext?: ReturnType<typeof findPrdContextForCase>
): string[] {
  const moduleKey = prdContext?.module?.key ?? normalizeKey(testCase.module);
  const site = testCase.site;
  const capabilities = new Set<string>([`${site}_session`, `${site}.${moduleKey}.discover`]);

  if (testCase.dependencies.length > 0 || /master campaign/i.test(text)) {
    capabilities.add("master_campaign_fixture");
  }
  for (const action of prdContext?.actions ?? []) {
    capabilities.add(`${site}.${moduleKey}.${action.kind}`);
  }
  for (const page of prdContext?.pages ?? []) {
    capabilities.add(`${site}.${page.module_key}.page:${normalizeKey(page.name)}`);
  }
  if (/search/i.test(executorKey)) capabilities.add("list_search");
  if (/filter/i.test(executorKey)) capabilities.add("list_filter");
  if (/column_settings/i.test(executorKey)) capabilities.add("column_settings");
  if (/pagination/i.test(executorKey)) capabilities.add("pagination_controls");
  if (/create/i.test(executorKey)) capabilities.add("create_master_campaign_form");
  if (/edit/i.test(executorKey)) capabilities.add("edit_master_campaign_form");
  if (/validation/i.test(executorKey)) capabilities.add("form_validation_assertions");
  if (/allocation/i.test(executorKey)) capabilities.add("allocation_form_and_pillar_targets");
  if (/detail/i.test(executorKey)) capabilities.add("master_campaign_detail_dashboard");
  if (/metric|dashboard|top_content|content_by_type/i.test(executorKey)) {
    capabilities.add("deterministic_analytics_fixture");
  }
  if (/network|backend|fail to load/i.test(text)) capabilities.add("network_or_backend_failure_control");
  if (/new browser tab|external/i.test(text)) capabilities.add("external_tab_assertions");

  return Array.from(capabilities);
}

function inferDependsOnCaseIds(
  testCase: NormalizedCase,
  mainFlowOrder: number | undefined,
  text: string
): string[] {
  const dependencies = new Set(testCase.dependencies.map((dependency) => dependency.stable_id));

  if (testCase.stable_id !== "R6-B7.2-TC01" && /master campaign/i.test(text)) {
    dependencies.add("R6-B7.2-TC01");
  }
  if (/B7\.4|allocation|dashboard/i.test(`${testCase.scenario_group} ${text}`)) {
    dependencies.add("R6-B7.2-TC01");
  }
  if (/existing allocation|edit allocation|dashboard after target|allocation updated/i.test(text)) {
    dependencies.add("R6-B7.4-TC03");
  }
  if (mainFlowOrder !== undefined && mainFlowOrder > 2) {
    dependencies.add("R6-B7.2-TC01");
  }

  dependencies.delete(testCase.stable_id);
  return Array.from(dependencies);
}

function inferRationale(
  testCase: NormalizedCase,
  readiness: TriageReadiness,
  priority: TriagePriority,
  complexity: TriageComplexity,
  executorKey: string,
  blockers: string[],
  prdContext?: ReturnType<typeof findPrdContextForCase>
): string[] {
  const rationale = [
    `${priority} because this case ${MAIN_FLOW_ORDER[testCase.stable_id] ? "participates in the proposed R6 main flow" : "covers a supporting R6 behavior"}.`,
    `${readiness} because current status is ${testCase.automation_status} and inferred executor is ${executorKey}.`,
    `${complexity} complexity based on UI surface, fixture needs, and assertion depth.`
  ];

  if (blockers.length > 0) {
    rationale.push(`Blocked by fixture/control need: ${blockers[0]}`);
  }
  if (prdContext?.module) {
    rationale.push(`PRD context matched module ${prdContext.module.name} (${prdContext.confidence}).`);
  }

  return rationale;
}

function inferNextAction(
  readiness: TriageReadiness,
  executorKey: string,
  blockers: string[]
): string {
  if (readiness === "implemented") {
    return "Keep in smoke set and use as dependency seed for later cases.";
  }
  if (readiness === "manual_review") {
    return "Clarify expected evidence and decide whether UI automation is worthwhile.";
  }
  if (readiness === "needs_fixture") {
    return `Create fixture/control first, then map selectors for ${executorKey}. ${blockers[0]}`;
  }
  return `Map selectors and add executor branch for ${executorKey}.`;
}

function selectNextCandidates(cases: CaseTriage[]): CaseTriage[] {
  return cases
    .filter((testCase) => testCase.readiness !== "implemented")
    .filter((testCase) => testCase.readiness !== "manual_review")
    .sort(compareTriage)
    .slice(0, 10);
}

function summarize(cases: CaseTriage[]): AutomationMap["summary"] {
  const summary: AutomationMap["summary"] = {
    by_priority: { P0: 0, P1: 0, P2: 0, P3: 0 },
    by_readiness: { implemented: 0, candidate: 0, needs_fixture: 0, manual_review: 0 },
    by_complexity: { low: 0, medium: 0, high: 0 }
  };

  for (const testCase of cases) {
    summary.by_priority[testCase.priority] += 1;
    summary.by_readiness[testCase.readiness] += 1;
    summary.by_complexity[testCase.complexity] += 1;
  }

  return summary;
}

function formatTriageReport(map: AutomationMap): string {
  const mainFlowRows = map.main_flow
    .map((id) => map.cases.find((testCase) => testCase.stable_id === id))
    .filter((testCase): testCase is CaseTriage => Boolean(testCase))
    .map(formatCaseRow)
    .join("\n");

  const nextRows = map.next_candidate_ids
    .map((id) => map.cases.find((testCase) => testCase.stable_id === id))
    .filter((testCase): testCase is CaseTriage => Boolean(testCase))
    .map(formatCaseRow)
    .join("\n");

  const byExecutor = Array.from(
    map.cases.reduce<Map<string, number>>((acc, testCase) => {
      acc.set(testCase.executor_key, (acc.get(testCase.executor_key) ?? 0) + 1);
      return acc;
    }, new Map())
  )
    .sort((a, b) => b[1] - a[1])
    .map(([executor, count]) => `- \`${executor}\`: ${count}`)
    .join("\n");

  return `# ${map.release} Automation Triage

Generated: ${map.generated_at}

## Summary

- Total cases: ${map.total_cases}
- Priority: P0 ${map.summary.by_priority.P0}, P1 ${map.summary.by_priority.P1}, P2 ${map.summary.by_priority.P2}, P3 ${map.summary.by_priority.P3}
- Readiness: implemented ${map.summary.by_readiness.implemented}, candidate ${map.summary.by_readiness.candidate}, needs fixture/control ${map.summary.by_readiness.needs_fixture}, manual review ${map.summary.by_readiness.manual_review}
- Complexity: low ${map.summary.by_complexity.low}, medium ${map.summary.by_complexity.medium}, high ${map.summary.by_complexity.high}
${map.prd_context ? `- PRD context: ${map.prd_context.extraction_status}; modules ${map.prd_context.modules.join(", ") || "none inferred"}` : "- PRD context: not available"}

## Proposed R6 Main Flow

| Case | Source Row | Contract | Priority | Readiness | Executor | Next Action |
| --- | ---: | --- | --- | --- | --- | --- |
${mainFlowRows}

## Next Automation Candidates

| Case | Source Row | Contract | Priority | Readiness | Executor | Next Action |
| --- | ---: | --- | --- | --- | --- | --- |
${nextRows}

## Executor Buckets

${byExecutor}

## Notes

- P0 is the proposed R6 main flow: create, find, edit, allocate, and open detail.
- \`implemented\` means the current Playwright executor already supports that case.
- \`candidate\` means the case looks UI-automatable once selectors are mapped.
- \`needs_fixture\` means the agent needs deterministic seed data, API setup, account state, or network/backend control before a browser script can make a reliable judgment.
- \`manual_review\` means the case needs human decision on evidence strategy or whether automation is worth it.
`;
}

function formatCaseRow(testCase: CaseTriage): string {
  return `| \`${testCase.stable_id}\` ${escapePipe(testCase.title)} | ${testCase.traceability.source_row} | ${testCase.traceability.has_executor_contract ? "yes" : "no"} | ${testCase.priority} | ${testCase.readiness} | \`${testCase.executor_key}\` | ${escapePipe(testCase.next_action)} |`;
}

function compareTriage(a: CaseTriage, b: CaseTriage): number {
  return (
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
    READINESS_ORDER[a.readiness] - READINESS_ORDER[b.readiness] ||
    (a.main_flow_order ?? 99) - (b.main_flow_order ?? 99) ||
    COMPLEXITY_ORDER[a.complexity] - COMPLEXITY_ORDER[b.complexity] ||
    a.stable_id.localeCompare(b.stable_id)
  );
}

function caseText(testCase: NormalizedCase): string {
  return [
    testCase.scenario_group,
    testCase.scenario,
    testCase.title,
    testCase.type,
    testCase.precondition,
    ...testCase.steps,
    ...testCase.expected_result
  ].join(" ");
}

function escapePipe(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}
