# Gro QA Agent Workspace

这个根目录现在保留一条主线:

- `QA Agent/`: 本地 pilot runner,负责 PRD / Excel 输入、本地网页运行、Playwright 执行、报告生成、Excel 结果回填和 Gro Knowledge Layer。

## 日常使用

使用原本本地 runner 时,进入 `QA Agent/` 启动本地前端:

```bash
cd "QA Agent"
npm run qa:web
```

然后打开 `http://127.0.0.1:4173`,上传本次 release 的 PRD 和 Paragon 测试用例 Excel,点击 Run 后等待结果即可。
