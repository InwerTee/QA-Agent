import type { NormalizedCase, TraceCoverageSummary } from "../types.js";
import {
  buildTraceFromContract,
  type CaseTraceContract
} from "./caseTraceability.js";

const CONTRACTS: Record<string, CaseTraceContract> = {
  "R6-B7.2-TC01": {
    contract_id: "R6-B7.2-TC01.master_campaign.create.v1",
    precondition_trace: [
      {
        source_index: 1,
        coverage: "covered",
        actual_check:
          "Opened the Master Campaign List page and waited for the Master Campaign table UI before clicking Add Master Campaign."
      }
    ],
    step_trace: [
      {
        source_index: 1,
        coverage: "covered",
        actual_check: "Clicked the Add Master Campaign button."
      },
      {
        source_index: 2,
        coverage: "covered",
        actual_check: "Waited for the visible Create Master Campaign dialog."
      },
      {
        source_index: 3,
        coverage: "covered",
        actual_check:
          "Filled required basic information fields: generated Master Campaign name, first available Brand, Period date range, and Brief Description."
      },
      {
        source_index: 4,
        coverage: "covered",
        actual_check:
          "Filled visible enabled numeric target inputs with valid numeric values."
      },
      {
        source_index: 5,
        coverage: "partially_covered",
        actual_check:
          "Clicked Save successfully; the script does not separately assert the Save button enabled state before clicking.",
        notes: ["Add explicit enabled-state assertion if this becomes a strict UI requirement."]
      },
      {
        source_index: 6,
        coverage: "covered",
        actual_check: "Clicked the Save button and waited for the dialog to close."
      }
    ],
    expected_trace: [
      {
        source_index: 1,
        coverage: "covered",
        actual_check:
          "Dialog closed after Save without a validation-blocking error being observed."
      },
      {
        source_index: 2,
        coverage: "partially_covered",
        actual_check:
          "Verified a new Master Campaign record exists by searching for the generated campaign name; detailed target values are not yet re-read from the row/detail.",
        notes: ["The current executor proves creation by name but does not yet verify every submitted target value."]
      },
      {
        source_index: 3,
        coverage: "covered",
        actual_check:
          "After save, the dialog closed and the script returned to/searches within the Master Campaign List page."
      },
      {
        source_index: 4,
        coverage: "partially_covered",
        actual_check:
          "Verified the list displays the newly created Master Campaign name; basic info/target columns are not exhaustively asserted yet.",
        notes: ["Column-level assertions should be added before treating this as full original-case coverage."]
      },
      {
        source_index: 5,
        coverage: "not_covered",
        actual_check:
          "The current executor does not open detail/edit/allocation actions after creation.",
        notes: ["This expected result belongs in the R6 main-flow continuation and is not fully covered by the create smoke script."]
      }
    ],
    alignment_notes: [
      "Executor follows the original Add Master Campaign happy path, but current assertions are smoke-level.",
      "Do not treat R6-B7.2-TC01 as fully covered until target-column and further-action assertions are added."
    ]
  },
  "R6-B7.1-TC01": {
    contract_id: "R6-B7.1-TC01.master_campaign.search.v1",
    precondition_trace: [
      {
        source_index: 1,
        coverage: "covered",
        actual_check:
          "Uses the Master Campaign created by R6-B7.2-TC01 when run in sequence, or falls back to the original Summer Beauty Campaign 2024 precondition."
      }
    ],
    step_trace: [
      {
        source_index: 1,
        coverage: "covered",
        actual_check: "Focused/found the Master Campaign list search input."
      },
      {
        source_index: 2,
        coverage: "covered",
        actual_check: "Filled the search input with the generated campaign name or Summer."
      },
      {
        source_index: 3,
        coverage: "covered",
        actual_check: "Pressed Enter and waited for the table to refresh."
      }
    ],
    expected_trace: [
      {
        source_index: 1,
        coverage: "covered",
        actual_check:
          "Verified the expected campaign row is visible and checked visible campaign-name cells for non-matching names."
      },
      {
        source_index: 2,
        coverage: "covered",
        actual_check: "Read the search input value after search execution."
      }
    ],
    alignment_notes: [
      "Executor directly follows the original Master Campaign list search case.",
      "If product search intentionally matches other fields, expected result should be clarified in the source case."
    ]
  }
};

export function hasR6TraceContract(stableId: string): boolean {
  return stableId in CONTRACTS;
}

export function getR6TraceContract(stableId: string): CaseTraceContract | undefined {
  return CONTRACTS[stableId];
}

export function getR6TraceContractCoverage(
  testCase: NormalizedCase
): TraceCoverageSummary | undefined {
  const contract = getR6TraceContract(testCase.stable_id);
  if (!contract) return undefined;

  return buildTraceFromContract(testCase, contract).coverage_summary;
}

export function buildR6ExecutionTrace(testCase: NormalizedCase, evidencePath?: string) {
  const contract = getR6TraceContract(testCase.stable_id);
  if (!contract) {
    throw new Error(`Missing R6 traceability contract for ${testCase.stable_id}`);
  }

  return buildTraceFromContract(testCase, contract, evidencePath);
}
