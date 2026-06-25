# Gro QA Agent Workspace

这个根目录现在分成两块:

- `QA Agent/`: QA Agent 的实际代码、输入样例、runner、报告生成器和 Playwright 测试。

日常使用时,进入 `QA Agent/` 启动本地前端:

```bash
cd "QA Agent"
npm run qa:web
```

然后打开 `http://127.0.0.1:4173`,上传本次 release 的 PRD 和 Paragon 测试用例 Excel,点击 Run 后等待结果即可。
