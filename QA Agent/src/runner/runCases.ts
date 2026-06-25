import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { missingAdminEnv, type RuntimeConfig } from "../runtime/config.js";
import type { CaseResult, ExecutionMemory, NormalizedCase, RunReport } from "../types.js";
import { caseExecutionId } from "../core/runIdentity.js";
import { formatMarkdownReport, summarize } from "../reporting/formatReport.js";
import { executeR6MasterCampaignCase } from "../executors/r6MasterCampaign.js";
import { buildNotExecutedTrace } from "../traceability/caseTraceability.js";
import {
  closeAdminPage,
  openAdminPage,
  QaBlockedError,
  type AdminPageSession
} from "../playwright/adminSession.js";

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
  const sharedAdminSession = await openSharedAdminSession(cases, config);

  try {
    for (const testCase of cases) {
      results.push(
        await runSingleCase(testCase, config, runDir, memory, sharedAdminSession, runId)
      );
    }
  } finally {
    if (sharedAdminSession.session) {
      await closeAdminPage(sharedAdminSession.session);
    }
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
  memory: ExecutionMemory,
  sharedAdminSession: SharedAdminSession,
  runId: string
): Promise<CaseResult> {
  if (testCase.site === "admin") {
    const missing = missingAdminEnv(config);

    if (missing.length > 0) {
      return {
        run_id: runId,
        case_execution_id: caseExecutionId(runId, testCase.stable_id),
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

    if (sharedAdminSession.error) {
      return sessionBlockedResult(testCase, sharedAdminSession.error, runId);
    }
  }

  const r6Result = await executeR6MasterCampaignCase(testCase, config, runDir, memory, runId, {
    adminSession: sharedAdminSession.session
  });
  if (r6Result) {
    return r6Result;
  }

  return {
    run_id: runId,
    case_execution_id: caseExecutionId(runId, testCase.stable_id),
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

interface SharedAdminSession {
  session?: AdminPageSession;
  error?: unknown;
}

async function openSharedAdminSession(
  cases: NormalizedCase[],
  config: RuntimeConfig
): Promise<SharedAdminSession> {
  const shouldOpenAdminSession =
    cases.some((testCase) => testCase.site === "admin") && missingAdminEnv(config).length === 0;

  if (!shouldOpenAdminSession) {
    return {};
  }

  try {
    return { session: await openAdminPage(config) };
  } catch (error) {
    return { error };
  }
}

function sessionBlockedResult(
  testCase: NormalizedCase,
  error: unknown,
  runId: string
): CaseResult {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof QaBlockedError ? error.status : "SCRIPT_BLOCKED";

  return {
    run_id: runId,
    case_execution_id: caseExecutionId(runId, testCase.stable_id),
    stable_id: testCase.stable_id,
    title: testCase.title,
    status,
    precondition_result:
      status === "ENV_BLOCKED"
        ? "Environment/authentication blocked the shared Admin browser session."
        : "The shared Admin browser session could not be opened before case execution.",
    actual_result: "No browser actions were executed for this case.",
    expected_result: testCase.expected_result,
    failure_reason: message,
    created_test_data: [],
    depends_on_data: [],
    traceability: buildNotExecutedTrace(
      testCase,
      "Shared Admin browser session setup blocked execution before browser actions."
    ),
    notes: [
      status === "ENV_BLOCKED"
        ? "Treat this as environment/auth setup work, not a Gro product bug."
        : "Treat this as shared session setup work until browser startup is stable."
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
