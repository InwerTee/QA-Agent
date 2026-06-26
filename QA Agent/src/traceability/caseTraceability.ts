import type {
  CaseExecutionTrace,
  NormalizedCase,
  TestCaseIR,
  TraceCoverageStatus,
  TraceCoverageSummary,
  TraceEntry
} from "../types.js";

export interface TraceContractEntry {
  source_index: number;
  coverage: TraceCoverageStatus;
  actual_check: string;
  notes?: string[];
}

export interface CaseTraceContract {
  contract_id: string;
  precondition_trace: TraceContractEntry[];
  step_trace: TraceContractEntry[];
  expected_trace: TraceContractEntry[];
  alignment_notes: string[];
}

export function buildTraceFromContract(
  testCase: NormalizedCase,
  contract: CaseTraceContract,
  evidencePath?: string
): CaseExecutionTrace {
  const preconditionTrace = materializeTraceEntries(
    "precondition",
    [testCase.precondition],
    contract.precondition_trace,
    evidencePath
  );
  const stepTrace = materializeTraceEntries(
    "test_step",
    testCase.steps,
    contract.step_trace,
    evidencePath
  );
  const expectedTrace = materializeTraceEntries(
    "expected_result",
    testCase.expected_result,
    contract.expected_trace,
    evidencePath
  );

  return buildCaseExecutionTrace(testCase, {
    contract_id: contract.contract_id,
    precondition_trace: preconditionTrace,
    step_trace: stepTrace,
    expected_trace: expectedTrace,
    alignment_notes: contract.alignment_notes
  });
}

export function buildNotExecutedTrace(
  testCase: NormalizedCase,
  reason: string,
  testCaseIR?: TestCaseIR,
  evidencePath?: string
): CaseExecutionTrace {
  const preconditionTrace = materializeTraceEntries(
    "precondition",
    [testCase.precondition],
    [],
    evidencePath,
    reason
  );
  const stepTrace = materializeTraceEntries(
    "test_step",
    testCase.steps,
    [],
    evidencePath,
    reason
  );
  const expectedTrace = materializeTraceEntries(
    "expected_result",
    testCase.expected_result,
    [],
    evidencePath,
    reason
  );

  return buildCaseExecutionTrace(testCase, {
    precondition_trace: preconditionTrace,
    step_trace: stepTrace,
    expected_trace: expectedTrace,
    alignment_notes: [reason],
    test_case_ir: testCaseIR
  });
}

export function summarizeTraceCoverage(entries: TraceEntry[]): TraceCoverageSummary {
  return entries.reduce<TraceCoverageSummary>(
    (summary, entry) => {
      summary[entry.coverage] += 1;
      return summary;
    },
    {
      covered: 0,
      partially_covered: 0,
      not_covered: 0,
      not_executed: 0
    }
  );
}

function buildCaseExecutionTrace(
  testCase: NormalizedCase,
  trace: Pick<
    CaseExecutionTrace,
    | "contract_id"
    | "precondition_trace"
    | "step_trace"
    | "expected_trace"
    | "alignment_notes"
    | "test_case_ir"
  >
): CaseExecutionTrace {
  const allEntries = [
    ...trace.precondition_trace,
    ...trace.step_trace,
    ...trace.expected_trace
  ];

  return {
    source_workbook: testCase.source.workbook,
    source_sheet: testCase.sheet,
    source_row: testCase.source_row,
    raw_test_case: testCase.raw_source.test_case,
    raw_pre_requisite: testCase.raw_source.pre_requisite,
    raw_test_steps: testCase.raw_source.test_steps,
    raw_expected_result: testCase.raw_source.expected_result,
    contract_id: trace.contract_id,
    precondition_trace: trace.precondition_trace,
    step_trace: trace.step_trace,
    expected_trace: trace.expected_trace,
    coverage_summary: summarizeTraceCoverage(allEntries),
    alignment_notes: trace.alignment_notes,
    test_case_ir: trace.test_case_ir
  };
}

function materializeTraceEntries(
  sourceType: TraceEntry["source_type"],
  sourceTexts: string[],
  contractEntries: TraceContractEntry[],
  evidencePath?: string,
  notExecutedReason?: string
): TraceEntry[] {
  const contractByIndex = new Map(
    contractEntries.map((entry) => [entry.source_index, entry])
  );

  return sourceTexts.map((sourceText, arrayIndex) => {
    const sourceIndex = arrayIndex + 1;
    const contractEntry = contractByIndex.get(sourceIndex);

    if (!contractEntry || notExecutedReason) {
      return {
        source_type: sourceType,
        source_index: sourceIndex,
        source_text: sourceText,
        coverage: "not_executed",
        actual_check: "No automated check was executed for this source item.",
        evidence_path: evidencePath,
        notes: notExecutedReason ? [notExecutedReason] : []
      };
    }

    return {
      source_type: sourceType,
      source_index: sourceIndex,
      source_text: sourceText,
      coverage: contractEntry.coverage,
      actual_check: contractEntry.actual_check,
      evidence_path: evidencePath,
      notes: contractEntry.notes ?? []
    };
  });
}
