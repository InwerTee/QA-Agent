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

当前 R6 MVP 已经补上了第一个 `prepare` 阶段:它能从本地 R6 input package 读取 PRD + test case Excel,生成 `inputs/R6/cases.normalized.json`。执行层目前接了三条 R6 pilot case,其他 case 会先被标记为 `needs_mapping` 或 `manual_review`。

v0.3 在 `prepare` 之后增加了 `triage` 阶段和 traceability guard:它不跑浏览器,而是把 normalized cases 分成主流程、下一批自动化候选、需要 fixture/control 的 case、以及建议人工复核的 case;同时要求 normalized case 保留 Excel 原文和 source row,已经实现 executor 的 case 必须声明 traceability contract,把原始 test steps / expected results 映射到自动化动作和断言。未覆盖或部分覆盖的 expected result 必须显式标记,不能因为脚本跑通就自动当作完整通过原 case。

v0.4 把 R6 主流程从 `create -> search` 扩展到 `create -> search -> edit basic information`,新增 `R6-B7.3-TC01` executor。同一轮 run 会共享一个 Admin browser session,减少重复浏览器启动和登录上下文初始化。B7.3 仍是 partial coverage:会从列表 Operation column 进入 Edit 弹窗并验证 Basic Information 的 Brief Description 更新,但 target invariance 和 Updated Date 刷新仍需后续补断言。

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
npm run qa -- triage R6 --out ./inputs/R6
npm run qa -- run R6 --case R6-B7.2-TC01 --case R6-B7.1-TC01 --case R6-B7.3-TC01
```

## 中间输入

agent 不应该每次直接从 Excel 行里执行。它应该先生成标准化文件:

```text
inputs/<release-or-run-id>/
  manifest.json
  cases.normalized.json
  ingestion_report.md
  automation_map.json
  triage_report.md
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
        ↓ triage
automation_map.json / triage_report.md
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
- source workbook / sheet / row
- assertion trace from original expected result to automated check
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
