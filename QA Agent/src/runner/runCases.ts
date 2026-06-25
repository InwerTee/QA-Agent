import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { missingAdminEnv, type RuntimeConfig } from "../runtime/config.js";
import type { CaseResult, ExecutionMemory, NormalizedCase, QaStatus, RunReport } from "../types.js";
import { caseExecutionId } from "../core/runIdentity.js";
import { formatMarkdownReport, summarize } from "../reporting/formatReport.js";
import { executeR6MasterCampaignCase } from "../executors/r6MasterCampaign.js";
import { runDynamicCase } from "../dynamic/dynamicCaseRunner.js";
import { buildNotExecutedTrace } from "../traceability/caseTraceability.js";
import {
  closeAdminPage,
  openAdminPage,
  QaBlockedError,
  type AdminPageSession
} from "../playwright/adminSession.js";

export interface RunCasesProgress {
  stage: "started" | "case_started" | "case_completed" | "completed";
  runId: string;
  release: string;
  total: number;
  completed: number;
  currentCase?: ProgressCase;
  completedCase?: ProgressCase & { status: QaStatus };
  summary: Record<QaStatus, number>;
  message: string;
}

export interface ProgressCase {
  stable_id: string;
  title: string;
  index: number;
}

export interface RunCasesOptions {
  onProgress?: (progress: RunCasesProgress) => void;
  caseTimeoutMs?: number;
}

export async function runCases(
  release: string,
  cases: NormalizedCase[],
  config: RuntimeConfig,
  options: RunCasesOptions = {}
): Promise<{ report: RunReport; jsonPath: string; markdownPath: string }> {
  const runId = createRunId(release);
  const startedAt = new Date().toISOString();
  const runDir = path.join(config.evidenceDir, runId);

  await mkdir(runDir, { recursive: true });

  const results: CaseResult[] = [];
  const memory: ExecutionMemory = {};
  const sharedAdminSession = await openSharedAdminSession(cases, config);
  const emitProgress = (progress: Omit<RunCasesProgress, "runId" | "release" | "total" | "summary">) => {
    options.onProgress?.({
      runId,
      release,
      total: cases.length,
      summary: summarize(results),
      ...progress
    });
  };

  emitProgress({
    stage: "started",
    completed: 0,
    message: `Starting ${cases.length} case(s).`
  });

  try {
    for (const [index, testCase] of cases.entries()) {
      const progressCase = toProgressCase(testCase, index);
      emitProgress({
        stage: "case_started",
        completed: results.length,
        currentCase: progressCase,
        message: `Running ${testCase.stable_id}.`
      });

      const { result, timedOut } = await runSingleCaseWithTimeout(
        testCase,
        config,
        runDir,
        memory,
        sharedAdminSession,
        runId,
        options.caseTimeoutMs ?? config.caseTimeoutMs
      );
      results.push(result);

      if (timedOut && sharedAdminSession.session) {
        await closeAdminPage(sharedAdminSession.session);
        sharedAdminSession.session = undefined;
        sharedAdminSession.error = new QaBlockedError(
          "SCRIPT_BLOCKED",
          `The shared Admin browser session was closed after ${testCase.stable_id} exceeded the case timeout.`
        );
      }

      emitProgress({
        stage: "case_completed",
        completed: results.length,
        completedCase: {
          ...progressCase,
          status: result.status
        },
        message: `Completed ${testCase.stable_id}: ${result.status}.`
      });
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

  emitProgress({
    stage: "completed",
    completed: results.length,
    message: `Completed ${results.length}/${cases.length} case(s).`
  });

  return { report, jsonPath, markdownPath };
}

async function runSingleCaseWithTimeout(
  testCase: NormalizedCase,
  config: RuntimeConfig,
  runDir: string,
  memory: ExecutionMemory,
  sharedAdminSession: SharedAdminSession,
  runId: string,
  timeoutMs: number
): Promise<{ result: CaseResult; timedOut: boolean }> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      result: await runSingleCase(testCase, config, runDir, memory, sharedAdminSession, runId),
      timedOut: false
    };
  }

  let timeout: NodeJS.Timeout | undefined;
  let timedOut = false;
  const casePromise = runSingleCase(testCase, config, runDir, memory, sharedAdminSession, runId);
  const timeoutPromise = new Promise<CaseResult>((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true;
      resolve(caseTimeoutResult(testCase, runId, timeoutMs));
    }, timeoutMs);
  });

  const result = await Promise.race([casePromise, timeoutPromise]);

  if (timeout) {
    clearTimeout(timeout);
  }

  if (timedOut) {
    casePromise.catch(() => undefined);
  }

  return { result, timedOut };
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

  return runDynamicCase(testCase, config, runDir, runId, {
    adminSession: sharedAdminSession.session
  });
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

function caseTimeoutResult(
  testCase: NormalizedCase,
  runId: string,
  timeoutMs: number
): CaseResult {
  const seconds = Math.round(timeoutMs / 1000);

  return {
    run_id: runId,
    case_execution_id: caseExecutionId(runId, testCase.stable_id),
    stable_id: testCase.stable_id,
    title: testCase.title,
    status: "AGENT_BLOCKED",
    precondition_result: "The case exceeded the configured execution timeout.",
    actual_result: `The agent stopped this case after ${seconds} seconds to keep the run from hanging.`,
    expected_result: testCase.expected_result,
    failure_reason: `Case timeout exceeded (${seconds}s).`,
    created_test_data: [],
    depends_on_data: [],
    traceability: buildNotExecutedTrace(
      testCase,
      `Execution stopped because QA_CASE_TIMEOUT_MS was reached (${timeoutMs} ms).`
    ),
    notes: [
      "This timeout is an agent/runtime guard, not a Gro product result.",
      "Increase QA_CASE_TIMEOUT_MS if this case legitimately needs more time."
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

function toProgressCase(testCase: NormalizedCase, index: number): ProgressCase {
  return {
    stable_id: testCase.stable_id,
    title: testCase.title,
    index: index + 1
  };
}
