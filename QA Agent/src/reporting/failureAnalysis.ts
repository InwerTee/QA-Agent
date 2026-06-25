import type {
  CaseResult,
  FailureAnalysis,
  FailureCategoryCode,
  FailureCluster,
  QaStatus
} from "../types.js";

interface CategoryDefinition {
  category: FailureCategoryCode;
  label: string;
  recommended_next_action: string;
}

const CATEGORY_DEFINITIONS: Record<FailureCategoryCode, CategoryDefinition> = {
  product_bug: {
    category: "product_bug",
    label: "Potential product bug",
    recommended_next_action:
      "Review evidence and expected/actual mismatch before reporting to the product team."
  },
  env_missing: {
    category: "env_missing",
    label: "Environment or login missing",
    recommended_next_action:
      "Configure the missing site credentials/storage state before rerunning these cases."
  },
  setup_data_missing: {
    category: "setup_data_missing",
    label: "Precondition or setup data missing",
    recommended_next_action:
      "Create or seed the required prerequisite data before executing the case."
  },
  case_timeout: {
    category: "case_timeout",
    label: "Case timeout",
    recommended_next_action:
      "Inspect whether the page is stuck, too slow, or the agent is waiting on the wrong UI state."
  },
  assertion_gap: {
    category: "assertion_gap",
    label: "Expected result assertion gap",
    recommended_next_action:
      "Implement a stronger generic assertion so completed flows can become PASS or PRODUCT_BUG instead of MANUAL_REVIEW."
  },
  form_field_resolution: {
    category: "form_field_resolution",
    label: "Form field resolution gap",
    recommended_next_action:
      "Improve dialog/drawer/form label matching and field-value planning for this UI pattern."
  },
  dropdown_option_resolution: {
    category: "dropdown_option_resolution",
    label: "Dropdown or option resolution gap",
    recommended_next_action:
      "Improve select/multi-select/date-picker option discovery and option matching."
  },
  table_or_row_resolution: {
    category: "table_or_row_resolution",
    label: "Table row or row action resolution gap",
    recommended_next_action:
      "Improve table row context memory, first/same/different row handling, and row-scoped controls."
  },
  target_ambiguity: {
    category: "target_ambiguity",
    label: "Ambiguous target resolution",
    recommended_next_action:
      "Add scope-aware target ranking so the agent prefers the active dialog, drawer, table, tab, or module area."
  },
  target_not_found: {
    category: "target_not_found",
    label: "Target not found",
    recommended_next_action:
      "Teach the resolver more synonyms/selectors for the page control, or improve page discovery if it is on the wrong page."
  },
  fill_value_missing: {
    category: "fill_value_missing",
    label: "Fill value missing",
    recommended_next_action:
      "Improve action planning so generic steps like changing a field generate a safe temporary value."
  },
  download_assertion_gap: {
    category: "download_assertion_gap",
    label: "Download/export assertion gap",
    recommended_next_action:
      "Add download capture and file-content parsing before claiming export-related cases as passed or failed."
  },
  navigation_or_page_discovery: {
    category: "navigation_or_page_discovery",
    label: "Navigation or page discovery gap",
    recommended_next_action:
      "Improve module route hints, menu discovery, and page readiness checks for this module."
  },
  unknown_agent_gap: {
    category: "unknown_agent_gap",
    label: "Unclassified agent capability gap",
    recommended_next_action:
      "Inspect the evidence screenshot and failure reason, then add a more specific generic capability or category."
  }
};

export function analyzeRunFailures(results: CaseResult[]): FailureAnalysis {
  const attentionCases = results.filter((result) => result.status !== "PASS");
  const grouped = new Map<FailureCategoryCode, CaseResult[]>();

  for (const result of attentionCases) {
    const category = classifyFailure(result);
    const cases = grouped.get(category) ?? [];
    cases.push(result);
    grouped.set(category, cases);
  }

  const clusters = Array.from(grouped.entries())
    .map(([category, cases]) => buildCluster(category, cases))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  return {
    attention_case_count: attentionCases.length,
    clusters,
    next_actions: clusters.slice(0, 3).map((cluster) => cluster.recommended_next_action)
  };
}

function classifyFailure(result: CaseResult): FailureCategoryCode {
  if (result.status === "PRODUCT_BUG") return "product_bug";
  if (result.status === "ENV_BLOCKED") return "env_missing";
  if (result.status === "SETUP_BLOCKED") return "setup_data_missing";
  if (result.failure_reason?.includes("Case timeout exceeded")) return "case_timeout";

  const executionText = normalize(
    [
      result.failure_reason,
      result.actual_result,
      result.classification_reason,
      ...result.notes,
      result.traceability.raw_test_steps,
      ...result.traceability.step_trace.map((entry) => entry.actual_check),
      ...result.traceability.step_trace.map((entry) => entry.source_text)
    ].join(" ")
  );
  const assertionText = normalize(
    [
      result.actual_result,
      result.classification_reason,
      result.traceability.raw_expected_result,
      ...result.expected_result,
      ...result.traceability.expected_trace.map((entry) => entry.actual_check),
      ...result.traceability.expected_trace.map((entry) => entry.source_text),
      ...result.traceability.expected_trace.flatMap((entry) => entry.notes)
    ].join(" ")
  );

  if (result.status === "MANUAL_REVIEW") {
    if (/download|exported file|downloaded file|generated file/.test(`${executionText} ${assertionText}`)) {
      return "download_assertion_gap";
    }

    return "assertion_gap";
  }

  if (/could not find a visible form field|form field labeled|observed form labels/.test(executionText)) {
    return "form_field_resolution";
  }

  if (/no clear value|has no clear value|value to enter/.test(executionText)) {
    return "fill_value_missing";
  }

  if (/could not find option|opened .* could not find option|select|dropdown|multi select|date picker|date-picker/.test(executionText)) {
    return "dropdown_option_resolution";
  }

  if (/row|same row|different row|table|operation column|hyperlink|data-row/.test(executionText)) {
    return "table_or_row_resolution";
  }

  if (/multiple page elements matched|ambiguous|similar confidence/.test(executionText)) {
    return "target_ambiguity";
  }

  if (/could not identify a strong enough matching page element|target not found|could not locate|not find a visible/.test(executionText)) {
    return "target_not_found";
  }

  if (/page discovery|candidate route|wrong page|page did not render|not observable|navigate|navigation/.test(executionText)) {
    return "navigation_or_page_discovery";
  }

  return "unknown_agent_gap";
}

function buildCluster(category: FailureCategoryCode, cases: CaseResult[]): FailureCluster {
  const definition = CATEGORY_DEFINITIONS[category];
  const statuses: Partial<Record<QaStatus, number>> = {};

  for (const result of cases) {
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
  }

  return {
    category,
    label: definition.label,
    count: cases.length,
    statuses,
    case_ids: cases.map((result) => result.stable_id),
    sample_reason: sampleReason(cases[0]),
    recommended_next_action: definition.recommended_next_action
  };
}

function sampleReason(result: CaseResult): string {
  return compact(
    result.failure_reason ||
      result.classification_reason ||
      result.actual_result ||
      result.notes[0] ||
      "No sample reason was recorded."
  );
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalize(value: string): string {
  return compact(value).toLowerCase();
}
