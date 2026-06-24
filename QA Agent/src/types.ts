export type Site = "admin" | "creator" | "agency";

export type QaStatus =
  | "PASS"
  | "PRODUCT_BUG"
  | "SETUP_BLOCKED"
  | "SCRIPT_BLOCKED"
  | "ENV_BLOCKED"
  | "MANUAL_REVIEW";

export interface CaseDependency {
  stable_id: string;
  reason: string;
}

export interface CaseSource {
  workbook: string;
  historical_status?: string;
  historical_evidence?: string;
}

export interface NormalizedCase {
  stable_id: string;
  release: string;
  sheet: string;
  source_row: number;
  scenario_group: string;
  case_no: number;
  scenario: string;
  title: string;
  site: Site;
  module: string;
  type: string;
  intent: string;
  precondition: string;
  steps: string[];
  expected_result: string[];
  dependencies: CaseDependency[];
  source: CaseSource;
}

export interface SetupPlan {
  case_id: string;
  precondition: string;
  dependency_case_ids: string[];
  can_attempt_automatically: boolean;
  notes: string[];
}

export interface CaseResult {
  stable_id: string;
  title: string;
  status: QaStatus;
  precondition_result: string;
  actual_result: string;
  expected_result: string[];
  failure_reason?: string;
  evidence_path?: string;
  created_test_data: TestDataRecord[];
  depends_on_data: TestDataReference[];
  notes: string[];
}

export interface RunReport {
  run_id: string;
  release: string;
  started_at: string;
  finished_at: string;
  case_results: CaseResult[];
  created_test_data: TestDataRecord[];
  summary: Record<QaStatus, number>;
}

export interface ExecutionMemory {
  createdMasterCampaign?: TestDataRecord;
}

export interface TestDataRecord {
  data_id: string;
  data_type: "master_campaign" | "campaign" | "creator" | "kr_request" | "lock_stock" | "unknown";
  display_name: string;
  created_by_case: string;
  used_by_cases: string[];
  environment: string;
  evidence_path?: string;
  cleanup_status: "not_applicable" | "not_attempted" | "pending" | "deleted" | "failed";
  notes: string[];
}

export interface TestDataReference {
  data_id: string;
  data_type: TestDataRecord["data_type"];
  display_name: string;
  source_case: string;
}
