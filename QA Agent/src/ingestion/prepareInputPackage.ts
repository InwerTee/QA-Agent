import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readXlsxFile from "read-excel-file/node";
import type { CellValue, Row, Sheet } from "read-excel-file/node";
import type { AutomationStatus, CaseDependency, NormalizedCase, Site } from "../types.js";
import { inferModuleNameFromText } from "../understanding/caseUnderstanding.js";

interface PrepareOptions {
  release?: string;
  outDir?: string;
}

export interface PrepareResult {
  release: string;
  title: string;
  inputDir: string;
  outDir: string;
  manifestPath: string;
  casesPath: string;
  reportPath: string;
  caseCount: number;
  sheet: string;
  headerRow: number;
  automationSummary: Record<AutomationStatus, number>;
}

interface InputFiles {
  workbookPath: string;
  prdPath?: string;
}

interface HeaderMap {
  no: number;
  scenario?: number;
  testCase: number;
  precondition: number;
  steps: StepColumn[];
  expected: number;
  type?: number;
  status?: number;
  evidence?: number;
  note?: number;
}

interface StepColumn {
  index: number;
  label: string;
}

interface ParsedWorkbook {
  sheet: string;
  rows: Row[];
  headerRowIndex: number;
  headerMap: HeaderMap;
  metadata: Record<string, string>;
}

const HEADER_ALIASES: Record<keyof HeaderMap, string[]> = {
  no: ["no", "number", "id", "case id", "test case id"],
  scenario: ["scenario"],
  testCase: ["testcase", "test case"],
  precondition: ["prerequisite", "pre requisite", "precondition", "pre condition"],
  steps: ["teststeps", "test steps", "steps"],
  expected: ["expectedresult", "expected result", "expected"],
  type: ["type"],
  status: ["status"],
  evidence: ["evidence", "result", "actual result", "jam", "jam link"],
  note: ["note", "notes", "bugs detail", "bug detail", "bugs"]
};

export async function prepareInputPackage(
  inputDir: string,
  options: PrepareOptions = {}
): Promise<PrepareResult> {
  const absoluteInputDir = path.resolve(inputDir);
  const files = await findInputFiles(absoluteInputDir);
  const workbook = await parseWorkbook(files.workbookPath);
  const release =
    options.release ??
    inferRelease(workbook.metadata, [
      path.basename(files.workbookPath, path.extname(files.workbookPath)),
      path.basename(inputDir)
    ]);
  const title = inferTitle(workbook.metadata, release);
  const cases = parseCases(workbook, release, files.workbookPath);
  const outDir = path.resolve(options.outDir ?? path.join("inputs", release));

  await mkdir(outDir, { recursive: true });

  const manifest = buildManifest({
    release,
    title,
    inputDir: absoluteInputDir,
    outDir,
    files,
    workbook,
    cases
  });
  const report = formatIngestionReport({
    release,
    title,
    inputDir: absoluteInputDir,
    files,
    workbook,
    cases
  });

  const manifestPath = path.join(outDir, "manifest.json");
  const casesPath = path.join(outDir, "cases.normalized.json");
  const reportPath = path.join(outDir, "ingestion_report.md");

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(casesPath, `${JSON.stringify(cases, null, 2)}\n`);
  await writeFile(reportPath, report);

  return {
    release,
    title,
    inputDir: absoluteInputDir,
    outDir,
    manifestPath,
    casesPath,
    reportPath,
    caseCount: cases.length,
    sheet: workbook.sheet,
    headerRow: workbook.headerRowIndex + 1,
    automationSummary: summarizeAutomation(cases)
  };
}

async function findInputFiles(inputDir: string): Promise<InputFiles> {
  const entries = await readdir(inputDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => !isTemporaryInputFile(entry.name))
    .map((entry) => path.join(inputDir, entry.name));
  const workbookPath = files.find((file) => /\.xlsx$/i.test(file));

  if (!workbookPath) {
    throw new Error(`No .xlsx test case workbook found in ${inputDir}`);
  }

  return {
    workbookPath,
    prdPath: files.find((file) => /\.(pdf|docx|md|txt)$/i.test(file))
  };
}

