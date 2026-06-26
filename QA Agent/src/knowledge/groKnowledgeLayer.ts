import type { RuntimeConfig } from "../runtime/config.js";
import type {
  CaseKnowledgeRecord,
  GroKnowledgeLayer,
  GroKnowledgeLayerSummary,
  KnowledgeGap,
  KnowledgeGapCode,
  KnowledgeGapSeverity,
  NormalizedCase,
  PrdKnowledgePack,
  ResultConfidence,
  Site,
  TestCaseIR,
  TestCaseIRNode,
  TestCaseIRTranslationStatus
} from "../types.js";
import { buildDynamicActionPlan } from "../dynamic/actionPlan.js";
import {
  buildRuntimeTestCaseIR,
  type BuildRuntimeTestCaseIROptions,
  type TestCaseIRBuildResult
} from "../dynamic/llmTestCaseIR.js";
import {
  understandCase,
  type CaseUnderstanding
} from "../understanding/caseUnderstanding.js";
import { summarizePrdKnowledge } from "./prdKnowledge.js";

export interface BuildGroKnowledgeLayerInput {
  release: string;
  title: string;
  cases: NormalizedCase[];
  prdKnowledge?: PrdKnowledgePack;
}

export interface BuildGroKnowledgeLayerOptions extends BuildRuntimeTestCaseIROptions {}

export async function buildGroKnowledgeLayer(
  input: BuildGroKnowledgeLayerInput,
  config: RuntimeConfig,
  options: BuildGroKnowledgeLayerOptions = {}
): Promise<GroKnowledgeLayer> {
  const records: CaseKnowledgeRecord[] = [];

  for (const testCase of input.cases) {
    records.push(await buildCaseKnowledgeRecord(testCase, input.prdKnowledge, config, options));
  }

  return {
    version: "gro_knowledge_layer.v1",
    release: input.release,
    title: input.title,
    generated_at: new Date().toISOString(),
    prd_context: summarizePrdKnowledge(input.prdKnowledge),
    summary: summarizeCaseKnowledge(records, config),
    cases: records,
    notes: [
      "v0.21 Gro Knowledge Layer captures what the agent understands before browser execution.",
      "Current no-API mode uses local rule-based Test Case IR translation.",
      "The optional LLM translator remains disabled unless QA_LLM_ENABLED=true and OPENAI_API_KEY is configured.",
      "Knowledge gaps are planning signals, not Gro product defects.",
      "Candidate understanding must be verified by browser evidence before becoming reusable recipe memory."
    ]
  };
}

export function formatKnowledgeMissingReport(layer: GroKnowledgeLayer): string {
  const actionableGaps = layer.cases.flatMap((testCase) =>
    testCase.knowledge_gaps.filter((gapItem) => gapItem.severity !== "info")
  );
  const actionableGapCounts = actionableGaps.reduce<Partial<Record<KnowledgeGapCode, number>>>(
    (summary, gapItem) => {
      summary[gapItem.code] = (summary[gapItem.code] ?? 0) + 1;
      return summary;
    },
    {}
  );
  const topGaps = Object.entries(actionableGapCounts)
    .sort(([, left], [, right]) => (right ?? 0) - (left ?? 0))
    .map(([code, count]) => `- ${labelGapCode(code as KnowledgeGapCode)}: ${count}`);
  const casesWithGaps = layer.cases.filter((testCase) =>
    testCase.knowledge_gaps.some((gapItem) => gapItem.severity !== "info")
  );
  const rows = layer.cases.map((testCase) => {
    const blockers = testCase.knowledge_gaps.filter((gap) => gap.severity === "blocker");
    const warnings = testCase.knowledge_gaps.filter((gap) => gap.severity === "warning");
    const nextAction = firstNextAction(testCase.knowledge_gaps);
    return [
      `\`${testCase.case_id}\``,
      escapePipe(testCase.understanding.module),
      escapePipe(testCase.understanding.business_action),
      testCase.understanding.confidence,
      blockers.length,
      warnings.length,
      escapePipe(nextAction)
    ].join(" | ");
  });

  return `# Knowledge Missing Report - ${layer.release}

## Summary

- Total cases: ${layer.summary.total_cases}
- Cases with blockers: ${layer.summary.cases_with_blockers}
- Cases with warnings: ${layer.summary.cases_with_warnings}
- Understanding mode: ${layer.summary.llm.enabled ? "optional LLM enabled with local validation" : "local rules, no API"}
- Rule/local IR cases: ${layer.summary.llm.rules_only + layer.summary.llm.disabled + layer.summary.llm.unconfigured + layer.summary.llm.rejected + layer.summary.llm.error}
- Optional LLM accepted IR: ${layer.summary.llm.accepted}

## Top Knowledge Gaps

${topGaps.length > 0 ? topGaps.join("\n") : "- No gaps detected."}

## Case Readiness For Knowledge

| Case | Module | Action | Confidence | Blockers | Warnings | Recommended next action |
| --- | --- | --- | --- | ---: | ---: | --- |
${rows.join("\n")}

## Blocked / Warning Details

${casesWithGaps.length > 0 ? casesWithGaps.map(formatCaseGaps).join("\n\n") : "No case-level knowledge gaps were detected."}

## Notes

${layer.notes.map((note) => `- ${note}`).join("\n")}
`;
}

