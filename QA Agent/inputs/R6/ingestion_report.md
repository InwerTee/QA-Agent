# Ingestion Report - R6

## Input

- Input package: `input-packages/R6-sample`
- PRD: `input-packages/R6-sample/PRD - R6 Master Campaign.pdf`
- Test cases: `input-packages/R6-sample/R6.xlsx`
- Sheet: `Sheet1`
- Header row: 8

## Output Summary

- Release: R6
- Title: Master Campaign
- Normalized cases: 53
- Ready for current executor: 2
- Needs executor / selector mapping: 48
- Manual review suggested: 3

## Scenario Groups

- B7.1 Master Campaign List Page: 17 case(s)
- B7.2 Add Master Campaign: 4 case(s)
- B7.3 Edit Master Campaign: 5 case(s)
- B7.4 Allocate Master Campaign Target: 8 case(s)
- B7.5 Master Campaign Detail Dashboard: 19 case(s)

## Ready Case IDs

- R6-B7.1-TC01 - Search by Master Campaign Name (Success)
- R6-B7.2-TC01 - Create Master Campaign with All Fields

## Notes

- The parser recognized cases by the table header columns, not by hard-coded row numbers.
- B7.x section rows are used to build stable IDs like `R6-B7.2-TC01`.
- Historical Excel status/evidence is preserved as source metadata only.
- Cases outside the current R6 pilot executor are intentionally marked `needs_mapping` or `manual_review`.
