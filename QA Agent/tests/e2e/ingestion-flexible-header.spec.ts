import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { loadCasesFromFile } from "../../src/cases/loadCases.js";
import { prepareInputPackage } from "../../src/ingestion/prepareInputPackage.js";
import type { NormalizedCase } from "../../src/types.js";

const require = createRequire(import.meta.url);
const XlsxPopulate = require("xlsx-populate") as {
  fromBlankAsync(): Promise<TestWorkbook>;
};

interface TestWorkbook {
  sheet(name: string): TestWorksheet;
  toFileAsync(filePath: string): Promise<void>;
}

interface TestWorksheet {
  cell(rowNumber: number, columnNumber: number): TestCell;
}

interface TestCell {
  value(value: unknown): TestCell;
}

test("ingestion supports Paragon two-row test steps headers", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "qa-flex-header-"));
  const workbookPath = path.join(tempDir, "R1.xlsx");
  const outDir = path.join(tempDir, "out");
  const workbook = await XlsxPopulate.fromBlankAsync();
  const sheet = workbook.sheet("Sheet1");

  sheet.cell(1, 1).value("Requirement name");
  sheet.cell(1, 2).value("R1 Revamp Creator Database");
  sheet.cell(8, 1).value("ID");
  sheet.cell(8, 2).value("Test Case");
  sheet.cell(8, 3).value("Prerequisite");
  sheet.cell(8, 4).value("Test Steps");
  sheet.cell(8, 10).value("Expected Result");
  sheet.cell(8, 11).value("Userflow/Detail Fields");
  sheet.cell(8, 12).value("Result");
  sheet.cell(8, 13).value("Status");
  sheet.cell(8, 14).value("Bugs Detail");
  sheet.cell(9, 4).value("What");
  sheet.cell(9, 5).value("When");
  sheet.cell(9, 6).value("Where");
  sheet.cell(9, 7).value("Why");
  sheet.cell(9, 8).value("Who");
  sheet.cell(9, 9).value("How");

  sheet.cell(10, 1).value("Revamp Creator Account List Page in Admin Site");
  sheet.cell(11, 1).value(1);
  sheet.cell(11, 2).value("Verify Successful Search Functionality");
  sheet.cell(11, 3).value("Creator accounts exist with various data points.");
  sheet.cell(11, 4).value("Search with Valid Criteria.");
  sheet.cell(11, 5).value("When the admin uses the search bar.");
  sheet.cell(11, 6).value("Creator Account List Page > Search Bar.");
  sheet.cell(11, 7).value("To test search fields.");
  sheet.cell(11, 8).value("Admin");
  sheet.cell(11, 9).value("1. Type a full username.\n2. Clear the search.");
  sheet.cell(11, 10).value("The table correctly updates to matching creator accounts.");
  sheet.cell(11, 12).value("https://jam.dev/c/example");
  sheet.cell(11, 13).value("PASSED");
  sheet.cell(11, 14).value("Known bug detail.");

  await workbook.toFileAsync(workbookPath);

  const prepared = await prepareInputPackage(tempDir, { outDir });
  const cases = JSON.parse(await readFile(prepared.casesPath, "utf8")) as NormalizedCase[];

  expect(prepared.release).toBe("R1");
  expect(cases).toHaveLength(1);
  expect(cases[0]).toEqual(
    expect.objectContaining({
      stable_id: "R1-G1-TC01",
      scenario_group: "Revamp Creator Account List Page in Admin Site",
      scenario: "Search with Valid Criteria.",
      title: "Verify Successful Search Functionality",
      module: "Creator Account",
      site: "admin"
    })
  );
  expect(cases[0].steps).toEqual(["Type a full username.", "Clear the search."]);
  expect(cases[0].raw_source.test_steps).toContain("What: Search with Valid Criteria.");
  expect(cases[0].source.historical_evidence).toBe("https://jam.dev/c/example");
  expect(cases[0].source.historical_status).toBe("PASSED");
  expect(cases[0].source.historical_note).toBe("Known bug detail.");
});