function formatCaseGaps(testCase: CaseKnowledgeRecord): string {
  const gaps = testCase.knowledge_gaps
    .filter((gap) => gap.severity !== "info")
    .map((gap) => {
      const source = gap.source_type
        ? ` Source: ${gap.source_type}:${gap.source_index ?? "?"}.`
        : "";
      return `- ${gap.severity.toUpperCase()} ${labelGapCode(gap.code)}: ${gap.message}${source} Next: ${gap.recommended_next_action}`;
    })
    .join("\n");

  return `### ${testCase.case_id} - ${testCase.title}

- Understanding: ${testCase.understanding.site}.${testCase.understanding.module_key}.${testCase.understanding.business_action}
- Required capabilities: ${testCase.required_capabilities.join(", ") || "none inferred"}

${gaps}`;
}

async function buildCaseKnowledgeRecord(
  testCase: NormalizedCase,
  prdKnowledge: PrdKnowledgePack | undefined,
  config: RuntimeConfig,
  options: BuildGroKnowledgeLayerOptions
): Promise<CaseKnowledgeRecord> {
  const understanding = understandCase(testCase, prdKnowledge);
  const actionPlan = buildDynamicActionPlan(testCase);
  const irBuild = await buildRuntimeTestCaseIR(testCase, actionPlan, config, options);
  const knowledgeGaps = inferKnowledgeGaps(testCase, understanding, irBuild, config);

  return {
    case_id: testCase.stable_id,
    title: testCase.title,
    source: {
      workbook: testCase.source.workbook,
      sheet: testCase.sheet,
      row: testCase.source_row
    },
    understanding: {
      site: understanding.site,
      site_confidence: understanding.siteConfidence,
      module: understanding.module,
      module_key: understanding.moduleKey,
      module_confidence: understanding.moduleConfidence,
      business_object: understanding.businessObject,
      business_action: understanding.action,
      confidence: understanding.confidence,
      route_hints: {
        module_labels: understanding.routeHints.moduleLabels,
        candidate_routes: understanding.routeHints.candidateRoutes,
        field_labels: understanding.routeHints.fieldLabels,
        action_labels: understanding.routeHints.actionLabels
      },
      evidence: understanding.evidence
    },
    required_capabilities: understanding.requiredCapabilities,
    preconditions: understanding.preconditions,
    expected_assertions: understanding.assertions,
    test_case_ir: irBuild.ir,
    knowledge_gaps: knowledgeGaps,
    notes: [
      ...understanding.evidence,
      ...irBuild.notes
    ]
  };
}

