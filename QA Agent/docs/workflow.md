# QA Agent Workflow

本文档描述未来同事使用新版 QA Agent 时的目标 workflow。`参考文档/` 只是当前开发阶段的本地参考库,不属于正式 agent 输入。

当前仓库中的 `inputs/R6/` 是从本地 R6 input package 生成出来的开发样例,用于验证 agent 的最小闭环。它不是未来同事使用 agent 时需要手动维护的输入格式。

## 目标使用方式

同事提供本次 release 的两个核心输入:

```text
PRD 文档
Paragon test case 文档
```

agent 负责:

1. 读取 PRD,建立本次 release 的业务上下文。
2. 读取 test case 文档,提取 case intent、precondition、test steps、expected result。
3. 生成稳定的 case id 和标准化 case JSON。
4. 根据 precondition 准备或复用测试数据。
5. 在 Gro staging 执行测试步骤。
6. 对比 actual result 和 expected result。
7. 输出报告、evidence 和测试数据 lineage。

当前 R6 MVP 已经补上了第一个 `prepare` 阶段:它能从本地 R6 input package 读取 PRD + test case Excel,生成 `inputs/R6/cases.normalized.json`。执行层目前仍只接了两条 R6 pilot case,其他 case 会先被标记为 `needs_mapping` 或 `manual_review`。

## 正式输入

建议未来每次运行输入一个 input package:

```text
input-packages/<release-or-run-id>/
  prd.pdf 或 prd.docx
  test-cases.xlsx
  scope.json
```

`scope.json` 用来告诉 agent 本次真正要跑什么,例如:

```json
{
  "release": "R6",
  "test_case_sheet": "R6 - Master Campaign",
  "case_ids": ["R6-B7.2-TC01", "R6-B7.1-TC01"]
}
```

未来也可以支持用户直接在命令行传入:

```bash
npm run qa -- prepare ./input-packages/R6-sample --release R6 --out ./inputs/R6
npm run qa -- run R6 --case R6-B7.2-TC01 --case R6-B7.1-TC01
```

## 中间输入

agent 不应该每次直接从 Excel 行里执行。它应该先生成标准化文件:

```text
inputs/<release-or-run-id>/
  manifest.json
  cases.normalized.json
  ingestion_report.md
```

`cases.normalized.json` 是执行层真正读取的输入。这样做的原因:

- PRD / Excel 格式可能变化。
- Excel 行号不稳定。
- 每条 case 需要稳定 ID。
- precondition、steps、expected result 需要结构化。
- 后续报告和 evidence 需要绑定到同一 case id。

换句话说:

```text
prd.pdf + test-cases.xlsx
        ↓ prepare
manifest.json / cases.normalized.json / ingestion_report.md
        ↓ run
report.json / report.md / evidence
```

## 输出

每次运行输出:

```text
reports/runs/<run-id>/
  report.json
  report.md
  evidence screenshots / traces
```

报告至少包含:

- case status
- actual result
- expected result
- failure reason
- evidence path
- created test data
- depends on test data

## 测试数据 Lineage

如果 agent 在 Gro 中创建测试数据,报告必须记录:

```json
{
  "data_type": "master_campaign",
  "display_name": "QA-R6-MC-1234567",
  "created_by_case": "R6-B7.2-TC01",
  "used_by_cases": ["R6-B7.1-TC01"],
  "cleanup_status": "not_attempted"
}
```

这样同事在 Gro 里看到测试数据时,可以反查是哪次 run、哪条 case 创建的。

## 复杂度边界

agent 可以有多个内部模块,但用户入口必须简单:

```text
输入 PRD + 测试用例
选择要跑的 release / cases
得到报告
```

内部复杂度只应该服务这件事。不要让用户理解 parser、executor、knowledge base、storage state 等内部细节。