function isTemporaryInputFile(fileName: string): boolean {
  return fileName.startsWith(".") || fileName.startsWith("~$") || fileName.startsWith(".~");
}

async function parseWorkbook(workbookPath: string): Promise<ParsedWorkbook> {
  const sheets = (await readXlsxFile(workbookPath)) as Sheet[];
  const candidate = sheets
    .map((sheet) => {
      const header = findHeader(sheet.data);
      return { sheet, header };
    })
    .filter((item): item is { sheet: Sheet; header: HeaderCandidate } => Boolean(item.header))
    .sort((a, b) => b.sheet.data.length - a.sheet.data.length)[0];

  if (!candidate) {
    throw new Error(`Could not find a recognizable test case header row in ${workbookPath}`);
  }

  return {
    sheet: candidate.sheet.sheet,
    rows: candidate.sheet.data,
    headerRowIndex: candidate.header.headerRowIndex,
    headerMap: candidate.header.headerMap,
    metadata: extractMetadata(candidate.sheet.data, candidate.header.headerRowIndex)
  };
}

function parseCases(
  workbook: ParsedWorkbook,
  release: string,
  workbookPath: string
): NormalizedCase[] {
  const cases: NormalizedCase[] = [];
  let currentGroup = "Ungrouped";
  let currentGroupCode = "G0";
  const groupCodes = new Map<string, string>();
  const caseCountByGroupCode = new Map<string, number>();
  let generatedGroupCount = 0;

  for (let index = workbook.headerRowIndex + 1; index < workbook.rows.length; index += 1) {
    const row = workbook.rows[index];
    const groupName = extractGroupName(row);

    if (groupName) {
      currentGroup = groupName;
      const existing = groupCodes.get(groupName);
      if (existing) {
        currentGroupCode = existing;
      } else {
        generatedGroupCount += 1;
        currentGroupCode = extractGroupCode(groupName, generatedGroupCount);
        groupCodes.set(groupName, currentGroupCode);
      }
      continue;
    }

    const title = cellToString(row[workbook.headerMap.testCase]);

    if (!title) {
      continue;
    }

    const parsedCaseNo = toCaseNo(row[workbook.headerMap.no]);
    const inlineGroupName = parsedCaseNo === undefined
      ? extractInlineGroupName(row, workbook.headerMap)
      : undefined;
    if (inlineGroupName) {
      currentGroup = inlineGroupName;
      const existing = groupCodes.get(inlineGroupName);
      if (existing) {
        currentGroupCode = existing;
      } else {
        generatedGroupCount += 1;
        currentGroupCode = extractGroupCode(inlineGroupName, generatedGroupCount);
        groupCodes.set(inlineGroupName, currentGroupCode);
      }
    }

    const generatedCaseNo = (caseCountByGroupCode.get(currentGroupCode) ?? 0) + 1;
    const caseNo = parsedCaseNo ?? generatedCaseNo;
    caseCountByGroupCode.set(currentGroupCode, Math.max(generatedCaseNo, caseNo));

    const stableId = `${release}-${currentGroupCode}-TC${String(caseNo).padStart(2, "0")}`;
    const scenario = inferScenario(row, workbook.headerMap, currentGroup);
    const rawPrecondition = readPrecondition(row, workbook.headerMap);
    const precondition = normalizeText(rawPrecondition);
    const rawSteps = readStepText(row, workbook.headerMap);
    const rawExpected = cellToString(row[workbook.headerMap.expected]);
    const steps = splitSteps(row, workbook.headerMap);
    const expectedResult = splitList(cellToString(row[workbook.headerMap.expected]));
    const rawType = getOptionalCell(row, workbook.headerMap.type) ?? "";
    const sourceNote = getOptionalCell(row, workbook.headerMap.note);
    const dependencies = inferDependencies(stableId, currentGroupCode, precondition, title, release);

    cases.push({
      stable_id: stableId,
      release,
      sheet: workbook.sheet,
      source_row: index + 1,
      scenario_group: currentGroup,
      case_no: caseNo,
      scenario,
      title,
      site: inferSite(`${currentGroup} ${scenario} ${title} ${precondition}`),
      module: inferModule(`${currentGroup} ${scenario} ${title} ${precondition} ${rawSteps} ${rawExpected}`),
      type: rawType || "Unspecified",
      intent: inferIntent(scenario, title),
      precondition,
      steps,
      expected_result: expectedResult,
      dependencies,
      automation_status: inferAutomationStatus(stableId, steps, expectedResult, precondition),
      source: {
        workbook: relativePath(workbookPath),
        historical_status: getOptionalCell(row, workbook.headerMap.status),
        historical_evidence: getOptionalCell(row, workbook.headerMap.evidence),
        historical_note: sourceNote || undefined
      },
      raw_source: {
        scenario,
        test_case: title,
        pre_requisite: rawPrecondition,
        test_steps: rawSteps,
        expected_result: rawExpected,
        type: rawType,
        status: getOptionalCell(row, workbook.headerMap.status),
        evidence: getOptionalCell(row, workbook.headerMap.evidence),
        note: sourceNote || undefined
      }
    });
  }

  return cases;
}