function inferKnowledgeGaps(
  testCase: NormalizedCase,
  understanding: CaseUnderstanding,
  irBuild: TestCaseIRBuildResult,
  config: RuntimeConfig
): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];

  if (understanding.siteConfidence === "low") {
    gaps.push(gap(
      "unknown_site",
      "blocker",
      `Target site was inferred with low confidence: ${understanding.site}.`,
      "Clarify whether this case belongs to Admin, Creator, or Agency before browser execution."
    ));
  }

  if (understanding.moduleKey === "unknown") {
    gaps.push(gap(
      "unknown_module",
      "blocker",
      "The case did not map to a known Gro module.",
      "Add module aliases/routes to Gro module knowledge or improve PRD/test-case context classification."
    ));
  } else if (understanding.moduleConfidence === "low" || understanding.confidence === "low") {
    gaps.push(gap(
      "low_confidence_understanding",
      "warning",
      `The case mapped to ${understanding.module}, but confidence is ${understanding.confidence}.`,
      "Review module/action classification before promoting this case to recipe execution."
    ));
  }

  if (!understanding.prdContext) {
    gaps.push(gap(
      "prd_context_missing",
      "warning",
      "No PRD context matched this case.",
      "Improve PRD extraction or add module/page/field aliases for this release."
    ));
  }

  if (understanding.routeHints.candidateRoutes.length === 0) {
    gaps.push(gap(
      "route_hint_missing",
      "warning",
      `No candidate route is known for ${understanding.site}.${understanding.moduleKey}.`,
      "Use page exploration to verify the menu entry or route, then store it in module knowledge."
    ));
  }

  if (testCase.automation_status !== "ready") {
    gaps.push(gap(
      "recipe_missing",
      "blocker",
      "This case has no verified executor/recipe yet.",
      "Build or verify a recipe before treating this case as automatically executable."
    ));
  }

  addTranslationGaps(gaps, irBuild.ir, config);
  addNodeGaps(gaps, irBuild.ir);

  if (!irBuild.validation.ok) {
    gaps.push(gap(
      "llm_rejected",
      "warning",
      `Test Case IR validation reported: ${irBuild.validation.errors.join("; ")}`,
      "Keep the rule-based IR and inspect the original case text before retrying OpenAI translation."
    ));
  }

  return dedupeGaps(gaps);
}

function addTranslationGaps(gaps: KnowledgeGap[], ir: TestCaseIR, config: RuntimeConfig): void {
  const status = ir.translation.status;

  if (status === "llm_accepted" || status === "rules_only") return;

  if (status === "llm_disabled") {
    gaps.push(gap(
      "llm_unavailable",
      "info",
      "Optional LLM translation is disabled; local rule-based IR was used.",
      "No action is needed for no-API mode."
    ));
    return;
  }

  if (status === "llm_unconfigured") {
    gaps.push(gap(
      "llm_unavailable",
      "info",
      `Optional LLM translation was requested but OPENAI_API_KEY is missing for model ${config.llmModel}.`,
      "Configure OPENAI_API_KEY or keep using rule-based understanding."
    ));
    return;
  }

  if (status === "llm_rejected") {
    gaps.push(gap(
      "llm_rejected",
      "warning",
      "OpenAI generated an IR candidate, but local traceability validation rejected it.",
      "Inspect validation errors and improve the prompt/schema before trusting this translation."
    ));
    return;
  }

  if (status === "llm_error") {
    gaps.push(gap(
      "llm_error",
      "warning",
      "OpenAI Test Case IR translation failed and fell back to local rules.",
      "Check API credentials/network/model configuration, then retry if OpenAI understanding is needed."
    ));
  }
}

function addNodeGaps(gaps: KnowledgeGap[], ir: TestCaseIR): void {
  for (const node of [...ir.preconditions, ...ir.actions, ...ir.assertions]) {
    if (node.kind === "precondition" && node.ir_type === "precondition_existing_data") {
      gaps.push(nodeGap(
        "setup_data_required",
        "blocker",
        node,
        "Existing setup data is required before this case can be executed reliably.",
        "Create a deterministic fixture/API setup or link this case to a setup recipe."
      ));
      continue;
    }

    if (node.kind === "action") {
      if (node.capability === "blocked") {
        gaps.push(nodeGap(
          "blocked_action",
          "blocker",
          node,
          `Action ${node.ir_type} is blocked by current agent capability.`,
          "Add or verify a recipe for this action before execution."
        ));
      } else if (node.capability === "manual") {
        gaps.push(nodeGap(
          "manual_action",
          "blocker",
          node,
          `Action ${node.ir_type} still requires manual interpretation.`,
          "Use page exploration and recipe building to turn this into a concrete recipe step."
        ));
      } else if (node.confidence === "low") {
        gaps.push(nodeGap(
          "low_confidence_action",
          "warning",
          node,
          `Action ${node.ir_type} was inferred with low confidence.`,
          "Verify target/value with PRD context or a page snapshot before execution."
        ));
      }
      continue;
    }

    if (node.kind === "assertion") {
      if (node.capability === "blocked") {
        gaps.push(nodeGap(
          "blocked_assertion",
          "blocker",
          node,
          `Assertion ${node.ir_type} is blocked by current agent capability.`,
          "Define a deterministic assertion strategy or keep this expected result as manual review."
        ));
      } else if (node.capability === "manual") {
        gaps.push(nodeGap(
          "manual_assertion",
          "warning",
          node,
          `Assertion ${node.ir_type} still requires manual review.`,
          "Decide what browser evidence can prove this expected result."
        ));
      }
    }
  }
}

