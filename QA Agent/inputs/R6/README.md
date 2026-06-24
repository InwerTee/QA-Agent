# R6 Input Notes

This folder contains a hand-picked normalized input fixture for the first Gro QA Agent MVP.

It is not the future user-facing input mode. In the final workflow, users should provide a PRD document and a test case document; the agent should parse them and generate a folder like this automatically.

Source files remain in the reference document folder:

- `../参考文档/Internal Testing for UAT Gro.xlsx`
- `../参考文档/现有PRD/PRD - R6 Master Campaign.pdf`

`cases.normalized.json` is derived from the R6 sheet and gives the agent stable IDs that do not depend on Excel row numbers.
