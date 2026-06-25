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

早期 MVP 已经补上了第一个 `prepare` 阶段:它能从本地 input package 读取 PRD + test case Excel,生成标准化 case JSON。这个阶段的价值是证明输入解析和结果回填闭环,不是把某个 release 变成长期架构中心。

v0.3 在 `prepare` 之后增加了 `triage` 阶段和 traceability guard:它不跑浏览器,而是把 normalized cases 分成主流程、下一批自动化候选、需要 fixture/control 的 case、以及建议人工复核的 case;同时要求 normalized case 保留 Excel 原文和 source row,已经实现 executor 的 case 必须声明 traceability contract,把原始 test steps / expected results 映射到自动化动作和断言。未覆盖或部分覆盖的 expected result 必须显式标记,不能因为脚本跑通就自动当作完整通过原 case。

v0.4 把 R6 主流程从 `create -> search` 扩展到 `create -> search -> edit basic information`,新增 `R6-B7.3-TC01` executor。同一轮 run 会共享一个 Admin browser session,减少重复浏览器启动和登录上下文初始化。B7.3 仍是 partial coverage:会从列表 Operation column 进入 Edit 弹窗并验证 Basic Information 的 Brief Description 更新,但 target invariance 和 Updated Date 刷新仍需后续补断言。

v0.5 增加 `export-results`:它把某次 run 的工程化 `report.json` 转换回 Paragon 测试表视角。agent 不修改原 Excel,而是复制一份 workbook,在相关 sheet 原始内容最右侧后一列新增 `Agent Result`,并只填最终状态: `Passed`, `Partial`, `Failed`, `Blocked`, `Review`。actual result、failure reason、evidence、trace coverage 等详细信息保存在内部 `result_mapping.json`,不污染用户看的 Excel。

v0.6 增加 `run-package`:这是本地 CLI MVP Runner。用户给一个 input package,agent 自动完成 `prepare -> triage -> process cases -> export-results`,最后直接输出 filled Excel 路径。默认会处理输入文件中解析出的全部 case;有 executor 的 case 执行 UI 自动化,没有 executor 的 case 也会生成明确 blocked/review 结果并回填 Excel。CLI 仍可用 `--release` 做开发期覆盖,但正常运行应优先从测试用例内容或文件名推断 release。它是后续本地 HTML Wrapper 的后端核心。

v0.7 增加本地 HTML Wrapper:用户运行 `npm run qa:web`,浏览器打开 `http://127.0.0.1:4173`,上传 PRD PDF 和 Paragon `.xlsx`,可选输入 `Run label`,点击 Run,等待后下载 filled Excel 或打开结果文件夹。`Run label` 只是本地运行标签,不参与 release/case 匹配;release 应由 agent 从输入文件推断。它不做线上部署、多人并发、权限系统或复杂 run history;只是本地页面包住 v0.6 pipeline。

v0.8 开始转向 Dynamic Playwright Agent Loop:没有预写脚本的 case 不应该直接退出。agent 会根据上传 case 的 precondition / steps / expected result 生成临时动作计划,用 Playwright 观察页面、尝试通用动作,并在卡住时返回 `Agent Blocked`、具体步骤、页面观察和 evidence。静态 shortcut 只作为已知流程的加速路径,不是运行前提。

v0.9 增加 General Gro Understanding Layer:agent 不再只问“这条 case 有没有 executor”,而是先理解“这条 case 想验证什么”。每条 case 会被解析成目标 site、module、business object、action、precondition、expected assertion 和 required capability。Admin / Creator / Agency case 会按目标 site 使用对应共享 browser session,再根据 module registry 尝试候选 route 和菜单探索,并给页面匹配评分;如果是全新模块或缺少前置数据,agent 也应该先记录理解结果、探索过的页面、缺失的 capability,再给出 `Agent Blocked`、`Setup Blocked` 或 `Manual Review`,而不是简单报错。

v0.17 增加可选 LLM Test Case IR translator:agent 可以把 PRD/test case 背景交给 OpenAI 辅助理解,生成结构化 Test Case IR 候选。但 LLM 不是执行器,也不是判定结果的权威。候选 IR 必须通过本地 validator:每个 node 要绑定原始 `source_type` / `source_index` / `source_text`,每条原始 step 和 expected result 都要被覆盖。验证失败、API 超时或未配置 key 时,agent 自动使用规则版 IR。

v0.18/v0.19 增加无 API 的 PRD Knowledge Pack 和 PRD-aware Understanding。`prepare` 会把 PRD 文件和 workbook context 转成 `prd_knowledge.json`,记录本次 release 的 modules、pages、fields、actions、business rules 和 extraction notes。后续 triage 与 dynamic runner 会读取这份 pack,用它补充 module/page/field/action 判断。PRD 只提供上下文,不能覆盖 Paragon test case 的 steps 和 expected result。

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
npm run qa -- export-results ./reports/runs/<run-id>/report.json
```

v0.6 之后,本地用户优先使用一键入口:

```bash
npm run qa -- run-package ./input-packages/R6-sample --release R6
```

v0.7 之后,不会敲命令的本地用户可以使用网页入口:

```bash
npm run qa:web
```

网页入口必须通过本地 server 打开 `http://127.0.0.1:4173`。`src/web/static/index.html` 只是前端文件,不能单独用 `file://` 打开运行,否则页面无法调用 `/api/run`。

网页上的 `Run label` 只是方便用户识别本次运行的名字,例如 `Test` 或 `R6 smoke`。它不能决定 agent 跑什么。agent 应该根据上传的 PRD / test case 文件推断 release,再生成 stable case id 并匹配 executor。

## 执行身份与结果追踪

不能因为 Gro 系统里出现了某个 `QA-*` 名字,就判断某条测试用例已经被 agent 跑过。名字只是 UI 操作和人工识别 test data 的可读标签。

agent 判断“是否运行过 / 运行结果是什么”必须基于本次 run 生成的结构化文件:

- `report.json`:记录 `run_id`、每条 `case_result`、`case_execution_id`、状态、actual vs expected、evidence 和 traceability。
- `result_mapping.json`:记录每条原始 case 的 source sheet / row、最终填入 Excel 的状态、`run_id` 和 `case_execution_id`。
- `report.md`:给人阅读的执行报告,包括 created test data 的内部 `data_id` 和 display name。

created test data 的内部 `data_id` 也不能只等于 campaign name。当前使用 `run_id + case_id + data_type` 生成内部身份,再把 campaign name 作为 `display_name` 保存。这样即使 Gro 里有历史同名或相似名字的数据,也不会被误认为是本次执行证据。

## 中间输入

agent 不应该每次直接从 Excel 行里执行。它应该先生成标准化文件:

```text
inputs/<release-or-run-id>/
  manifest.json
  cases.normalized.json
  prd_knowledge.json
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
        ↓ prd knowledge
prd_knowledge.json
        ↓ triage
automation_map.json / triage_report.md
        ↓ translate
Test Case IR (rules or validated LLM candidate)
        ↓ run
report.json / report.md / evidence
```

## 输出

每次运行输出:

```text
reports/runs/<run-id>/
  report.json
  report.md
  <release>.agent-filled.xlsx
  result_mapping.json
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

用户主要看 `<release>.agent-filled.xlsx`:它保持 Paragon 原表结构,只在每个相关测试用例行新增的 `Agent Result` 列填最终判断。

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
