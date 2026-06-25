import type { BrowserObservation } from "./browserObservation.js";

export interface TableValueCheck {
  value: string;
  rowCount: number;
  matchedRows: number;
  status: "matched" | "not_matched" | "no_rows" | "not_checkable";
  actual: string;
}

export interface TableHeaderOrderCheck {
  expectedHeaders: string[];
  observedHeaders: string[];
  missingHeaders: string[];
  outOfOrderHeaders: string[];
  status: "passed" | "failed" | "not_checkable";
  actual: string;
}

export interface TableNullDisplayCheck {
  rowCount: number;
  offendingValues: string[];
  status: "passed" | "failed" | "not_checkable";
  actual: string;
}

export type AppliedTableFilter =
  | {
      label: string;
      kind: "one_of";
      values: string[];
      sourceText?: string;
    }
  | {
      label: string;
      kind: "range";
      min: number;
      max: number;
      sourceText?: string;
    };

export interface TableFilterAssertionCheck {
  rowCount: number;
  checkedRows: number;
  matchedFilters: string[];
  missingFilters: string[];
  offendingRows: string[];
  status: "passed" | "failed" | "partial" | "not_checkable";
  actual: string;
}

export function checkTableRowsContainValue(
  observation: BrowserObservation,
  value: string
): TableValueCheck {
  const normalizedValue = normalizeForMatch(value);
  if (!normalizedValue) {
    return {
      value,
      rowCount: 0,
      matchedRows: 0,
      status: "not_checkable",
      actual: "No search value was available for a table row check."
    };
  }

  const rows = tableRows(observation);
  if (rows.length === 0) {
    return {
      value,
      rowCount: 0,
      matchedRows: 0,
      status: "no_rows",
      actual: `No table rows were observed after entering "${value}".`
    };
  }

  const matchedRows = rows.filter((row) => normalizeForMatch(row.join(" ")).includes(normalizedValue));
  const allMatched = matchedRows.length === rows.length;

  return {
    value,
    rowCount: rows.length,
    matchedRows: matchedRows.length,
    status: allMatched ? "matched" : "not_matched",
    actual: allMatched
      ? `All ${rows.length} sampled table row(s) contained "${value}".`
      : `${matchedRows.length}/${rows.length} sampled table row(s) contained "${value}".`
  };
}

export function checkTableHeadersInOrder(
  observation: BrowserObservation,
  expectedHeaders: string[]
): TableHeaderOrderCheck {
  const observedHeaders = observation.tableHeaders;
  const normalizedObserved = observedHeaders.map(normalizeForMatch);
  const normalizedExpected = expectedHeaders.map(normalizeForMatch).filter(Boolean);

  if (normalizedExpected.length === 0) {
    return {
      expectedHeaders,
      observedHeaders,
      missingHeaders: [],
      outOfOrderHeaders: [],
      status: "not_checkable",
      actual: "No explicit expected table headers were provided."
    };
  }

  const matchedIndexes = normalizedExpected.map((expected) =>
    normalizedObserved.findIndex((observed) => observed.includes(expected))
  );
  const missingHeaders = expectedHeaders.filter((_, index) => matchedIndexes[index] < 0);
  const outOfOrderHeaders: string[] = [];

  let previousIndex = -1;
  for (const [index, matchedIndex] of matchedIndexes.entries()) {
    if (matchedIndex < 0) continue;
    if (matchedIndex < previousIndex) {
      outOfOrderHeaders.push(expectedHeaders[index]);
    }
    previousIndex = Math.max(previousIndex, matchedIndex);
  }

  const passed = missingHeaders.length === 0 && outOfOrderHeaders.length === 0;

  return {
    expectedHeaders,
    observedHeaders,
    missingHeaders,
    outOfOrderHeaders,
    status: passed ? "passed" : "failed",
    actual: passed
      ? `Observed expected table headers in order: ${expectedHeaders.join(", ")}.`
      : `Table header check failed; missing: ${missingHeaders.join(", ") || "none"}; out of order: ${outOfOrderHeaders.join(", ") || "none"}.`
  };
}