test("ingestion supports scenario-grouped sheets without per-row case numbers", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "qa-r3-header-"));
  const workbookPath = path.join(tempDir, "R3.xlsx");
  const outDir = path.join(tempDir, "out");
  const workbook = await XlsxPopulate.fromBlankAsync();
  const sheet = workbook.sheet("Sheet1");

  sheet.cell(2, 3).value("Requirement name");
  sheet.cell(2, 4).value("Campaign List, Campaign Statistics");
  sheet.cell(4, 3).value("Release");
  sheet.cell(4, 4).value("R3: Campaign Statistics & Applicant Dashboard");
  sheet.cell(8, 2).value("No");
  sheet.cell(8, 3).value("Scenario");
  sheet.cell(8, 4).value("Test Case");
  sheet.cell(8, 5).value("Pre requisite");
  sheet.cell(8, 6).value("Test Steps");
  sheet.cell(8, 7).value("Expected Result");
  sheet.cell(8, 8).value("Type");
  sheet.cell(8, 10).value("Actual Result");
  sheet.cell(8, 11).value("Status");
  sheet.cell(8, 12).value("Evidence");
  sheet.cell(8, 13).value("Note");

  sheet.cell(9, 3).value("Search Campaign");
  sheet.cell(9, 4).value("Search by campaign name");
  sheet.cell(9, 5).value("User is on the Campaign List Page.");
  sheet.cell(9, 6).value("1. Search campaign by name");
  sheet.cell(9, 7).value("Display matching campaigns.");
  sheet.cell(9, 8).value("Positive");
  sheet.cell(9, 10).value("As expected");
  sheet.cell(9, 11).value("Passed");
  sheet.cell(9, 12).value("https://jam.dev/c/r3-example");

  sheet.cell(10, 4).value("Search with no result");
  sheet.cell(10, 5).value("User is on the Campaign List Page.");
  sheet.cell(10, 6).value("1. Search campaign by name \"qwerty\"");
  sheet.cell(10, 7).value("Wording \"no data\" displayed on the table.");
  sheet.cell(10, 8).value("Negative");
  sheet.cell(10, 10).value("As expected");
  sheet.cell(10, 11).value("Passed");

  sheet.cell(11, 3).value("Filter Campaign");
  sheet.cell(11, 4).value("Filter with single parameter");
  sheet.cell(11, 5).value("");
  sheet.cell(11, 6).value("1. Klik button filter\n2. Klik button apply");
  sheet.cell(11, 7).value("Display filtered campaigns.");
  sheet.cell(11, 8).value("Positive");
  sheet.cell(11, 11).value("Passed");
  sheet.cell(12, 4).value("User navigates to the Campaign Applicant Page");
  sheet.cell(12, 5).value("User is on the Campaign detail page.");
  sheet.cell(12, 7).value("The All tab is active.");
  sheet.cell(12, 8).value("Positive");
  sheet.cell(12, 11).value("Passed");

  await workbook.toFileAsync(workbookPath);

  const prepared = await prepareInputPackage(tempDir, { outDir });
  const cases = JSON.parse(await readFile(prepared.casesPath, "utf8")) as NormalizedCase[];
  const loadedCases = await loadCasesFromFile(prepared.casesPath);

  expect(prepared.release).toBe("R3");
  expect(cases.map((testCase) => testCase.stable_id)).toEqual([
    "R3-G1-TC01",
    "R3-G1-TC02",
    "R3-G2-TC01",
    "R3-G2-TC02"
  ]);
  expect(cases[0]).toEqual(
    expect.objectContaining({
      scenario_group: "Search Campaign",
      scenario: "Search Campaign",
      module: "Campaign",
      type: "Positive"
    })
  );
  expect(cases[0].source.historical_evidence).toBe("https://jam.dev/c/r3-example");
  expect(cases[0].source.historical_status).toBe("Passed");
  expect(cases[1].steps).toEqual(['Search campaign by name "qwerty"']);
  expect(cases[2].scenario_group).toBe("Filter Campaign");
  expect(cases[2].precondition).toBe("");
  expect(loadedCases[2].precondition).toBe("");
  expect(loadedCases[3].steps).toEqual([]);
  expect(loadedCases[3].expected_result).toEqual(["The All tab is active."]);
});

test("ingestion supports combined prerequisite and test steps columns", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "qa-r51-header-"));
  const workbookPath = path.join(tempDir, "R5.1.xlsx");
  const outDir = path.join(tempDir, "out");
  const workbook = await XlsxPopulate.fromBlankAsync();
  const sheet = workbook.sheet("Sheet1");

  sheet.cell(2, 3).value("Requirement name");
  sheet.cell(2, 4).value("R5 - Agency Account");
  sheet.cell(4, 3).value("Release");
  sheet.cell(4, 4).value("R5 - Agency Account");
  sheet.cell(8, 2).value("No");
  sheet.cell(8, 3).value("Scenario");
  sheet.cell(8, 4).value("Test Case");
  sheet.cell(8, 5).value("Validation");
  sheet.cell(8, 6).value("Pre requisite & Test Steps");
  sheet.cell(8, 7).value("Expected Result");
  sheet.cell(8, 8).value("Type");
  sheet.cell(8, 11).value("Status");
  sheet.cell(8, 12).value("Evidence");
  sheet.cell(8, 13).value("Note");

  sheet.cell(9, 2).value("J1.1 Admin Site - Registration Internal Trigger Page");
  sheet.cell(10, 3).value("J1.1 Admin Site - Registration Internal Trigger Page");
  sheet.cell(10, 4).value("Send Invitation Successfully");
  sheet.cell(10, 5).value("Valid agency data");
  sheet
    .cell(10, 6)
    .value(
      "Pre-condition: Agency row exists in Pending Invitation status. Steps: 1) Admin selects a row. 2) Click Send Invitation."
    );
  sheet.cell(10, 7).value("Invitation email sent, status updated to Pending Registration.");
  sheet.cell(10, 8).value("Positive");
  sheet.cell(10, 11).value("Passed");
  sheet.cell(10, 12).value("https://jam.dev/c/r51-example");

  await workbook.toFileAsync(workbookPath);

  const prepared = await prepareInputPackage(tempDir, { outDir });
  const cases = JSON.parse(await readFile(prepared.casesPath, "utf8")) as NormalizedCase[];

  expect(prepared.release).toBe("R5.1");
  expect(cases).toHaveLength(1);
  expect(cases[0]).toEqual(
    expect.objectContaining({
      stable_id: "R5.1-G1-TC01",
      scenario_group: "J1.1 Admin Site - Registration Internal Trigger Page",
      scenario: "J1.1 Admin Site - Registration Internal Trigger Page",
      title: "Send Invitation Successfully",
      site: "admin"
    })
  );
  expect(cases[0].precondition).toBe("Agency row exists in Pending Invitation status.");
  expect(cases[0].steps).toEqual(["Admin selects a row.", "Click Send Invitation."]);
  expect(cases[0].raw_source.pre_requisite).toBe(
    "Agency row exists in Pending Invitation status."
  );
  expect(cases[0].raw_source.test_steps).toBe("1) Admin selects a row. 2) Click Send Invitation.");
  expect(cases[0].source.historical_evidence).toBe("https://jam.dev/c/r51-example");
});