function summarizeCaseKnowledge(
  records: CaseKnowledgeRecord[],
  config: RuntimeConfig
): GroKnowledgeLayerSummary {
  const bySite: Record<Site, number> = { admin: 0, creator: 0, agency: 0 };
  const byModule: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  const byGapCode: Partial<Record<KnowledgeGapCode, number>> = {};
  const llm = {
    enabled: config.llmEnabled,
    model: config.llmEnabled ? config.llmModel : undefined,
    accepted: 0,
    disabled: 0,
    unconfigured: 0,
    rejected: 0,
    error: 0,
    rules_only: 0
  };

  for (const record of records) {
    bySite[record.understanding.site] += 1;
    byModule[record.understanding.module_key] = (byModule[record.understanding.module_key] ?? 0) + 1;
    byAction[record.understanding.business_action] = (byAction[record.understanding.business_action] ?? 0) + 1;

    for (const gap of record.knowledge_gaps) {
      byGapCode[gap.code] = (byGapCode[gap.code] ?? 0) + 1;
    }

    countTranslation(llm, record.test_case_ir.translation.status);
  }

  return {
    total_cases: records.length,
    cases_with_blockers: records.filter((record) =>
      record.knowledge_gaps.some((gap) => gap.severity === "blocker")
    ).length,
    cases_with_warnings: records.filter((record) =>
      record.knowledge_gaps.some((gap) => gap.severity === "warning")
    ).length,
    by_site: bySite,
    by_module: byModule,
    by_action: byAction,
    by_gap_code: byGapCode,
    llm
  };
}

function countTranslation(
  summary: GroKnowledgeLayerSummary["llm"],
  status: TestCaseIRTranslationStatus
): void {
  if (status === "llm_accepted") summary.accepted += 1;
  else if (status === "llm_disabled") summary.disabled += 1;
  else if (status === "llm_unconfigured") summary.unconfigured += 1;
  else if (status === "llm_rejected") summary.rejected += 1;
  else if (status === "llm_error") summary.error += 1;
  else summary.rules_only += 1;
}

function gap(
  code: KnowledgeGapCode,
  severity: KnowledgeGapSeverity,
  message: string,
  recommendedNextAction: string
): KnowledgeGap {
  return {
    code,
    severity,
    message,
    recommended_next_action: recommendedNextAction
  };
}

function nodeGap(
  code: KnowledgeGapCode,
  severity: KnowledgeGapSeverity,
  node: TestCaseIRNode,
  message: string,
  recommendedNextAction: string
): KnowledgeGap {
  return {
    ...gap(code, severity, message, recommendedNextAction),
    source_type: node.source_type,
    source_index: node.source_index,
    source_text: node.source_text
  };
}

function dedupeGaps(gaps: KnowledgeGap[]): KnowledgeGap[] {
  const seen = new Set<string>();
  const deduped: KnowledgeGap[] = [];

  for (const gapItem of gaps) {
    const key = [
      gapItem.code,
      gapItem.severity,
      gapItem.source_type ?? "",
      gapItem.source_index ?? "",
      gapItem.message
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(gapItem);
  }

  return deduped;
}

function firstNextAction(gaps: KnowledgeGap[]): string {
  const blocker = gaps.find((gapItem) => gapItem.severity === "blocker");
  const warning = gaps.find((gapItem) => gapItem.severity === "warning");
  return blocker?.recommended_next_action ?? warning?.recommended_next_action ?? "Ready for recipe/execution review.";
}

function labelGapCode(code: KnowledgeGapCode): string {
  return code
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapePipe(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
