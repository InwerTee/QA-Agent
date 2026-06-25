import { readFile } from "node:fs/promises";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export async function planWithOpenAI(input) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (input.offline || !apiKey) {
    return offlinePlan(input);
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.5";
  const system = await readFile(new URL("../../skills/gro-qa-agent-ai/SKILL.md", import.meta.url), "utf8");
  const response = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: system
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                task: "Create a guarded browser command plan for this Gro QA test case.",
                prd_context: input.prdText,
                test_case: input.caseData
              }, null, 2)
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_object"
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI planning failed (${response.status}): ${body}`);
  }

  const body = await response.json();
  const text = extractOutputText(body);
  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }

  return JSON.parse(text);
}

function extractOutputText(body) {
  if (typeof body.output_text === "string") return body.output_text;

  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
      if (content.type === "text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return undefined;
}

function offlinePlan(input) {
  const testCase = input.caseData;
  const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
  const expected = Array.isArray(testCase.expected_result) ? testCase.expected_result : [];

  return {
    version: "qa_agent_ai_plan.v1",
    case_id: testCase.case_id || "unknown-case",
    objective: testCase.title || "Plan one Gro QA case.",
    status: "manual_review",
    blockers: [
      {
        type: "env",
        reason: "OPENAI_API_KEY is not configured, so this is an offline template plan."
      }
    ],
    commands: [
      {
        id: "cmd-1",
        type: "open",
        source: {
          kind: "precondition",
          index: 1,
          text: testCase.precondition || "Open Gro staging."
        },
        args: {
          url: process.env.GRO_BASE_URL || "https://staging-gro.paradev.io"
        },
        expected_observation: "Gro staging opens in a controlled browser session.",
        safety: "safe"
      },
      {
        id: "cmd-2",
        type: "snapshot",
        source: {
          kind: "test_step",
          index: 1,
          text: steps[0] || "Take an initial page snapshot."
        },
        args: {},
        expected_observation: "A page snapshot is captured before deciding the next action.",
        safety: "safe"
      }
    ],
    final_assertions: expected.map((text, index) => ({
      source: {
        kind: "expected_result",
        index: index + 1,
        text
      },
      check: `Manual review needed for expected result: ${text}`,
      automation: "manual"
    }))
  };
}