interface HeaderCandidate {
  headerRowIndex: number;
  headerMap: HeaderMap;
}

function findHeader(rows: Row[]): HeaderCandidate | undefined {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const headerMap = buildHeaderMap(rows[rowIndex], rows[rowIndex + 1]);
    if (headerMap) {
      return { headerRowIndex: rowIndex, headerMap };
    }
  }

  return undefined;
}

function buildHeaderMap(row: Row, subHeaderRow?: Row): HeaderMap | undefined {
  const getIndex = (key: keyof HeaderMap): number | undefined => {
    const aliases = HEADER_ALIASES[key].map(normalizeKey);
    const index = row.findIndex((cell) => aliases.includes(normalizeKey(cellToString(cell))));
    return index >= 0 ? index : undefined;
  };
  const getExactIndex = (aliases: string[]): number | undefined => {
    const normalizedAliases = aliases.map(normalizeKey);
    const index = row.findIndex((cell) =>
      normalizedAliases.includes(normalizeKey(cellToString(cell)))
    );
    return index >= 0 ? index : undefined;
  };

  const no = getIndex("no");
  const testCase = getIndex("testCase");
  const combinedPreconditionSteps = getExactIndex([
    "pre requisite & test steps",
    "pre-requisite & test steps",
    "pre requisite and test steps",
    "precondition & test steps",
    "preconditions & test steps",
    "preconditions and test steps"
  ]);
  const precondition = getIndex("precondition") ?? combinedPreconditionSteps;
  const stepsStart = getIndex("steps") ?? combinedPreconditionSteps;
  const expected = getIndex("expected");

  if (
    no === undefined ||
    testCase === undefined ||
    precondition === undefined ||
    stepsStart === undefined ||
    expected === undefined
  ) {
    return undefined;
  }

  const steps = buildStepColumns(row, subHeaderRow, stepsStart, expected);
  if (steps.length === 0) return undefined;

  const map: HeaderMap = {
    no,
    scenario: getIndex("scenario"),
    testCase,
    precondition,
    steps,
    expected,
    type: getIndex("type"),
    status: getIndex("status"),
    evidence: getExactIndex(["evidence", "jam", "jam link"]) ?? getIndex("evidence"),
    note: getIndex("note")
  };

  return map;
}

