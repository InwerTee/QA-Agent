# R6 Automation Triage

Generated: 2026-06-25T07:21:11.233Z

## Summary

- Total cases: 53
- Priority: P0 6, P1 11, P2 33, P3 3
- Readiness: implemented 3, candidate 19, needs fixture/control 28, manual review 3
- Complexity: low 2, medium 17, high 34

## Proposed R6 Main Flow

| Case | Source Row | Contract | Priority | Readiness | Executor | Next Action |
| --- | ---: | --- | --- | --- | --- | --- |
| `R6-B7.2-TC01` Create Master Campaign with All Fields | 28 | yes | P0 | implemented | `master_campaign.create` | Keep in smoke set and use as dependency seed for later cases. |
| `R6-B7.1-TC01` Search by Master Campaign Name (Success) | 10 | yes | P0 | implemented | `master_campaign.list.search` | Keep in smoke set and use as dependency seed for later cases. |
| `R6-B7.3-TC01` Edit Basic Information Only | 33 | yes | P0 | implemented | `master_campaign.edit` | Keep in smoke set and use as dependency seed for later cases. |
| `R6-B7.4-TC01` Open Add Allocation (No Existing Allocation) | 39 | no | P0 | needs_fixture | `master_campaign.allocation` | Create fixture/control first, then map selectors for master_campaign.allocation. Needs Master Campaign allocation fixture with known pillar and target data. |
| `R6-B7.4-TC03` Save Allocation Successfully | 41 | no | P0 | candidate | `master_campaign.allocation` | Map selectors and add executor branch for master_campaign.allocation. |
| `R6-B7.5-TC01` Open Master Campaign Detail Dashboard | 48 | no | P0 | needs_fixture | `master_campaign.detail.dashboard` | Create fixture/control first, then map selectors for master_campaign.detail.dashboard. Needs Master Campaign allocation fixture with known pillar and target data. |

## Next Automation Candidates

| Case | Source Row | Contract | Priority | Readiness | Executor | Next Action |
| --- | ---: | --- | --- | --- | --- | --- |
| `R6-B7.4-TC03` Save Allocation Successfully | 41 | no | P0 | candidate | `master_campaign.allocation` | Map selectors and add executor branch for master_campaign.allocation. |
| `R6-B7.4-TC01` Open Add Allocation (No Existing Allocation) | 39 | no | P0 | needs_fixture | `master_campaign.allocation` | Create fixture/control first, then map selectors for master_campaign.allocation. Needs Master Campaign allocation fixture with known pillar and target data. |
| `R6-B7.5-TC01` Open Master Campaign Detail Dashboard | 48 | no | P0 | needs_fixture | `master_campaign.detail.dashboard` | Create fixture/control first, then map selectors for master_campaign.detail.dashboard. Needs Master Campaign allocation fixture with known pillar and target data. |
| `R6-B7.1-TC02` Search with No Results | 11 | no | P1 | candidate | `master_campaign.list.search` | Map selectors and add executor branch for master_campaign.list.search. |
| `R6-B7.1-TC06` Reset Filter | 15 | no | P1 | candidate | `master_campaign.list.filter` | Map selectors and add executor branch for master_campaign.list.filter. |
| `R6-B7.1-TC11` Cancel Action (Do Not Apply Changes) | 20 | no | P1 | candidate | `master_campaign.list.column_settings` | Map selectors and add executor branch for master_campaign.list.column_settings. |
| `R6-B7.2-TC03` Missing Required Basic Information | 30 | no | P1 | candidate | `master_campaign.create.validation` | Map selectors and add executor branch for master_campaign.create.validation. |
| `R6-B7.2-TC04` Invalid Numeric Input in Target Fields | 31 | no | P1 | candidate | `master_campaign.create.validation` | Map selectors and add executor branch for master_campaign.create.validation. |
| `R6-B7.3-TC05` Invalid Numeric Input in Target Fields | 37 | no | P1 | candidate | `master_campaign.edit.validation` | Map selectors and add executor branch for master_campaign.edit.validation. |
| `R6-B7.4-TC06` Over-Allocation – Save Disabled | 44 | no | P1 | candidate | `master_campaign.allocation.validation` | Map selectors and add executor branch for master_campaign.allocation.validation. |

## Executor Buckets

- `master_campaign.list.filter`: 5
- `master_campaign.allocation.validation`: 5
- `master_campaign.list.pagination`: 5
- `master_campaign.detail.top_content`: 5
- `master_campaign.detail.content_by_type`: 5
- `master_campaign.list.column_settings`: 4
- `master_campaign.detail.filters`: 4
- `master_campaign.edit`: 3
- `master_campaign.allocation`: 3
- `master_campaign.create.validation`: 3
- `master_campaign.detail.metric_assertions`: 3
- `master_campaign.list.search`: 2
- `master_campaign.edit.validation`: 2
- `master_campaign.create`: 1
- `master_campaign.detail.dashboard`: 1
- `master_campaign.list.table_assertions`: 1
- `master_campaign.detail.cross_navigation`: 1

## Notes

- P0 is the proposed R6 main flow: create, find, edit, allocate, and open detail.
- `implemented` means the current Playwright executor already supports that case.
- `candidate` means the case looks UI-automatable once selectors are mapped.
- `needs_fixture` means the agent needs deterministic seed data, API setup, account state, or network/backend control before a browser script can make a reliable judgment.
- `manual_review` means the case needs human decision on evidence strategy or whether automation is worth it.