export function checkNoRawNullInTableSamples(
  observation: BrowserObservation
): TableNullDisplayCheck {
  const rows = tableRows(observation);
  if (rows.length === 0) {
    return {
      rowCount: 0,
      offendingValues: [],
      status: "not_checkable",
      actual: "No sampled table rows were available for null-display checking."
    };
  }

  const offendingValues = rows
    .flat()
    .filter((value) => /\b(null|undefined)\b/i.test(value.trim()))
    .slice(0, 10);

  return {
    rowCount: rows.length,
    offendingValues,
    status: offendingValues.length === 0 ? "passed" : "failed",
    actual: offendingValues.length === 0
      ? `Checked ${rows.length} sampled table row(s); no raw null/undefined text was observed.`
      : `Observed raw null-like table value(s): ${offendingValues.join(", ")}.`
  };
}

export function checkTableRowsMatchFilters(
  observation: BrowserObservation,
  filters: AppliedTableFilter[]
): TableFilterAssertionCheck {
  const usableFilters = filters.filter((filter) => filter.label.trim());
  if (usableFilters.length === 0) {
    return {
      rowCount: 0,
      checkedRows: 0,
      matchedFilters: [],
      missingFilters: [],
      offendingRows: [],
      status: "not_checkable",
      actual: "No applied filters were available for table assertion."
    };
  }

  const tableMatch = bestTableForFilters(observation, usableFilters);
  if (!tableMatch || tableMatch.matched.length === 0) {
    return {
      rowCount: 0,
      checkedRows: 0,
      matchedFilters: [],
      missingFilters: usableFilters.map((filter) => filter.label),
      offendingRows: [],
      status: "not_checkable",
      actual: `No observed table had columns matching applied filter(s): ${usableFilters.map((filter) => filter.label).join(", ")}.`
    };
  }

  const rows = dataRows(tableMatch.table.sampleRows);
  if (rows.length === 0) {
    return {
      rowCount: 0,
      checkedRows: 0,
      matchedFilters: tableMatch.matched.map((match) => match.filter.label),
      missingFilters: tableMatch.missing.map((filter) => filter.label),
      offendingRows: [],
      status: "not_checkable",
      actual: "No sampled table rows were available after applying filters, so row-level filter correctness could not be verified."
    };
  }

  const offendingRows: string[] = [];
  for (const row of rows) {
    const failedFilters = tableMatch.matched.filter((match) => {
      const value = alignedRowValue(row, tableMatch.table.headers, match.headerIndex) ?? "";
      return !cellMatchesFilter(value, match.filter);
    });

    if (failedFilters.length > 0) {
      offendingRows.push(
        `${row.join(" | ")} (failed: ${failedFilters.map((match) => match.filter.label).join(", ")})`
      );
    }
  }

  const matchedFilterLabels = tableMatch.matched.map((match) => match.filter.label);
  const missingFilterLabels = tableMatch.missing.map((filter) => filter.label);

  if (offendingRows.length > 0) {
    return {
      rowCount: rows.length,
      checkedRows: rows.length,
      matchedFilters: matchedFilterLabels,
      missingFilters: missingFilterLabels,
      offendingRows: offendingRows.slice(0, 5),
      status: "failed",
      actual: `${offendingRows.length}/${rows.length} sampled row(s) did not satisfy applied table filter(s): ${offendingRows.slice(0, 3).join("; ")}.`
    };
  }

  if (missingFilterLabels.length > 0) {
    return {
      rowCount: rows.length,
      checkedRows: rows.length,
      matchedFilters: matchedFilterLabels,
      missingFilters: missingFilterLabels,
      offendingRows: [],
      status: "partial",
      actual: `All ${rows.length} sampled row(s) satisfied matched filter column(s): ${matchedFilterLabels.join(", ")}. Could not verify missing column(s): ${missingFilterLabels.join(", ")}.`
    };
  }

  return {
    rowCount: rows.length,
    checkedRows: rows.length,
    matchedFilters: matchedFilterLabels,
    missingFilters: [],
    offendingRows: [],
    status: "passed",
    actual: `All ${rows.length} sampled row(s) satisfied applied filter(s): ${matchedFilterLabels.join(", ")}.`
  };
}

