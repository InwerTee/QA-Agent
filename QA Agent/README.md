# Gro QA Agent

新版 Gro QA Agent 用来在 Paragon UAT 前,根据用户提供的 Paragon PRD 和 test cases,帮助 YU 在 staging 环境中做内部自测。

最终使用方式应该很简单:同事把本次 release 的 PRD 和测试用例交给 agent,agent 读取、执行,然后输出结果报告。它不应该依赖本地 `参考文档/` 文件夹。

第一版目标很小:先支持 R6 Master Campaign 的真实 test case workbook ingestion,并继续让三条试点 case 跑出清楚的 actual vs expected、状态、失败原因和最小 evidence。它不是完整 QA 平台,不接 Jam,不批量跑完整工作簿;当前只会在 Paragon Excel 复制件里回填一列 `Agent Result`。

当前的 `inputs/R6/` 是从本地 R6 input package 生成出来的开发样例。它的作用是先证明:

```text
PRD + test case Excel -> normalized cases -> staging 执行 -> actual vs expected -> 结果报告
```

未来正式使用时,用户会提供 PRD 文档和测试用例文档,agent 再生成自己的 normalized cases 并执行。

## 当前 MVP 范围

- Release: R6 - Master Campaign
- PRD: 当前开发样例来自本地参考资料,未来由用户在每次运行时提供。
- Test cases: 当前开发样例由 `input-packages/R6-sample/` 生成,未来由用户在每次运行时提供。
- Pilot cases:
  - `R6-B7.2-TC01` - Create Master Campaign with All Fields
  - `R6-B7.1-TC01` - Search by Master Campaign Name (Success)
  - `R6-B7.3-TC01` - Edit Basic Information Only

这三条组成一个小闭环:先创建 Master Campaign,再搜索刚创建的数据,然后通过列表操作列编辑 Basic Information,最后打开详情页验证更新结果。

## 目录

```text
docs/
  workflow.md               # 正式输入/输出 workflow 说明

inputs/R6/
  manifest.json             # R6 input package 的输入来源说明
  cases.normalized.json     # 从 R6 workbook 生成的标准化 test cases
  ingestion_report.md       # 本次解析摘要和自动化状态分布
  automation_map.json       # v0.3 自动化分层和 executor bucket
  triage_report.md          # v0.3 人可读自动化路线图

src/
  cli.ts                    # 命令入口
  cases/                    # case 读取与过滤
  core/                     # setup plan 与判断类型
  ingestion/                # PRD / Excel 输入包解析
  triage/                   # case 自动化优先级和 executor 归类
  runner/                   # 执行调度
  reporting/                # JSON/Markdown 报告
  runtime/                  # env/runtime config

reports/runs/               # 单次运行产物,不进 git
knowledge/                  # Gro 系统知识沉淀
```

`../参考文档/` 是当前开发阶段的本地参考库,不是未来交付给同事使用 agent 时需要上传或保留的输入目录。

未来正式输入建议长这样:

```text
QA Agent/input-packages/<release-or-run-id>/
  prd.pdf 或 prd.docx
  test-cases.xlsx
  scope.json                # 用户指定 release/sheet/case 范围
```

agent 会把它转换成:

```text
QA Agent/inputs/<release-or-run-id>/
  manifest.json
  cases.normalized.json
```

## 使用

安装依赖后:

```bash
npm run qa:prepare:r6
npm run qa:triage:r6
npm run qa:list:r6
npm run qa:plan:r6
npm run qa:run:r6
npm run qa -- export-results reports/runs/<run-id>/report.json
```

`qa:prepare:r6` 会从本地 `input-packages/R6-sample/` 读取 R6 PRD 和 Excel,生成 `inputs/R6/manifest.json`、`inputs/R6/cases.normalized.json` 和 `inputs/R6/ingestion_report.md`。`input-packages/` 是本地运行输入,不会进 git。

`qa:triage:r6` 会读取 `inputs/R6/cases.normalized.json`,生成 `inputs/R6/automation_map.json` 和 `inputs/R6/triage_report.md`。它不会跑浏览器,只负责判断:

- 哪些 case 已经有 executor。
- 哪些 case 是下一批可自动化候选。
- 哪些 case 需要先准备 deterministic fixture / API setup / backend control。
- 哪些 case 更适合人工复核或先明确 evidence 策略。

`export-results` 会读取某次 run 的 `report.json`,复制 Paragon 原 Excel,并在每个相关 sheet 的原始内容最右侧后一列写入一列 `Agent Result`。它只填最终状态,不把 actual result、failure reason、evidence 或 trace notes 写进用户看的 Excel。详细映射会单独保存为 `result_mapping.json`。

示例输出:

```text
reports/runs/<run-id>/R6.agent-filled.xlsx
reports/runs/<run-id>/result_mapping.json
```

## Traceability Guard

