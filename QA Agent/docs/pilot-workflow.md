# QA Agent Pilot Workflow

本文档定义 QA Agent 在团队中的 pilot 使用流程。它的目标不是证明 agent 已经是 production-ready system,而是验证它能否进入开发 self-test 流程,帮助团队更早发现问题、留下 evidence、降低 UAT 阶段暴露问题的压力。

## 1. Pilot 定位

QA Agent pilot 是一个交付前自测辅助流程:

```text
Paragon PRD + Paragon test cases
        ↓
QA Agent 解析 / 理解 / 尝试执行
        ↓
输出测试计划、执行结果、evidence、失败原因分类
        ↓
使用者根据结果补测或修复,项目侧判断交付风险和流程价值
```

本轮 pilot 不追求:

- 所有 case 自动跑通。
- 替代人工 QA 或 Paragon UAT。
- 覆盖 Gro 所有模块。
- 建成长期线上平台。
- 让非技术角色亲自解决所有技术实现问题。

本轮 pilot 追求:

- 开发团队能否在交付前使用它做 self-test。
- 项目侧能否通过结果判断交付风险。
- 失败原因是否清楚、可行动。
- evidence 是否能用于团队沟通。
- agent blocked / manual review 是否能暴露流程和系统知识缺口。

## 2. 使用场景

### 2.1 什么时候用

建议放在开发流程中的这个位置:

```text
开发完成某个 release / requirement
        ↓
开发准备交付 / 内部验收前
        ↓
运行 QA Agent pilot
        ↓
根据报告补测、修复或解释 blocked
        ↓
项目侧决定是否进入下一步验收 / UAT 准备
```

### 2.2 谁使用

- 开发团队:在交付前运行或查看 QA Agent 输出,用于 self-test。
- 需求 / 交付负责人:提供 PRD/test cases,查看测试结果、失败分类和 evidence。
- 评审者:判断 pilot 是否降低 UAT 压力,以及后续是否继续投入。

### 2.3 谁不应该被要求做什么

- 非技术使用者不需要修 selector、写 Playwright 脚本或解决所有 agent blocked。
- 开发团队不应该把 QA Agent 结果当成唯一质量门禁。
- QA Agent 不应该被要求证明所有 Paragon case 都能自动化。

## 3. 输入

每次 pilot run 需要尽量准备:

- Paragon PRD:本次 release / requirement 的业务背景。
- Paragon test cases:本次实际要测试的 Excel。
- 测试环境:例如 staging Gro。
- 测试账号:Admin / Creator / Agency,按本次 case 需要提供。
- Scope:本次先跑哪些 release、sheet、case 范围。
- 已知前置数据:如果某些 case 需要 campaign、creator、agency、lock stock 等已有数据,需要记录是否已有。

当前 no-API pilot 不需要:

- OpenAI API key。
- Jam 自动录屏集成。
- 多人在线运行环境。
- 线上部署。

## 4. 输出

QA Agent pilot 的输出分成用户输出和内部诊断输出。

### 4.1 用户主要看

```text
reports/runs/<run-id>/
  report.md
  <release>.agent-filled.xlsx
```

用户关心:

- 每条 case 最终状态。
- actual vs expected 是否清楚。
- 失败原因是否可理解。
- evidence 路径是否能支持沟通。

### 4.2 Pilot owner 需要看

```text
reports/runs/<run-id>/report.json
reports/runs/<run-id>/result_mapping.json
inputs/<release-or-run-id>/case_understanding.json
inputs/<release-or-run-id>/knowledge_missing_report.md
```

Pilot owner 重点看:

- agent 对 case 的理解是否偏离原测试用例。
- 哪些 case 是产品问题,哪些只是 agent 能力不足。
- 哪些 case 缺前置数据。
- 哪些 case 缺 recipe / Gro 系统知识。
- 哪些输出使用者看不懂,需要改报告表达。

## 5. Pilot 运行流程

### Step 1: 明确本轮 scope

运行前先确认:

- 本次 release / requirement 是什么。
- 本次优先看哪些 case。
- 是否要跑全量,还是先挑 5-10 条 representative cases。
- 本轮目标是验证流程,不是追 pass rate。

建议第一轮不要直接追求全量 case pass。可以先选:

- 2-3 条 happy path。
- 1-2 条 search/filter/list case。
- 1-2 条 negative/empty state case。
- 1 条需要前置数据的 case。

### Step 2: 准备 input package

把 PRD 和测试用例放在同一个输入目录中:

```text
input-packages/<run-label>/
  prd.pdf
  test-cases.xlsx
```

或者使用本地网页上传 PRD 和 Excel。