function buildStepColumns(
  row: Row,
  subHeaderRow: Row | undefined,
  stepsStart: number,
  expectedIndex: number
): StepColumn[] {
  const subHeaderKeys = (subHeaderRow ?? []).map((cell) => normalizeKey(cellToString(cell)));
  const hasStepSubHeaders = subHeaderKeys.some((key) =>
    ["what", "when", "where", "why", "who", "how"].includes(key)
  );

  if (!hasStepSubHeaders || expectedIndex <= stepsStart) {
    return [
      {
        index: stepsStart,
        label: cellToString(row[stepsStart]) || "Test Steps"
      }
    ];
  }

  const columns: StepColumn[] = [];
  for (let index = stepsStart; index < expectedIndex; index += 1) {
    const label =
      cellToString(subHeaderRow?.[index]) ||
      cellToString(row[index]) ||
      (index === stepsStart ? "Test Steps" : `Step ${index - stepsStart + 1}`);
    columns.push({ index, label });
  }

  return columns;
}

function extractMetadata(rows: Row[], headerRowIndex: number): Record<string, string> {
  const metadata: Record<string, string> = {};

  for (const row of rows.slice(0, headerRowIndex)) {
    for (let index = 0; index < row.length - 1; index += 1) {
      const key = cellToString(row[index]);
      const value = cellToString(row[index + 1]);
      if (!key || !value) continue;

      const normalized = normalizeKey(key);
      if (
        [
          "requirementname",
          "description",
          "release",
          "businessowner",
          "businessusers",
          "server",
          "prdlink",
          "totaltestcase",
          "totalscenario"
        ].includes(normalized)
      ) {
        metadata[normalized] = value;
      }
    }
  }

  return metadata;
}

function extractGroupName(row: Row): string | undefined {
  const nonEmpty = row.map(cellToString).filter(Boolean);
  if (nonEmpty.length !== 1) return undefined;

  const [value] = nonEmpty;
  if (/^(id|no|test case|scenario|prerequisite|test steps|expected result)$/i.test(value)) {
    return undefined;
  }
  if (/^\d+$/i.test(value)) return undefined;
  return value;
}

function extractInlineGroupName(row: Row, headerMap: HeaderMap): string | undefined {
  if (headerMap.scenario === undefined) return undefined;

  const value = cellToString(row[headerMap.scenario]);
  if (!value) return undefined;

  const normalized = normalizeKey(value);
  if (["scenario", "testcase", "testcase"].includes(normalized)) return undefined;
  return value;
}

function extractGroupCode(groupName: string, fallbackIndex: number): string {
  const match = groupName.match(/^B\d+(?:\.\d+)?/i);
  return match ? match[0].toUpperCase() : `G${fallbackIndex}`;
}

export function inferRelease(metadata: Record<string, string>, fallbacks: string[]): string {
  const text = `${metadata.release ?? ""} ${metadata.requirementname ?? ""} ${fallbacks.join(" ")}`;
  const matches = [...text.matchAll(/\bR\d+(?:\.\d+)?\b/gi)].map((match) => match[0]);
  const [bestMatch] = matches.sort((a, b) => b.length - a.length);
  return bestMatch ? bestMatch.toUpperCase() : fallbacks[0].replace(/\W+/g, "-");
}

function inferTitle(metadata: Record<string, string>, release: string): string {
  const raw = metadata.requirementname ?? metadata.release ?? release;
  return normalizeText(raw.replace(new RegExp(`^${release}\\s*[–-]?\\s*`, "i"), ""));
}

function inferModule(text: string): string {
  return inferModuleNameFromText(text);
}

function inferSite(text: string): Site {
  if (/creator site|creator portal/i.test(text)) return "creator";
  if (/agency site|agency portal/i.test(text)) return "agency";
  return "admin";
}

function inferIntent(scenario: string, title: string): string {
  const subject = scenario ? `${scenario}: ${title}` : title;
  return `Verify ${subject}.`;
}

