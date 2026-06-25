# Gro QA Agent Workspace

这个根目录现在分成两块:

- `QA Agent/`: 原本的本地 runner 路线,当前版本是 v0.20。它负责 PRD / Excel 输入、本地网页运行、Playwright 执行、报告生成和 Excel 结果回填。
- `QA Agent AI/`: 新的 AI 探索路线,当前版本是 v0.1。它不继承 `QA Agent` 的版本号,也不替代原 runner。它用于探索 OpenAI planner + 受控 Playwright command loop + skill rules 的方案。

## 版本关系

`QA Agent v0.20` 和 `QA Agent AI v0.1` 是两条并行路线:

- `QA Agent v0.20`: 保守执行版,适合继续使用现有本地网页和 Excel 输出。
- `QA Agent AI v0.1`: 新实验版,先从单条 test case 的 AI planning / traceability / command validation 开始验证。

## 日常使用

使用原本本地 runner 时,进入 `QA Agent/` 启动本地前端:

```bash
cd "QA Agent"
npm run qa:web
```

然后打开 `http://127.0.0.1:4173`,上传本次 release 的 PRD 和 Paragon 测试用例 Excel,点击 Run 后等待结果即可。

探索 AI 版本时,进入 `QA Agent AI/`:

```bash
cd "QA Agent AI"
npm run demo
```
