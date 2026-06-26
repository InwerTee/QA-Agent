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
  prd_context?: NormalizedCasePrdContext;
}

export interface NormalizedCasePrdContext {
  knowledge_pack_path?: string;
  matched_module_keys: string[];
  matched_page_names: string[];
  matched_fields: string[];
  matched_actions: string[];
  notes: string[];
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
  test_case_ir?: TestCaseIR;
}

export type TestCaseIRVersion = "test_case_ir.v1";
export type TestCaseIRSourceType = "precondition" | "test_step" | "expected_result";
export type TestCaseIRNodeKind = "precondition" | "action" | "assertion";
export type TestCaseIRCapability = "executable" | "attemptable" | "manual" | "blocked";
export type TestCaseIRTranslationProvider = "rules" | "openai";
export type TestCaseIRTranslationStatus =
  | "rules_only"
  | "llm_disabled"
  | "llm_unconfigured"
  | "llm_accepted"
  | "llm_rejected"
  | "llm_error";

export type TestCaseIRType =
  | "precondition_page"
  | "precondition_existing_data"
  | "precondition_auth"
  | "precondition_general"
  | "navigate_to_page"
  | "navigate_back"
  | "click_target"
  | "click_row_action"
  | "click_table_link"
  | "click_dialog_action"
  | "fill_field"
  | "select_option"
  | "wait_for_update"
  | "observe_only"
  | "assert_visible_text"
  | "assert_navigation"
  | "assert_modal_visible"
  | "assert_modal_closed"
  | "assert_toast_visible"
  | "assert_table_filtered"
  | "assert_table_row_updated"
  | "assert_table_headers"
  | "assert_no_raw_null"
  | "assert_form_validation"
  | "assert_download_content"
  | "assert_manual_review";

export interface TestCaseIRNode {
  id: string;
  kind: TestCaseIRNodeKind;
  source_type: TestCaseIRSourceType;
  source_index: number;
  source_text: string;
  ir_type: TestCaseIRType;
  target?: string;
  value?: string;
  scope?: string;
  row?: string;
  confidence: ResultConfidence;
  capability: TestCaseIRCapability;
  reason: string;
  playwright_hint?: string;
}

export interface TestCaseIRTranslationMetadata {
  provider: TestCaseIRTranslationProvider;
  status: TestCaseIRTranslationStatus;
  model?: string;
  validation_errors: string[];
  validation_warnings: string[];
  notes: string[];
}

