export type Site = "admin" | "creator" | "agency";

export type QaStatus =
  | "PASS"
  | "PRODUCT_BUG"
  | "SETUP_BLOCKED"
  | "AGENT_BLOCKED"
  | "SCRIPT_BLOCKED"
  | "ENV_BLOCKED"
  | "MANUAL_REVIEW";

export type ResultConfidence = "high" | "medium" | "low";

export type AutomationStatus = "ready" | "needs_mapping" | "manual_review";
export type TriagePriority = "P0" | "P1" | "P2" | "P3";
export type TriageReadiness = "implemented" | "candidate" | "needs_fixture" | "manual_review";
export type TriageComplexity = "low" | "medium" | "high";
export type TraceCoverageStatus =
  | "covered"
  | "partially_covered"
  | "not_covered"
  | "not_executed";

export interface CaseDependency {
  stable_id: string;
  reason: string;
}

export interface CaseSource {
  workbook: string;
  historical_status?: string;
  historical_evidence?: string;
  historical_note?: string;
}

export interface RawCaseSource {
  scenario: string;
  test_case: string;
  pre_requisite: string;
  test_steps: string;
  expected_result: string;
  type: string;
  status?: string;
  evidence?: string;
  note?: string;
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
  automation_status: AutomationStatus;
  source: CaseSource;
  raw_source: RawCaseSource;
}

export interface TraceEntry {
  source_type: "precondition" | "test_step" | "expected_result";
  source_index: number;
  source_text: string;
  coverage: TraceCoverageStatus;
  actual_check: string;
  evidence_path?: string;
  notes: string[];
}

export interface TraceCoverageSummary {
  covered: number;
  partially_covered: number;
  not_covered: number;
  not_executed: number;
}

export interface CaseExecutionTrace {
  source_workbook: string;
  source_sheet: string;
  source_row: number;
  raw_test_case: string;
  raw_pre_requisite: string;
  raw_test_steps: string;
  raw_expected_result: string;
  contract_id?: string;
  precondition_trace: TraceEntry[];
  step_trace: TraceEntry[];
  expected_trace: TraceEntry[];
  coverage_summary: TraceCoverageSummary;
  alignment_notes: string[];
}

export interface CaseTriageTraceability {
  source_workbook: string;
  source_sheet: string;
  source_row: number;
  raw_test_case: string;
  raw_step_count: number;
  raw_expected_count: number;
  has_executor_contract: boolean;
  contract_coverage?: TraceCoverageSummary;
}

export interface CaseTriage {
  stable_id: string;
  title: string;
  scenario_group: string;
  priority: TriagePriority;
  readiness: TriageReadiness;
  complexity: TriageComplexity;
  executor_key: string;
  main_flow_order?: number;
  required_capabilities: string[];
  depends_on_case_ids: string[];
  blockers: string[];
  rationale: string[];
  traceability: CaseTriageTraceability;
  next_action: string;
}

export interface AutomationMap {
  release: string;
  generated_at: string;
  total_cases: number;
  summary: {
    by_priority: Record<TriagePriority, number>;
    by_readiness: Record<TriageReadiness, number>;
    by_complexity: Record<TriageComplexity, number>;
  };
  main_flow: string[];
  next_candidate_ids: string[];
  cases: CaseTriage[];
}

export interface SetupPlan {
  case_id: string;
  precondition: string;
  dependency_case_ids: string[];
  can_attempt_automatically: boolean;
  notes: string[];
}

export interface CaseResult {
  run_id: string;
  case_execution_id: string;
  stable_id: string;
  title: string;
  status: QaStatus;
  result_confidence?: ResultConfidence;
  classification_reason?: string;
  precondition_result: string;
  actual_result: string;
  expected_result: string[];
  failure_reason?: string;
  evidence_path?: string;
  created_test_data: TestDataRecord[];
  depends_on_data: TestDataReference[];
  traceability: CaseExecutionTrace;
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
  run_id: string;
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
  run_id: string;
  data_type: TestDataRecord["data_type"];
  display_name: string;
  source_case: string;
}