### Step 3: 运行 QA Agent

网页方式:

```bash
cd "QA Agent"
npm run qa:web
```

打开:

```text
http://127.0.0.1:4173
```

上传 PRD 和 test cases 后点击 Run。

CLI 方式:

```bash
cd "QA Agent"
npm run qa -- run-package <input-package-dir>
```

### Step 4: 先读 knowledge_missing_report

不要先看 pass rate。先看:

- 这批 case 里 agent 认为自己知道什么。
- 哪些 case 缺 Gro module / page / route / recipe。
- 哪些 case 需要 setup data。
- 哪些 case expected result 需要人工判断。

如果大多数 case 是 `recipe_missing` 或 `setup_data_required`,这不是 pilot 失败。它说明下一步技术投入应该集中在 recipe / setup data。

### Step 5: 再读执行报告

看 `report.md` 和 filled Excel:

- 哪些 case 实际执行了。
- 哪些 case 没执行但给出了清楚原因。
- 哪些 case 可能是真实产品 bug。
- 哪些 case 是 agent/script/selector 问题。
- 哪些 evidence 能直接用于交付讨论。

### Step 6: 做失败分类

每个非 pass 结果都应该归类:

| 分类 | 含义 | 下一步 |
| --- | --- | --- |
| Product Bug | Gro 行为和 expected result 不一致 | 开发团队修复 |
| Agent Understanding Gap | agent 理解错模块、页面、步骤或 expected result | 补 case understanding / module knowledge |
| Recipe Missing | agent 知道要测什么,但没有可执行 recipe | 后续补 recipe |
| Setup Data Issue | 缺 campaign、creator、agency 等前置数据 | 建 setup checklist / fixture |
| Environment Issue | 登录、账号、权限、staging 不可用 | 修环境配置 |
| Selector / Script Issue | 页面元素定位或脚本执行失败 | 技术修 runner |
| Test Case Ambiguity | Paragon case 本身描述不清或 expected 不可观察 | 需求侧 / 开发团队补充解释 |
| Manual Review Required | 当前无法可靠自动判断 | 保留人工验证 |

### Step 7: 反馈给相关责任人

反馈不应该只是“跑失败了”。建议使用这个格式:

```text
Case:
Expected:
Actual:
Status:
Failure category:
Evidence:
Recommended action:
```

例如:

```text
Case: R6-B7.1-TC01 Search with No Results
Expected: table shows no rows and empty state message
Actual: agent found table but could not verify empty state wording
Status: Manual Review
Failure category: Assertion / evidence gap
Evidence: reports/runs/.../screenshot.png
Recommended action: developer manually verify wording; later add empty-state assertion recipe
```

## 6. Pilot 成功标准

本轮 pilot 成功不等于所有 case pass。

建议用这些标准判断:

- 使用者能否在 10-15 分钟内理解如何运行或查看结果。
- 报告能否让相关责任人知道下一步该修产品、补数据、还是忽略 agent gap。
- 项目侧能否从报告中判断交付风险。
- 至少发现 1-2 个原本可能到 UAT 才发现的问题,或证明某些流程有 evidence。
- blocked / manual review 的原因足够具体,不是笼统失败。
- 试用者能明确说出 2-3 个最想改善的输出或能力。

## 7. Pilot 反馈模板

试用后收集这些问题:

```text
1. 你是否能顺利运行 / 查看 QA Agent 输出?
2. 哪些输出最有帮助?
3. 哪些输出看不懂或没用?
4. 失败分类是否帮助你判断下一步?
5. evidence 是否足够用于交付沟通?
6. 哪些 case 你认为 agent 应该优先支持?
7. 你是否愿意在下次交付前继续使用?
8. 如果只能改一个地方,你希望优先改什么?
```

## 8. 下一步优先级判断

pilot 后不要直接默认继续做自动化。根据反馈选择优先级:

- 如果使用者看不懂:先改报告和 Excel 输出。
- 如果失败分类不准:先改 failure classification。
- 如果很多 case 缺前置数据:先做 setup checklist / fixture plan。
- 如果 agent 理解常偏:先补 module knowledge / case understanding。
- 如果某个模块重复出现:优先给这个模块做 recipe。
- 如果 evidence 不够:先补截图、snapshot、trace 输出。

## 9. 当前建议节奏

```text
今天:
  跑现有 QA Agent,收集失败原因,不追通过率。

下周前:
  准备 pilot package,包括这份 workflow、运行说明、失败分类、反馈模板。

下周:
  找实际使用者用真实 release 试一次。

试用后:
  根据反馈决定下一版优先做报告、分类、recipe、setup data,还是 UI。
```
