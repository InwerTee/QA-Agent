import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AGENT_BUILD_LABEL, AGENT_VERSION } from "../runtime/agentVersion.js";
import {
  runInputPackage,
  type RunPackageProgress,
  type RunPackageResult
} from "../pipeline/runPackage.js";

const DEFAULT_PORT = 4173;
const MAX_BODY_BYTES = 80 * 1024 * 1024;

interface UploadedFilePayload {
  name: string;
  contentType?: string;
  dataBase64: string;
}

interface RunRequestPayload {
  runLabel?: string;
  release?: string;
  prd: UploadedFilePayload;
  testCases: UploadedFilePayload;
}

interface WebRunRecord {
  runId: string;
  resultFolder: string;
  filledWorkbookPath: string;
  reportMarkdownPath: string;
  resultMappingPath: string;
}

interface JsonResponse {
  status: "done";
  runId: string;
  release: string;
  agentVersion: string;
  selectedCases: string[];
  summary: RunPackageResult["report"]["summary"];
  executionReadiness?: RunPackageResult["report"]["execution_readiness"];
  failureAnalysis?: RunPackageResult["report"]["failure_analysis"];
  files: {
    filledWorkbook: string;
    reportMarkdown: string;
    resultMapping: string;
    resultFolder: string;
  };
  downloads: {
    filledExcel: string;
    reportMarkdown: string;
    resultMapping: string;
  };
  actions: {
    openResultFolder: string;
  };
}

interface WebRunJob {
  jobId: string;
  status: "running" | "done" | "error";
  createdAt: string;
  updatedAt: string;
  message: string;
  progress?: RunPackageProgress;
  result?: JsonResponse;
  error?: string;
}

interface JobStatusResponse {
  status: "running" | "done" | "error";
  jobId: string;
  createdAt: string;
  updatedAt: string;
  message: string;
  progress?: RunPackageProgress;
  result?: JsonResponse;
  error?: string;
}

let activeRun = false;

export function createWebServer(): Server {
  const records = new Map<string, WebRunRecord>();
  const jobs = new Map<string, WebRunJob>();

  return createServer(async (request, response) => {
    try {
      await routeRequest(request, response, records, jobs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: message });
    }
  });
}

