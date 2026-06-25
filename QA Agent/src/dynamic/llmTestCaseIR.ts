import type { RuntimeConfig } from "../runtime/config.js";
import type { NormalizedCase, TestCaseIR, TestCaseIRTranslationMetadata } from "../types.js";
import type { DynamicActionPlan } from "./actionPlan.js";
import { buildTestCaseIR } from "./testCaseIR.js";
import { validateTestCaseIR, type TestCaseIRValidationResult } from "./testCaseIRValidation.js";

interface OpenAIResponsePayload {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

export interface TestCaseIRBuildResult {
  ir: TestCaseIR;
  validation: TestCaseIRValidationResult;
  notes: string[];
}

export interface BuildRuntimeTestCaseIROptions {
  openAIResponder?: (request: OpenAIIRRequest) => Promise<unknown>;
}

interface OpenAIIRRequest {
  apiKey: string;
  model: string;
  timeoutMs: number;
  payload: unknown;
}

export async function buildRuntimeTestCaseIR(
  testCase: NormalizedCase,
  plan: DynamicActionPlan,
  config: RuntimeConfig,
  options: BuildRuntimeTestCaseIROptions = {}
): Promise<TestCaseIRBuildResult> {
  const ruleIR = buildTestCaseIR(testCase, plan, translationMetadata({
    provider: "rules",
    status: config.llmEnabled ? "llm_unconfigured" : "llm_disabled",
    model: config.llmEnabled ? config.llmModel : undefined,
    notes: [
      config.llmEnabled
        ? "LLM translation was requested, but no OPENAI_API_KEY was configured; using rule-based IR."
        : "LLM translation is disabled; using rule-based IR."
    ]
  }));
  const ruleValidation = validateTestCaseIR(testCase, ruleIR);

  if (!config.llmEnabled) {
    return {
      ir: withValidation(ruleIR, ruleValidation),
      validation: ruleValidation,
      notes: ["LLM Test Case IR translator is disabled by QA_LLM_ENABLED."]
    };
  }

  if (!config.openaiApiKey) {
    return {
      ir: withValidation(ruleIR, ruleValidation),
      validation: ruleValidation,
      notes: ["OPENAI_API_KEY is missing; falling back to rule-based Test Case IR."]
    };
  }

  try {
    const payload = buildOpenAIPayload(testCase, plan, config.llmModel);
    const response = await (options.openAIResponder ?? requestOpenAIIR)({
      apiKey: config.openaiApiKey,
      model: config.llmModel,
      timeoutMs: config.llmTimeoutMs,
      payload
    });
    const candidate = parseIRResponse(response);
    const validation = validateTestCaseIR(testCase, candidate);

    if (!validation.ok) {
      const fallbackIR = buildTestCaseIR(testCase, plan, translationMetadata({
        provider: "rules",
        status: "llm_rejected",
        model: config.llmModel,
        validation_errors: validation.errors,
        validation_warnings: validation.warnings,
        notes: [
          "OpenAI generated a candidate IR, but validation rejected it; using rule-based IR.",
          ...validation.errors
        ]
      }));
      const fallbackValidation = validateTestCaseIR(testCase, fallbackIR);

      return {
        ir: withValidation(fallbackIR, fallbackValidation),
        validation: fallbackValidation,
        notes: [
          "OpenAI Test Case IR candidate was rejected by traceability validation.",
          ...validation.errors
        ]
      };
    }

    const acceptedIR = withValidation({
      ...candidate,
      translation: translationMetadata({
        provider: "openai",
        status: "llm_accepted",
        model: config.llmModel,
        validation_errors: validation.errors,
        validation_warnings: validation.warnings,
        notes: ["OpenAI generated this Test Case IR and local traceability validation accepted it."]
      }),
      notes: mergeNotes(candidate.notes, [
        "OpenAI generated this Test Case IR candidate.",
        "Local validation confirmed source text and source index alignment."
      ])
    }, validation);

    return {
      ir: acceptedIR,
      validation,
      notes: ["OpenAI Test Case IR candidate passed validation and will be used in traceability."]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackIR = buildTestCaseIR(testCase, plan, translationMetadata({
      provider: "rules",
      status: "llm_error",
      model: config.llmModel,
      validation_errors: [],
      validation_warnings: [],
      notes: [
        "OpenAI Test Case IR translation failed; using rule-based IR.",
        message
      ]
    }));
    const fallbackValidation = validateTestCaseIR(testCase, fallbackIR);

    return {
      ir: withValidation(fallbackIR, fallbackValidation),
      validation: fallbackValidation,
      notes: [`OpenAI Test Case IR translation failed and fell back to rules: ${message}`]
    };
  }
}

function buildOpenAIPayload(testCase: NormalizedCase, plan: DynamicActionPlan, model: string): unknown {
  return {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You translate Paragon QA test cases into a strict Test Case IR JSON object.",
              "Do not invent test steps, expected results, source indexes, or source text.",
              "Every original test step must have at least one action node.",
              "Every original expected result must have at least one assertion node.",
              "If a step cannot be automated safely, map it to observe_only/manual rather than guessing.",
              "Return only JSON matching the schema."
            ].join("\n")
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              allowed_ir_types: [
                "precondition_page",
                "precondition_existing_data",
                "precondition_auth",
                "precondition_general",
                "navigate_to_page",
                "navigate_back",
                "click_target",
                "click_row_action",
                "click_table_link",
                "click_dialog_action",
                "fill_field",
                "select_option",
                "wait_for_update",
                "observe_only",
                "assert_visible_text",
                "assert_navigation",
                "assert_modal_visible",
                "assert_modal_closed",
                "assert_toast_visible",
                "assert_table_filtered",
                "assert_table_row_updated",
                "assert_table_headers",
                "assert_no_raw_null",
                "assert_form_validation",
                "assert_download_content",
                "assert_manual_review"
              ],
              allowed_capabilities: ["executable", "attemptable", "manual", "blocked"],
              case: {
                stable_id: testCase.stable_id,
                title: testCase.title,
                goal: testCase.intent || testCase.title,
                source_workbook: testCase.source.workbook,
                source_sheet: testCase.sheet,
                source_row: testCase.source_row,
                precondition: testCase.precondition
                  ? [{ source_index: 1, source_text: testCase.precondition }]
                  : [],
                steps: testCase.steps.map((sourceText, index) => ({
                  source_index: index + 1,
                  source_text: sourceText
                })),
                expected_results: testCase.expected_result.map((sourceText, index) => ({
                  source_index: index + 1,
                  source_text: sourceText
                }))
              },
              rule_action_plan: {
                steps: plan.steps,
                expectedChecks: plan.expectedChecks
              }
            }, null, 2)
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "test_case_ir",
        strict: false,
        schema: testCaseIRSchema()
      }
    }
  };
}