function inferDependencies(
  stableId: string,
  groupCode: string,
  precondition: string,
  title: string,
  release: string
): CaseDependency[] {
  const text = `${precondition} ${title}`;
  const createMasterCampaignCaseId = `${release}-B7.2-TC01`;

  if (
    stableId !== createMasterCampaignCaseId &&
    groupCode !== "B7.2" &&
    /master campaign/i.test(text) &&
    /\b(exists|existing|already exists|populated|at least one)\b/i.test(text)
  ) {
    return [
      {
        stable_id: createMasterCampaignCaseId,
        reason: "This case needs an existing Master Campaign record; R6-B7.2-TC01 can create one during automated setup."
      }
    ];
  }

  return [];
}

function inferAutomationStatus(
  stableId: string,
  steps: string[],
  expectedResult: string[],
  precondition: string
): AutomationStatus {
  if (stableId === "R6-B7.2-TC01" || stableId === "R6-B7.1-TC01") {
    return "ready";
  }

  if (stableId === "R6-B7.3-TC01") {
    return "ready";
  }

  const text = `${precondition} ${steps.join(" ")} ${expectedResult.join(" ")}`;
  if (/cross-check|backend|network issue|external|new browser tab|export/i.test(text)) {
    return "manual_review";
  }

  return "needs_mapping";
}

function inferScenario(row: Row, headerMap: HeaderMap, currentGroup: string): string {
  if (headerMap.scenario !== undefined) {
    const scenario = cellToString(row[headerMap.scenario]);
    if (scenario) return scenario;
  }

  const whatColumn = headerMap.steps.find((column) => normalizeKey(column.label) === "what");
  if (whatColumn) {
    const what = cellToString(row[whatColumn.index]);
    if (what) return what;
  }

  return currentGroup;
}

function splitSteps(row: Row, headerMap: HeaderMap): string[] {
  if (usesCombinedPreconditionAndSteps(headerMap)) {
    const combined = cellToString(row[headerMap.steps[0].index]);
    const stepText = extractStepsFromCombinedCell(combined);
    const parsed = splitList(stepText);
    return parsed.length > 0 ? parsed : splitList(combined);
  }

  const howColumn = headerMap.steps.find((column) => normalizeKey(column.label) === "how");
  const primary = howColumn
    ? cellToString(row[howColumn.index])
    : cellToString(row[headerMap.steps[0]?.index]);
  const primarySteps = splitList(primary);

  if (primarySteps.length > 0) {
    return primarySteps;
  }

  return splitList(readLabeledCells(row, headerMap.steps));
}

function readPrecondition(row: Row, headerMap: HeaderMap): string {
  const value = cellToString(row[headerMap.precondition]);
  if (!usesCombinedPreconditionAndSteps(headerMap)) {
    return value;
  }

  return extractPreconditionFromCombinedCell(value);
}

function readStepText(row: Row, headerMap: HeaderMap): string {
  if (!usesCombinedPreconditionAndSteps(headerMap)) {
    return readLabeledCells(row, headerMap.steps);
  }

  const combined = cellToString(row[headerMap.steps[0].index]);
  return extractStepsFromCombinedCell(combined) || combined;
}

function usesCombinedPreconditionAndSteps(headerMap: HeaderMap): boolean {
  return headerMap.steps.length === 1 && headerMap.precondition === headerMap.steps[0].index;
}

function extractPreconditionFromCombinedCell(value: string): string {
  const match = value.match(/(?:pre-?\s*conditions?|pre\s*requisite)\s*:\s*([\s\S]*?)(?=\bsteps?\s*:|$)/i);
  return normalizeText(match?.[1] ?? value);
}

function extractStepsFromCombinedCell(value: string): string {
  const match = value.match(/\bsteps?\s*:\s*([\s\S]*)/i);
  return normalizeText(match?.[1] ?? value);
}

