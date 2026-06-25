import type { AutomationStatus, CaseDependency, NormalizedCase } from "../../src/types.js";

interface FixtureCaseInput {
  stableId: string;
  sourceRow: number;
  scenarioGroup: string;
  caseNo: number;
  title: string;
  precondition: string;
  steps: string[];
  expectedResult: string[];
  dependencies?: CaseDependency[];
  automationStatus?: AutomationStatus;
  type?: string;
}

export function makeR6FixtureCases(): NormalizedCase[] {
  return [
    r6Case({
      stableId: "R6-B7.2-TC01",
      sourceRow: 28,
      scenarioGroup: "B7.2 Add Master Campaign",
      caseNo: 1,
      title: "Create Master Campaign with All Fields",
      precondition: "User is on the Master Campaign List Page. The Add Master Campaign button is visible.",
      steps: [
        "User clicks the Add Master Campaign button.",
        "User waits for the Create Master Campaign dialog.",
        "User fills required Basic Information including name, Brand, Period, and Brief Description.",
        "User fills visible target fields with valid numeric values.",
        "User confirms the Save button can be used.",
        "User clicks Save."
      ],
      expectedResult: [
        "Create dialog closes without validation errors.",
        "A new Master Campaign record is created with the entered information.",
        "User returns to the Master Campaign List page.",
        "The new Master Campaign appears in the list.",
        "Further actions are available from the created Master Campaign row."
      ],
      automationStatus: "ready"
    }),
    r6Case({
      stableId: "R6-B7.1-TC01",
      sourceRow: 18,
      scenarioGroup: "B7.1 Master Campaign List",
      caseNo: 1,
      title: "Search Master Campaign by Campaign Name",
      precondition:
        "User is on the Master Campaign List Page. At least one master campaign named Summer Beauty Campaign 2024 exists in the table.",
      steps: [
        "User focuses the Master Campaign search input.",
        "User searches for Summer.",
        "User presses Enter and waits for the list to refresh."
      ],
      expectedResult: [
        "Only Master Campaign records matching the search keyword are shown.",
        "The search input keeps the entered search value."
      ],
      dependencies: [{ stable_id: "R6-B7.2-TC01", reason: "Needs a Master Campaign record to search." }],
      automationStatus: "ready"
    }),
    r6Case({
      stableId: "R6-B7.3-TC01",
      sourceRow: 38,
      scenarioGroup: "B7.3 Edit Master Campaign",
      caseNo: 1,
      title: "Edit Basic Information Only",
      precondition: "User has an existing Master Campaign created from the add flow.",
      steps: [
        "User opens the Edit Master Campaign page from the Master Campaign detail page.",
        "User verifies existing Basic Information and target fields are pre-filled.",
        "User updates only Brief Description in Basic Information.",
        "User does not change target values.",
        "User confirms the Update button can be used.",
        "User clicks Update."
      ],
      expectedResult: [
        "The updated Brief Description is saved.",
        "User returns to Master Campaign detail after saving.",
        "The detail page shows the new Brief Description.",
        "Dashboard Overview and Pillar Contribution target values remain unchanged.",
        "Updated Date or Update Information refreshes after save."
      ],
      dependencies: [{ stable_id: "R6-B7.2-TC01", reason: "Needs a Master Campaign record to edit." }],
      automationStatus: "ready"
    }),
    r6Case({
      stableId: "R6-B7.4-TC01",
      sourceRow: 48,
      scenarioGroup: "B7.4 Master Campaign Allocation",
      caseNo: 1,
      title: "Open allocation with existing allocation and pillar mappings",
      precondition: "User has a Master Campaign with existing allocation and known pillar mappings.",
      steps: ["User opens Master Campaign allocation.", "User reviews existing allocation values."],
      expectedResult: ["Existing allocation values are displayed for the selected Master Campaign."],
      dependencies: [{ stable_id: "R6-B7.2-TC01", reason: "Needs a Master Campaign record." }]
    }),
    r6Case({
      stableId: "R6-B7.4-TC03",
      sourceRow: 52,
      scenarioGroup: "B7.4 Master Campaign Allocation",
      caseNo: 3,
      title: "Save allocation successfully",
      precondition: "User has a Master Campaign ready for allocation.",
      steps: ["User enters valid allocation values.", "User saves the allocation."],
      expectedResult: ["Allocation save succeeds and a success message is shown."],
      dependencies: [{ stable_id: "R6-B7.2-TC01", reason: "Needs a Master Campaign record." }]
    }),
    r6Case({
      stableId: "R6-B7.5-TC01",
      sourceRow: 60,
      scenarioGroup: "B7.5 Master Campaign Detail",
      caseNo: 1,
      title: "Open Master Campaign Detail Dashboard",
      precondition: "User has a Master Campaign with dashboard metrics.",
      steps: ["User opens the Master Campaign detail dashboard."],
      expectedResult: ["The detail dashboard displays KPI, GMV, views, contents, and creators metrics."],
      dependencies: [{ stable_id: "R6-B7.2-TC01", reason: "Needs a Master Campaign record." }]
    })
  ];
}

function r6Case(input: FixtureCaseInput): NormalizedCase {
  const type = input.type ?? "Positive";

  return {
    stable_id: input.stableId,
    release: "R6",
    sheet: "R6",
    source_row: input.sourceRow,
    scenario_group: input.scenarioGroup,
    case_no: input.caseNo,
    scenario: input.scenarioGroup,
    title: input.title,
    site: "admin",
    module: "Master Campaign",
    type,
    intent: input.title,
    precondition: input.precondition,
    steps: input.steps,
    expected_result: input.expectedResult,
    dependencies: input.dependencies ?? [],
    automation_status: input.automationStatus ?? "needs_mapping",
    source: {
      workbook: "R6.xlsx"
    },
    raw_source: {
      scenario: input.scenarioGroup,
      test_case: input.title,
      pre_requisite: input.precondition,
      test_steps: input.steps.join("\n"),
      expected_result: input.expectedResult.join("\n"),
      type
    }
  };
}