function tableRows(observation: BrowserObservation): string[][] {
  const seen = new Set<string>();
  const rows: string[][] = [];

  for (const table of observation.tables) {
    for (const row of table.sampleRows) {
      const cleaned = row.map((value) => value.trim()).filter(Boolean);
      if (cleaned.length === 0) continue;

      const key = normalizeForMatch(cleaned.join(" "));
      if (!key || seen.has(key)) continue;

      seen.add(key);
      rows.push(cleaned);
    }
  }

  return rows;
}

function bestTableForFilters(
  observation: BrowserObservation,
  filters: AppliedTableFilter[]
):
  | {
      table: BrowserObservation["tables"][number];
      matched: Array<{ filter: AppliedTableFilter; headerIndex: number }>;
      missing: AppliedTableFilter[];
    }
  | undefined {
  return observation.tables
    .map((table) => {
      const matched: Array<{ filter: AppliedTableFilter; headerIndex: number }> = [];
      const missing: AppliedTableFilter[] = [];

      for (const filter of filters) {
        const headerIndex = matchingHeaderIndex(table.headers, filter.label);
        if (headerIndex >= 0) {
          matched.push({ filter, headerIndex });
        } else {
          missing.push(filter);
        }
      }

      return { table, matched, missing };
    })
    .sort((left, right) => {
      if (right.matched.length !== left.matched.length) {
        return right.matched.length - left.matched.length;
      }

      return right.table.rowCount - left.table.rowCount;
    })[0];
}

function matchingHeaderIndex(headers: string[], label: string): number {
  const normalizedLabel = normalizeForMatch(label);
  const labelTokens = normalizedLabel.split(" ").filter(Boolean);

  return headers.findIndex((header) => {
    const normalizedHeader = normalizeForMatch(header);
    if (!normalizedHeader) return false;
    if (normalizedHeader === normalizedLabel) return true;
    if (normalizedHeader.includes(normalizedLabel) || normalizedLabel.includes(normalizedHeader)) return true;
    return labelTokens.length > 0 && labelTokens.every((token) => normalizedHeader.includes(token));
  });
}

function dataRows(rows: string[][]): string[][] {
  return rows
    .map((row) => row.map((value) => value.trim()))
    .filter((row) => row.some(Boolean))
    .filter((row) => !/no data|no results|no records/i.test(row.join(" ")));
}

function alignedRowValue(
  row: string[],
  headers: string[],
  headerIndex: number
): string | undefined {
  const hasLeadingEmptyCell =
    headers.length > 0 &&
    !row[0]?.trim() &&
    Boolean(row[headerIndex + 1]?.trim());

  if (hasLeadingEmptyCell) {
    return row[headerIndex + 1]?.trim();
  }

  return row[headerIndex]?.trim();
}

function cellMatchesFilter(value: string, filter: AppliedTableFilter): boolean {
  if (filter.kind === "one_of") {
    const normalizedValue = normalizeForMatch(value);
    return filter.values.some((option) => normalizedValue.includes(normalizeForMatch(option)));
  }

  const numericValue = parseDisplayNumber(value);
  if (numericValue === undefined) return false;

  return numericValue >= filter.min && numericValue <= filter.max;
}

function parseDisplayNumber(value: string): number | undefined {
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?\s*[kKmM]?/);
  if (!match) return undefined;

  const raw = match[0].trim();
  const numeric = Number(raw.replace(/[kKmM]/g, ""));
  if (!Number.isFinite(numeric)) return undefined;

  if (/k$/i.test(raw)) return numeric * 1_000;
  if (/m$/i.test(raw)) return numeric * 1_000_000;
  return numeric;
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9@._+-]+/g, " ").replace(/\s+/g, " ").trim();
}
