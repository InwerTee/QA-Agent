# Gro QA Agent

新版 Gro QA Agent 用来在 Paragon UAT 前,根据用户提供的 Paragon PRD 和 test cases,帮助 YU 在 staging 环境中做内部自测。

最终使用方式应该很简单:同事把本次 release 的 PRD 和测试用例交给 agent,agent 读取、执行,然后输出结果报告。它不应该依赖本地 `参考文档/` 文件夹。

第一版目标很小:先支持 R6 Master Campaign 的真实 test case workbook ingestion,并继续让两条试点 case 跑出清楚的 actual vs expected、状态、失败原因和最小 evidence。它不是完整 QA 平台,也不回写 Excel,不接 Jam,不批量跑完整工作簿。

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

这两条组成一个小闭环:先创建 Master Campaign,再搜索刚创建的数据。

## 目录

```text
docs/
  workflow.md               # 正式输入/输出 workflow 说明

inputs/R6/
  manifest.json             # R6 input package 的输入来源说明
  cases.normalized.json     # 从 R6 workbook 生成的标准化 test cases
  ingestion_report.md       # 本次解析摘要和自动化状态分布

src/
  cli.ts                    # 命令入口
  cases/                    # case 读取与过滤
  core/                     # setup plan 与判断类型
  ingestion/                # PRD / Excel 输入包解析
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
npm run qa:list:r6
npm run qa:plan:r6
npm run qa:run:r6
```

`qa:prepare:r6` 会从本地 `input-packages/R6-sample/` 读取 R6 PRD 和 Excel,生成 `inputs/R6/manifest.json`、`inputs/R6/cases.normalized.json` 和 `inputs/R6/ingestion_report.md`。`input-packages/` 是本地运行输入,不会进 git。

如果 `.env` 还没有配置 staging URL 和账号,`run` 会生成 `ENV_BLOCKED` 报告,不会假装执行成功。

## 真实浏览器执行

R6 两条 pilot case 现在已经接到 Playwright executor:

- `R6-B7.2-TC01`: 登录 Admin Site,进入 Master Campaign List,打开 Add Master Campaign,填写并保存。
- `R6-B7.1-TC01`: 使用上一条创建出的 Master Campaign 作为前置数据,搜索并验证列表结果。

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
