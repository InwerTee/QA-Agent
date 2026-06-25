import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { validateRunPayload } from "../../src/web/server.js";
import { inferRelease } from "../../src/ingestion/prepareInputPackage.js";

test("local web runner page exposes the minimal upload workflow", async () => {
  const html = await readFile("src/web/static/index.html", "utf8");

  expect(html).toContain("Gro QA Agent");
  expect(html).toContain("accept=\"application/pdf,.pdf\"");
  expect(html).toContain("accept=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx\"");
  expect(html).toContain("Run QA Agent");
  expect(html).toContain("Run label");
  expect(html).toContain("Run progress");
  expect(html).toContain("Running cases");
  expect(html).toContain("/api/run-status/");
  expect(html).toContain("Inferred release");
  expect(html).toContain("Download filled Excel");
  expect(html).toContain("Open result folder");
  expect(html).toContain("Processed cases");
  expect(html).toContain("This page must be opened from the local QA Agent server");
  expect(html).toContain("Could not reach the local QA Agent server");
  expect(html).toContain("http://127.0.0.1:4173");
});

test("local web server validates PRD and test case file types before running", () => {
  expect(() =>
    validateRunPayload({
      runLabel: "Test",
      prd: {
        name: "prd.docx",
        dataBase64: "ZmFrZQ=="
      },
      testCases: {
        name: "test-cases.xlsx",
        dataBase64: "ZmFrZQ=="
      }
    })
  ).toThrow("PRD must be a PDF file");

  expect(() =>
    validateRunPayload({
      runLabel: "Test",
      prd: {
        name: "prd.pdf",
        dataBase64: "ZmFrZQ=="
      },
      testCases: {
        name: "test-cases.xls",
        dataBase64: "ZmFrZQ=="
      }
    })
  ).toThrow("Test cases must be an .xlsx file");
});

test("local web run label does not decide the inferred release", () => {
  const payload = validateRunPayload({
    runLabel: "Test",
    prd: {
      name: "PRD - R6 Master Campaign.pdf",
      dataBase64: "ZmFrZQ=="
    },
    testCases: {
      name: "R6.xlsx",
      dataBase64: "ZmFrZQ=="
    }
  });

  expect(payload.runLabel).toBe("Test");
  expect(payload.release).toBeUndefined();
  expect(inferRelease({}, ["R6", "web-Test"])).toBe("R6");
});