export async function startWebServer(port = readPort()): Promise<Server> {
  const server = createWebServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const url = `http://127.0.0.1:${port}`;
  console.log(`QA Agent local runner: ${url}`);

  if (process.env.QA_WEB_OPEN !== "false") {
    openLocalTarget(url).catch(() => undefined);
  }

  return server;
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  records: Map<string, WebRunRecord>,
  jobs: Map<string, WebRunJob>
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (method === "GET" && url.pathname === "/") {
    await serveIndex(response);
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/version") {
    sendJson(response, 200, {
      agentVersion: AGENT_BUILD_LABEL,
      version: AGENT_VERSION
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/run") {
    await handleRun(request, response, records, jobs);
    return;
  }

  const statusMatch = url.pathname.match(/^\/api\/run-status\/([^/]+)$/);
  if (method === "GET" && statusMatch) {
    handleRunStatus(response, jobs, statusMatch[1]);
    return;
  }

  const downloadMatch = url.pathname.match(/^\/api\/download\/([^/]+)\/([^/]+)$/);
  if (method === "GET" && downloadMatch) {
    await handleDownload(response, records, downloadMatch[1], downloadMatch[2]);
    return;
  }

  const openFolderMatch = url.pathname.match(/^\/api\/open-folder\/([^/]+)$/);
  if (method === "POST" && openFolderMatch) {
    await handleOpenFolder(response, records, openFolderMatch[1]);
    return;
  }

  sendJson(response, 404, { error: "Not found." });
}

async function handleRun(
  request: IncomingMessage,
  response: ServerResponse,
  records: Map<string, WebRunRecord>,
  jobs: Map<string, WebRunJob>
): Promise<void> {
  if (activeRun) {
    sendJson(response, 409, { error: "Another QA Agent run is already in progress." });
    return;
  }

  let payload: RunRequestPayload;
  try {
    payload = validateRunPayload(await readJsonBody<RunRequestPayload>(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 400, { error: message });
    return;
  }

  activeRun = true;

  try {
    const inputDir = await writeInputPackage(payload);
    const now = new Date().toISOString();
    const job: WebRunJob = {
      jobId: randomUUID(),
      status: "running",
      createdAt: now,
      updatedAt: now,
      message: "Run accepted. Preparing uploaded files."
    };

    jobs.set(job.jobId, job);
    void executeWebRun(job, inputDir, records);

    sendJson(response, 202, buildJobStatusResponse(job));
  } catch (error) {
    activeRun = false;
    throw error;
  }
}

function handleRunStatus(
  response: ServerResponse,
  jobs: Map<string, WebRunJob>,
  jobId: string
): void {
  const job = jobs.get(jobId);
  if (!job) {
    sendJson(response, 404, { error: "Run job not found in this local server session." });
    return;
  }

  sendJson(response, 200, buildJobStatusResponse(job));
}

async function executeWebRun(
  job: WebRunJob,
  inputDir: string,
  records: Map<string, WebRunRecord>
): Promise<void> {
  try {
    const result = await runInputPackage(inputDir, {
      outDir: path.join(inputDir, "generated-inputs"),
      onProgress: (progress) => updateJobProgress(job, progress)
    });
    const record = registerRun(records, result);
    job.status = "done";
    job.result = buildRunResponse(result, record);
    job.message = `Run ${record.runId} completed.`;
    job.updatedAt = new Date().toISOString();
  } catch (error) {
    job.status = "error";
    job.error = error instanceof Error ? error.message : String(error);
    job.message = "QA Agent run failed.";
    job.updatedAt = new Date().toISOString();
  } finally {
    activeRun = false;
  }
}

function updateJobProgress(job: WebRunJob, progress: RunPackageProgress): void {
  job.progress = progress;
  job.message = progress.message;
  job.updatedAt = new Date().toISOString();
}

async function handleDownload(
  response: ServerResponse,
  records: Map<string, WebRunRecord>,
  runId: string,
  kind: string
): Promise<void> {
  const record = records.get(runId);
  if (!record) {
    sendJson(response, 404, { error: "Run not found in this local server session." });
    return;
  }

  const filePath = filePathForDownload(record, kind);
  if (!filePath) {
    sendJson(response, 404, { error: "Download kind not found." });
    return;
  }

  const fileName = path.basename(filePath);
  response.writeHead(200, {
    "Content-Type": contentTypeFor(fileName),
    "Content-Disposition": `attachment; filename="${fileName.replaceAll("\"", "")}"`
  });
  createReadStream(filePath).pipe(response);
}

async function handleOpenFolder(
  response: ServerResponse,
  records: Map<string, WebRunRecord>,
  runId: string
): Promise<void> {
  const record = records.get(runId);
  if (!record) {
    sendJson(response, 404, { error: "Run not found in this local server session." });
    return;
  }

  await openLocalTarget(record.resultFolder);
  sendJson(response, 200, { ok: true, path: record.resultFolder });
}

function registerRun(records: Map<string, WebRunRecord>, result: RunPackageResult): WebRunRecord {
  const runId = result.report.run_id;
  const resultFolder = path.dirname(path.resolve(result.reportJsonPath));
  const record: WebRunRecord = {
    runId,
    resultFolder,
    filledWorkbookPath: path.resolve(result.filledWorkbookPath),
    reportMarkdownPath: path.resolve(result.reportMarkdownPath),
    resultMappingPath: path.resolve(result.resultMappingPath)
  };
  records.set(runId, record);
  return record;
}

function buildRunResponse(result: RunPackageResult, record: WebRunRecord): JsonResponse {
  return {
    status: "done",
    runId: record.runId,
    release: result.release,
    agentVersion: result.report.agent_version,
    selectedCases: result.selectedCaseIds,
    summary: result.report.summary,
    executionReadiness: result.report.execution_readiness,
    failureAnalysis: result.report.failure_analysis,
    files: {
      filledWorkbook: record.filledWorkbookPath,
      reportMarkdown: record.reportMarkdownPath,
      resultMapping: record.resultMappingPath,
      resultFolder: record.resultFolder
    },
    downloads: {
      filledExcel: `/api/download/${encodeURIComponent(record.runId)}/filled-excel`,
      reportMarkdown: `/api/download/${encodeURIComponent(record.runId)}/report-md`,
      resultMapping: `/api/download/${encodeURIComponent(record.runId)}/mapping-json`
    },
    actions: {
      openResultFolder: `/api/open-folder/${encodeURIComponent(record.runId)}`
    }
  };
}

function buildJobStatusResponse(job: WebRunJob): JobStatusResponse {
  return {
    status: job.status,
    jobId: job.jobId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    message: job.message,
    progress: job.progress,
    result: job.result,
    error: job.error
  };
}

async function serveIndex(response: ServerResponse): Promise<void> {
  const htmlPath = path.resolve("src/web/static/index.html");
  const html = await readFile(htmlPath, "utf8");
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Upload payload is too large.");
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

export function validateRunPayload(payload: RunRequestPayload): RunRequestPayload {
  const runLabel = (payload.runLabel ?? payload.release ?? "").trim();

  validateUploadedFile(payload.prd, "prd", /\.pdf$/i, "PRD must be a PDF file.");
  validateUploadedFile(payload.testCases, "testCases", /\.xlsx$/i, "Test cases must be an .xlsx file.");

  return {
    runLabel: runLabel || undefined,
    prd: payload.prd,
    testCases: payload.testCases
  };
}

function validateUploadedFile(
  file: UploadedFilePayload,
  fieldName: string,
  extension: RegExp,
  message: string
): void {
  if (!file || typeof file.name !== "string" || typeof file.dataBase64 !== "string") {
    throw new Error(`${fieldName} file is required.`);
  }

  if (!extension.test(file.name)) {
    throw new Error(message);
  }

  if (file.dataBase64.length === 0) {
    throw new Error(`${fieldName} file is empty.`);
  }
}

async function writeInputPackage(payload: RunRequestPayload): Promise<string> {
  const label = sanitizeFilePart(payload.runLabel ?? "run") || "run";
  const id = `web-${label}-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const inputDir = path.resolve("input-packages", id);

  await mkdir(inputDir, { recursive: true });
  await writeFile(path.join(inputDir, sanitizeUploadName(payload.prd.name, "prd.pdf")), Buffer.from(payload.prd.dataBase64, "base64"));
  await writeFile(
    path.join(inputDir, sanitizeUploadName(payload.testCases.name, "test-cases.xlsx")),
    Buffer.from(payload.testCases.dataBase64, "base64")
  );

  return inputDir;
}

function filePathForDownload(record: WebRunRecord, kind: string): string | undefined {
  if (kind === "filled-excel") return record.filledWorkbookPath;
  if (kind === "report-md") return record.reportMarkdownPath;
  if (kind === "mapping-json") return record.resultMappingPath;
  return undefined;
}

function contentTypeFor(fileName: string): string {
  if (/\.xlsx$/i.test(fileName)) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (/\.json$/i.test(fileName)) return "application/json";
  if (/\.md$/i.test(fileName)) return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

async function openLocalTarget(target: string): Promise<void> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sanitizeUploadName(fileName: string, fallback: string): string {
  const safe = sanitizeFilePart(path.basename(fileName));
  return safe || fallback;
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_");
}

function readPort(): number {
  const raw = process.env.QA_WEB_PORT;
  if (!raw) return DEFAULT_PORT;

  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  startWebServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
