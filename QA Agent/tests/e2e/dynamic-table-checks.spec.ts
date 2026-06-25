import { expect, test } from "@playwright/test";
import {
  checkNoRawNullInTableSamples,
  checkTableHeadersInOrder,
  checkTableRowsMatchFilters,
  checkTableRowsContainValue
} from "../../src/dynamic/tableChecks.js";
import type { BrowserObservation } from "../../src/dynamic/browserObservation.js";

test("table row value checks require every sampled row to match the entered search value", () => {
  const matched = checkTableRowsContainValue(
    fakeObservation({
      rows: [
        ["bangcuan_shop", "Creator", "krnputri24@gmail.com"],
        ["bangcuan_shop", "Creator", "62812344567"]
      ]
    }),
    "bangcuan_shop"
  );
  const notMatched = checkTableRowsContainValue(
    fakeObservation({
      rows: [
        ["bangcuan_shop", "Creator"],
        ["bertosb1m", "Creator"]
      ]
    }),
    "bangcuan_shop"
  );

  expect(matched.status).toBe("matched");
  expect(matched.rowCount).toBe(2);
  expect(matched.matchedRows).toBe(2);
  expect(notMatched.status).toBe("not_matched");
  expect(notMatched.rowCount).toBe(2);
  expect(notMatched.matchedRows).toBe(1);
});

test("table header checks validate explicit expected columns in order", () => {
  const observation = fakeObservation({
    headers: ["User Name (Former)", "Platform", "Phone Number", "Email"]
  });

  expect(checkTableHeadersInOrder(observation, ["User Name", "Email"])).toEqual(
    expect.objectContaining({
      status: "passed",
      missingHeaders: [],
      outOfOrderHeaders: []
    })
  );
  expect(checkTableHeadersInOrder(observation, ["Email", "User Name"])).toEqual(
    expect.objectContaining({
      status: "failed",
      missingHeaders: [],
      outOfOrderHeaders: ["User Name"]
    })
  );
  expect(checkTableHeadersInOrder(observation, [])).toEqual(
    expect.objectContaining({
      status: "not_checkable"
    })
  );
});

test("table null display checks flag raw null-like values in sampled rows", () => {
  expect(
    checkNoRawNullInTableSamples(
      fakeObservation({
        rows: [["bangcuan_shop", "-", "No"]]
      })
    )
  ).toEqual(
    expect.objectContaining({
      status: "passed"
    })
  );
  expect(
    checkNoRawNullInTableSamples(
      fakeObservation({
        rows: [["bangcuan_shop", "null", "undefined"]]
      })
    )
  ).toEqual(
    expect.objectContaining({
      status: "failed",
      offendingValues: ["null", "undefined"]
    })
  );
});

test("table filter checks validate selected values and numeric ranges", () => {
  const check = checkTableRowsMatchFilters(
    fakeObservation({
      headers: ["User Name", "Platform", "Followers"],
      rows: [
        ["alice", "TikTok", "12,000"],
        ["bob", "Instagram", "50K"]
      ]
    }),
    [
      { label: "Platform", kind: "one_of", values: ["TikTok", "Instagram"] },
      { label: "Followers", kind: "range", min: 10_000, max: 50_000 }
    ]
  );

  expect(check).toEqual(
    expect.objectContaining({
      status: "passed",
      checkedRows: 2,
      missingFilters: []
    })
  );
});

test("table filter checks flag sampled rows outside applied criteria", () => {
  const check = checkTableRowsMatchFilters(
    fakeObservation({
      headers: ["User Name", "Platform", "Followers"],
      rows: [
        ["alice", "TikTok", "12,000"],
        ["bob", "YouTube", "4,000"]
      ]
    }),
    [
      { label: "Platform", kind: "one_of", values: ["TikTok", "Instagram"] },
      { label: "Followers", kind: "range", min: 10_000, max: 50_000 }
    ]
  );

  expect(check.status).toBe("failed");
  expect(check.offendingRows[0]).toContain("YouTube");
});

test("table filter checks stay partial when an applied filter has no visible table column", () => {
  const check = checkTableRowsMatchFilters(
    fakeObservation({
      headers: ["User Name", "Platform", "Followers"],
      rows: [["alice", "TikTok", "12,000"]]
    }),
    [
      { label: "Platform", kind: "one_of", values: ["TikTok"] },
      { label: "Is Paragon Employee", kind: "one_of", values: ["Yes"] }
    ]
  );

  expect(check).toEqual(
    expect.objectContaining({
      status: "partial",
      matchedFilters: ["Platform"],
      missingFilters: ["Is Paragon Employee"]
    })
  );
});

function fakeObservation(input: {
  headers?: string[];
  rows?: string[][];
}): BrowserObservation {
  return {
    url: "https://staging-gro.paradev.io/admin/authors/public-page",
    title: "Gro Creator",
    visibleTextSample: "",
    buttons: [],
    clickables: [],
    inputs: [],
    tableHeaders: input.headers ?? [],
    tables: [
      {
        headers: input.headers ?? [],
        rowCount: input.rows?.length ?? 0,
        sampleRows: input.rows ?? []
      }
    ]
  };
}
