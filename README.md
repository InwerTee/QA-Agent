# Gro QA Agent Workspace

这个根目录现在分成两块:

- `QA Agent/`: QA Agent 的实际代码、输入样例、runner、报告生成器和 Playwright 测试。
- `参考文档/`: PRD、Paragon 测试用例、产品构思、项目背景和历史参考资料。

开发新版 Agent 时,进入 `QA Agent/` 运行命令:

```bash
cd "QA Agent"
npm run qa:list:r6
npm run qa:plan:r6
npm run qa:run:r6
```