为了防止 agent 偏离 Paragon 原测试用例,`prepare` 会在每条 normalized case 中保留 Excel 原文:

- `raw_source.test_case`
- `raw_source.pre_requisite`
- `raw_source.test_steps`
- `raw_source.expected_result`
- `source.workbook` / `sheet` / `source_row`

已经实现 executor 的 case 还必须有 traceability contract,声明每条原始 step / expected result 被哪个自动化动作或断言覆盖。当前 R6 三条已实现 case 都有 contract;其中 `R6-B7.2-TC01` 和 `R6-B7.3-TC01` 被明确标记为 smoke-level partial coverage,不会被误认为完整覆盖了原 case 的所有 expected result。

如果 `.env` 还没有配置 staging URL 和账号,`run` 会生成 `ENV_BLOCKED` 报告,不会假装执行成功。

## Excel 结果回填

v0.5 的用户可见输出是 Paragon Excel 的复制件,不是工程化 debug 表。规则:

- 原始 Paragon Excel 不修改。
- 复制件保留原 sheet、原行、原格式。
- 每个相关 sheet 只新增一列 `Agent Result`。
- `Agent Result` 写在原始内容的最右侧后一列。
- 只写最终状态: `Passed`, `Partial`, `Failed`, `Blocked`, `Review`。

状态映射:

```text
PRODUCT_BUG -> Failed
SETUP_BLOCKED / SCRIPT_BLOCKED / ENV_BLOCKED -> Blocked
MANUAL_REVIEW -> Review
PASS + full trace coverage -> Passed
PASS + partial/not-covered trace coverage -> Partial
```

`result_mapping.json` 是 agent 内部账本,记录 stable id、source row、coverage summary、actual result、failure reason、evidence 和最终写入的 Excel cell。普通用户主要看 `*.agent-filled.xlsx`。

## 真实浏览器执行

R6 三条 pilot case 现在已经接到 Playwright executor:

- `R6-B7.2-TC01`: 登录 Admin Site,进入 Master Campaign List,打开 Add Master Campaign,填写并保存。
- `R6-B7.1-TC01`: 使用上一条创建出的 Master Campaign 作为前置数据,搜索并验证列表结果。
- `R6-B7.3-TC01`: 使用上一条创建出的 Master Campaign,从列表 Operation column 打开 Edit 弹窗,编辑 Brief Description,保存后打开详情页验证更新后的描述。

同一轮 `qa run` 会复用一个 Admin browser session。这样 `create -> search -> edit` 可以共享登录态和页面上下文,避免每条 case 都重新启动/关闭浏览器。case 之间仍通过 report 中的 test data lineage 显式记录依赖关系。

执行器参考了历史实现里已经验证过的 Gro UI 惯例,包括:

- Admin route: `/masterCampaign/master-campaign-list`
- Element-Plus select/date-picker 的点击方式
- TinyMCE iframe 富文本填写
- 表格隐藏克隆导致文本定位要过滤 visible
- Admin storageState 登录复用

如果 Admin 登录页出现验证码,有三种方式:

```bash
# 方式 1: staging 提供固定验证码
QA_ADMIN_VERIFICATION_CODE=1234 npm run qa:run:r6

# 方式 2: 打开有头浏览器,手动输入验证码
QA_HEADLESS=false npm run qa:run:r6

# 方式 3: 指向已有 storageState
QA_ADMIN_STORAGE_STATE=/absolute/path/to/admin.json npm run qa:run:r6
```

`storage-state/` 会被 git 忽略,不要提交登录态文件。

## 测试数据追踪

报告会记录 agent 在 Gro 中创建并复用的测试数据:

```json
{
  "created_test_data": [
    {
      "data_id": "master_campaign:QA-R6-MC-1234567",
      "data_type": "master_campaign",
      "display_name": "QA-R6-MC-1234567",
      "created_by_case": "R6-B7.2-TC01",
      "used_by_cases": ["R6-B7.1-TC01"],
      "environment": "admin staging",
      "cleanup_status": "not_attempted"
    }
  ]
}
```

这样 Gro 里出现 `QA-R6-MC-*` 这类测试数据时,可以反查是哪次 run、哪条 case 创建的,以及被哪些后续 case 当作 precondition 使用。

## 环境变量

复制 `.env.example` 到 `.env`,填写:

```text
QA_ADMIN_BASE_URL=
QA_ADMIN_LOGIN_URL=
QA_ADMIN_USERNAME=
QA_ADMIN_PASSWORD=
QA_ADMIN_VERIFICATION_CODE=
QA_ADMIN_STORAGE_STATE=
QA_HEADLESS=true
```

真实凭据只放 `.env`,不要写入 prompt、报告、代码注释或提交信息。

当前迁移期也兼容读取上一级目录的 `../.env`,方便沿用已有本地配置。

登录配置和本地 storage state 的说明见 [docs/auth.md](docs/auth.md)。