export interface TestCaseIR {
  version: TestCaseIRVersion;
  case_id: string;
  title: string;
  goal: string;
  preconditions: TestCaseIRNode[];
  actions: TestCaseIRNode[];
  assertions: TestCaseIRNode[];
  translation: TestCaseIRTranslationMetadata;
  notes: string[];
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
  prd_context?: PrdKnowledgeRunSummary;
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

export type PrdKnowledgeVersion = "prd_knowledge.v1";
export type PrdExtractionStatus = "available" | "partial" | "unavailable";

export interface PrdKnowledgePack {
  version: PrdKnowledgeVersion;
  release: string;
  title: string;
  generated_at: string;
  source_path?: string;
  extraction: {
    status: PrdExtractionStatus;
    method: "text_file" | "pdftotext" | "filename_only" | "case_context";
    character_count: number;
    notes: string[];
  };
  modules: PrdModuleKnowledge[];
  pages: PrdPageKnowledge[];
  fields: PrdFieldKnowledge[];
  actions: PrdActionKnowledge[];
  business_rules: string[];
  glossary: PrdGlossaryEntry[];
  case_alignment: {
    case_count: number;
    module_case_counts: Record<string, number>;
    unmatched_case_count: number;
  };
  notes: string[];
}

export interface PrdModuleKnowledge {
  name: string;
  key: string;
  aliases: string[];
  sites: Site[];
  evidence: string[];
}

export interface PrdPageKnowledge {
  name: string;
  module_key: string;
  aliases: string[];
  site?: Site;
  candidate_routes: string[];
  evidence: string[];
}

export interface PrdFieldKnowledge {
  name: string;
  module_key?: string;
  page_name?: string;
  aliases: string[];
  evidence: string[];
}

export interface PrdActionKnowledge {
  name: string;
  kind: string;
  module_key?: string;
  page_name?: string;
  evidence: string[];
}

export interface PrdGlossaryEntry {
  term: string;
  meaning: string;
  evidence?: string;
}

export interface PrdCaseContext {
  module?: PrdModuleKnowledge;
  pages: PrdPageKnowledge[];
  fields: PrdFieldKnowledge[];
  actions: PrdActionKnowledge[];
  confidence: ResultConfidence;
  evidence: string[];
}

export interface PrdKnowledgeRunSummary {
  source_path?: string;
  extraction_status: PrdExtractionStatus;
  modules: string[];
  pages: string[];
  notes: string[];
}

export type GroKnowledgeLayerVersion = "gro_knowledge_layer.v1";
export type KnowledgeGapSeverity = "blocker" | "warning" | "info";
export type KnowledgeGapCode =
  | "unknown_site"
  | "unknown_module"
  | "low_confidence_understanding"
  | "prd_context_missing"
  | "route_hint_missing"
  | "setup_data_required"
  | "recipe_missing"
  | "manual_action"
  | "blocked_action"
  | "low_confidence_action"
  | "manual_assertion"
  | "blocked_assertion"
  | "llm_unavailable"
  | "llm_rejected"
  | "llm_error";

export interface KnowledgeGap {
  code: KnowledgeGapCode;
  severity: KnowledgeGapSeverity;
  message: string;
  source_type?: TestCaseIRSourceType;
  source_index?: number;
  source_text?: string;
  recommended_next_action: string;
}

export interface CaseKnowledgeRecord {
  case_id: string;
  title: string;
  source: {
    workbook: string;
    sheet: string;
    row: number;
  };
  understanding: {
    site: Site;
    site_confidence: ResultConfidence;
    module: string;
    module_key: string;
    module_confidence: ResultConfidence;
    business_object: string;
    business_action: string;
    confidence: ResultConfidence;
    route_hints: {
      module_labels: string[];
      candidate_routes: string[];
      field_labels: string[];
      action_labels: string[];
    };
    evidence: string[];
  };
  required_capabilities: string[];
  preconditions: Array<{
    kind: string;
    text: string;
  }>;
  expected_assertions: Array<{
    kind: string;
    text: string;
  }>;
  test_case_ir: TestCaseIR;
  knowledge_gaps: KnowledgeGap[];
  notes: string[];
}

export interface GroKnowledgeLayerSummary {
  total_cases: number;
  cases_with_blockers: number;
  cases_with_warnings: number;
  by_site: Record<Site, number>;
  by_module: Record<string, number>;
  by_action: Record<string, number>;
  by_gap_code: Partial<Record<KnowledgeGapCode, number>>;
  llm: {
    enabled: boolean;
    model?: string;
    accepted: number;
    disabled: number;
    unconfigured: number;
    rejected: number;
    error: number;
    rules_only: number;
  };
}

export interface GroKnowledgeLayer {
  version: GroKnowledgeLayerVersion;
  release: string;
  title: string;
  generated_at: string;
  prd_context?: PrdKnowledgeRunSummary;
  summary: GroKnowledgeLayerSummary;
  cases: CaseKnowledgeRecord[];
  notes: string[];
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
  execution_readiness?: ExecutionReadinessDecision;
  pilot_output?: PilotCaseOutput;
  notes: string[];
}

export interface RunReport {
  run_id: string;
  release: string;
  agent_version: string;
  started_at: string;
  finished_at: string;
  case_results: CaseResult[];
  prd_context?: PrdKnowledgeRunSummary;
  execution_readiness?: ExecutionReadinessRunSummary;
  pilot_output?: PilotOutputSummary;
  created_test_data: TestDataRecord[];
  summary: Record<QaStatus, number>;
  failure_analysis?: FailureAnalysis;
}

export type PilotFailureCategory =
  | "passed"
  | "product_bug"
  | "setup_data_issue"
  | "environment_issue"
  | "agent_understanding_gap"
  | "recipe_missing"
  | "selector_or_script_issue"
  | "test_case_ambiguity"
  | "manual_review_required";

export interface PilotCaseOutput {
  category: PilotFailureCategory;
  category_label: string;
  developer_summary: string;
  expected_summary: string;
  actual_summary: string;
  recommended_action: string;
  evidence_path?: string;
  owner_hint: string;
}

export interface PilotOutputSummary {
  total_cases: number;
  attention_case_count: number;
  by_category: Record<PilotFailureCategory, number>;
  top_recommended_actions: string[];
}

export type ExecutionReadinessStatus = "ready" | "blocked" | "manual_review";
export type ExecutionReadinessMode = "conservative";
export type ExecutionReadinessSeverity = "blocker" | "warning";
export type ExecutionReadinessIssueCode =
  | "env_missing"
  | "setup_data_required"
  | "manual_case"
  | "unsupported_action"
  | "unsupported_assertion"
  | "low_confidence_action"
  | "ir_translation_untrusted";

export interface ExecutionReadinessIssue {
  code: ExecutionReadinessIssueCode;
  severity: ExecutionReadinessSeverity;
  source_type?: TestCaseIRSourceType;
  source_index?: number;
  source_text?: string;
  ir_type?: TestCaseIRType;
  capability?: TestCaseIRCapability;
  message: string;
}

export interface ExecutionReadinessDecision {
  mode: ExecutionReadinessMode;
  case_id: string;
  status: ExecutionReadinessStatus;
  can_execute: boolean;
  recommended_status: QaStatus;
  confidence: ResultConfidence;
  reason: string;
  total_preconditions: number;
  total_actions: number;
  total_assertions: number;
  runnable_action_count: number;
  automated_assertion_count: number;
  issues: ExecutionReadinessIssue[];
  notes: string[];
  test_case_ir: TestCaseIR;
}

export interface ExecutionReadinessBlockerSummary {
  code: ExecutionReadinessIssueCode;
  label: string;
  count: number;
  case_ids: string[];
}

export interface ExecutionReadinessRunSummary {
  mode: ExecutionReadinessMode;
  total_cases: number;
  ready: number;
  blocked: number;
  manual_review: number;
  by_recommended_status: Record<QaStatus, number>;
  top_blockers: ExecutionReadinessBlockerSummary[];
}

export type FailureCategoryCode =
  | "product_bug"
  | "env_missing"
  | "setup_data_missing"
  | "case_timeout"
  | "assertion_gap"
  | "form_field_resolution"
  | "dropdown_option_resolution"
  | "table_or_row_resolution"
  | "target_ambiguity"
  | "target_not_found"
  | "fill_value_missing"
  | "download_assertion_gap"
  | "navigation_or_page_discovery"
  | "unknown_agent_gap";

export interface FailureCluster {
  category: FailureCategoryCode;
  label: string;
  count: number;
  statuses: Partial<Record<QaStatus, number>>;
  case_ids: string[];
  sample_reason: string;
  recommended_next_action: string;
}

export interface FailureAnalysis {
  attention_case_count: number;
  clusters: FailureCluster[];
  next_actions: string[];
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
