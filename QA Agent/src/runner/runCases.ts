import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { missingAdminEnv, type RuntimeConfig } from "../runtime/config.js";
import type { CaseResult, ExecutionMemory, NormalizedCase, RunReport } from "../types.js";
import { formatMarkdownReport, summarize } from "../reporting/formatReport.js";
import { executeR6MasterCampaignCase } from "../executors/r6MasterCampaign.js";
import { buildNotExecutedTrace } from "../traceability/caseTraceability.js";

export async function runCases(
  release: string,
  cases: NormalizedCase[],
  config: RuntimeConfig
): Promise<{ report: RunReport; jsonPath: string; markdownPath: string }> {
  const runId = createRunId(release);
  const startedAt = new Date().toISOString();
  const runDir = path.join(config.evidenceDir, runId);

  await mkdir(runDir, { recursive: true });

  const results: CaseResult[] = [];
  const memory: ExecutionMemory = {};
  for (const testCase of cases) {
    results.push(await runSingleCase(testCase, config, runDir, memory));
  }

  const finishedAt = new Date().toISOString();
  const report: RunReport = {
    run_id: runId,
    release,
    started_at: startedAt,
    finished_at: finishedAt,
    case_results: results,
    created_test_data: collectCreatedTestData(results),
    summary: summarize(results)
  };

  const jsonPath = path.join(runDir, "report.json");
  const markdownPath = path.join(runDir, "report.md");

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, formatMarkdownReport(report), "utf8");

  return { report, jsonPath, markdownPath };
}

async function runSingleCase(
  testCase: NormalizedCase,
  config: RuntimeConfig,
  runDir: string,
  memory: ExecutionMemory
): Promise<CaseResult> {
  if (testCase.site === "admin") {
    const missing = missingAdminEnv(config);

    if (missing.length > 0) {
      return {
        stable_id: testCase.stable_id,
        title: testCase.title,
        status: "ENV_BLOCKED",
        precondition_result: "Not checked because Admin Site environment is not configured.",
        actual_result: "The agent did not open staging.",
        expected_result: testCase.expected_result,
        failure_reason: `Missing required environment variable(s): ${missing.join(", ")}.`,
        created_test_data: [],
        depends_on_data: [],
        traceability: buildNotExecutedTrace(
          testCase,
          "Environment/authentication configuration blocked execution before browser actions."
        ),
        notes: [
          "Fill .env from .env.example before running browser execution.",
          "This is an environment/setup block, not a product bug."
        ]
      };
    }
  }

  const r6Result = await executeR6MasterCampaignCase(testCase, config, runDir, memory);
  if (r6Result) {
    return r6Result;
  }

  return {
    stable_id: testCase.stable_id,
    title: testCase.title,
    status: "SCRIPT_BLOCKED",
    precondition_result: "Environment is configured, but no Playwright executor has been implemented for this case yet.",
    actual_result: "No browser actions were executed.",
    expected_result: testCase.expected_result,
    failure_reason: `Missing case executor for ${testCase.stable_id}.`,
    created_test_data: [],
    depends_on_data: [],
    traceability: buildNotExecutedTrace(
      testCase,
      `No Playwright executor has been implemented for ${testCase.stable_id}.`
    ),
    notes: [
      "Next step: implement selectors and browser actions for this stable case id.",
      "Do not mark this as a Gro product bug."
    ]
  };
}

function collectCreatedTestData(results: CaseResult[]) {
  const byId = new Map<string, CaseResult["created_test_data"][number]>();

  for (const result of results) {
    for (const data of result.created_test_data) {
      byId.set(data.data_id, data);
    }
  }

  return Array.from(byId.values());
}

function createRunId(release: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${release}-${timestamp}`;
}