async function requestOpenAIIR(request: OpenAIIRRequest): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${request.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request.payload)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`OpenAI Responses API returned ${response.status}: ${errorText.slice(0, 500)}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function parseIRResponse(response: unknown): TestCaseIR {
  const outputText = extractOutputText(response);
  if (!outputText) {
    throw new Error("OpenAI response did not contain output text.");
  }

  const parsed = JSON.parse(outputText) as TestCaseIR;
  return {
    ...parsed,
    translation: parsed.translation ?? translationMetadata({
      provider: "openai",
      status: "llm_accepted",
      validation_errors: [],
      validation_warnings: [],
      notes: []
    }),
    notes: Array.isArray(parsed.notes) ? parsed.notes : []
  };
}

function extractOutputText(response: unknown): string | undefined {
  const payload = response as OpenAIResponsePayload;
  if (typeof payload.output_text === "string") return payload.output_text;

  const chunks = payload.output?.flatMap((output) =>
    output.content?.flatMap((content) =>
      typeof content.text === "string" ? [content.text] : []
    ) ?? []
  ) ?? [];

  return chunks.join("").trim() || undefined;
}

function withValidation(ir: TestCaseIR, validation: TestCaseIRValidationResult): TestCaseIR {
  return {
    ...ir,
    translation: {
      ...ir.translation,
      validation_errors: validation.errors,
      validation_warnings: validation.warnings
    }
  };
}

function translationMetadata(input: Partial<TestCaseIRTranslationMetadata>): TestCaseIRTranslationMetadata {
  return {
    provider: input.provider ?? "rules",
    status: input.status ?? "rules_only",
    model: input.model,
    validation_errors: input.validation_errors ?? [],
    validation_warnings: input.validation_warnings ?? [],
    notes: input.notes ?? []
  };
}

function mergeNotes(left: string[] | undefined, right: string[]): string[] {
  return [...(Array.isArray(left) ? left : []), ...right];
}

function testCaseIRSchema(): Record<string, unknown> {
  const nodeSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "kind",
      "source_type",
      "source_index",
      "source_text",
      "ir_type",
      "confidence",
      "capability",
      "reason"
    ],
    properties: {
      id: { type: "string" },
      kind: { type: "string", enum: ["precondition", "action", "assertion"] },
      source_type: { type: "string", enum: ["precondition", "test_step", "expected_result"] },
      source_index: { type: "integer", minimum: 1 },
      source_text: { type: "string" },
      ir_type: {
        type: "string",
        enum: [
          "precondition_page",
          "precondition_existing_data",
          "precondition_auth",
          "precondition_general",
          "navigate_to_page",
          "navigate_back",
          "click_target",
          "click_row_action",
          "click_table_link",
          "click_dialog_action",
          "fill_field",
          "select_option",
          "wait_for_update",
          "observe_only",
          "assert_visible_text",
          "assert_navigation",
          "assert_modal_visible",
          "assert_modal_closed",
          "assert_toast_visible",
          "assert_table_filtered",
          "assert_table_row_updated",
          "assert_table_headers",
          "assert_no_raw_null",
          "assert_form_validation",
          "assert_download_content",
          "assert_manual_review"
        ]
      },
      target: { type: "string" },
      value: { type: "string" },
      scope: { type: "string" },
      row: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      capability: { type: "string", enum: ["executable", "attemptable", "manual", "blocked"] },
      reason: { type: "string" },
      playwright_hint: { type: "string" }
    }
  };

  return {
    type: "object",
    additionalProperties: false,
    required: ["version", "case_id", "title", "goal", "preconditions", "actions", "assertions", "notes"],
    properties: {
      version: { type: "string", enum: ["test_case_ir.v1"] },
      case_id: { type: "string" },
      title: { type: "string" },
      goal: { type: "string" },
      preconditions: { type: "array", items: nodeSchema },
      actions: { type: "array", items: nodeSchema },
      assertions: { type: "array", items: nodeSchema },
      notes: { type: "array", items: { type: "string" } }
    }
  };
}