function readLabeledCells(row: Row, columns: StepColumn[]): string {
  if (columns.length === 1) {
    return cellToString(row[columns[0].index]);
  }

  return columns
    .map((column) => {
      const value = cellToString(row[column.index]);
      return value ? `${column.label}: ${value}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function splitList(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];

  const parts = normalized
    .replace(/\s*(\d+)[.)]\s*/g, "\n$1. ")
    .split(/\n+/)
    .map((part) => part.replace(/^\d+[.)]\s*/, "").trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : [normalized];
}

function toCaseNo(value: CellValue | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(cellToString(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getOptionalCell(row: Row, index?: number): string | undefined {
  if (index === undefined) return undefined;
  const value = cellToString(row[index]);
  return value || undefined;
}

function cellToString(value: CellValue | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function normalizeText(value: string): string {
  return value
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeKey(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function relativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replaceAll(path.sep, "/");
}

function summarizeAutomation(cases: NormalizedCase[]): Record<AutomationStatus, number> {
  return cases.reduce<Record<AutomationStatus, number>>(
    (summary, testCase) => {
      summary[testCase.automation_status] += 1;
      return summary;
    },
    { ready: 0, needs_mapping: 0, manual_review: 0 }
  );
}

function buildManifest(input: {
  release: string;
  title: string;
  inputDir: string;
  outDir: string;
  files: InputFiles;
  workbook: ParsedWorkbook;
  cases: NormalizedCase[];
}): Record<string, unknown> {
  return {
    release: input.release,
    title: input.title,
    generated_at: new Date().toISOString(),
    input_package: relativePath(input.inputDir),
    prd: input.files.prdPath
      ? {
          path: relativePath(input.files.prdPath),
          role: "business_context"
        }
      : undefined,
    test_case_source: {
      workbook: relativePath(input.files.workbookPath),
      sheet: input.workbook.sheet,
      header_row: input.workbook.headerRowIndex + 1
    },
    totals: {
      cases: input.cases.length,
      scenario_groups: new Set(input.cases.map((testCase) => testCase.scenario_group)).size,
      automation: summarizeAutomation(input.cases)
    },
    ready_case_ids: input.cases
      .filter((testCase) => testCase.automation_status === "ready")
      .map((testCase) => testCase.stable_id),
    notes: [
      "Generated from a local input package; do not modify the original PRD or workbook.",
      "Excel row numbers are trace-only metadata, not stable identifiers.",
      "Historical Status/Evidence columns are source context only and are not reused as the new run result."
    ]
  };
}

function formatIngestionReport(input: {
  release: string;
  title: string;
  inputDir: string;
  files: InputFiles;
  workbook: ParsedWorkbook;
  cases: NormalizedCase[];
}): string {
  const automation = summarizeAutomation(input.cases);
  const groups = Array.from(
    input.cases.reduce<Map<string, number>>((map, testCase) => {
      map.set(testCase.scenario_group, (map.get(testCase.scenario_group) ?? 0) + 1);
      return map;
    }, new Map())
  );

  return `# Ingestion Report - ${input.release}

## Input

- Input package: \`${relativePath(input.inputDir)}\`
- PRD: \`${input.files.prdPath ? relativePath(input.files.prdPath) : "not found"}\`
- Test cases: \`${relativePath(input.files.workbookPath)}\`
- Sheet: \`${input.workbook.sheet}\`
- Header row: ${input.workbook.headerRowIndex + 1}

## Output Summary

- Release: ${input.release}
- Title: ${input.title}
- Normalized cases: ${input.cases.length}
- Ready for current executor: ${automation.ready}
- Needs executor / selector mapping: ${automation.needs_mapping}
- Manual review suggested: ${automation.manual_review}

## Scenario Groups

${groups.map(([group, count]) => `- ${group}: ${count} case(s)`).join("\n")}

## Ready Case IDs

${input.cases
  .filter((testCase) => testCase.automation_status === "ready")
  .map((testCase) => `- ${testCase.stable_id} - ${testCase.title}`)
  .join("\n")}

## Notes

- The parser recognized cases by the table header columns, not by hard-coded row numbers.
- B7.x section rows are used to build stable IDs like \`${input.release}-B7.2-TC01\`.
- Historical Excel status/evidence is preserved as source metadata only.
- Cases outside the current R6 pilot executor are intentionally marked \`needs_mapping\` or \`manual_review\`.
`;
}
