# 开发期脚本（scripts/dev）

这些是开发/联调阶段用过的一次性脚本，**不属于运行或发布流程**，日常使用不需要它们。
正式脚本（打包、导入、备份、端到端回归）留在 `scripts/` 根目录。

| 前缀 | 用途 | 示例 |
| --- | --- | --- |
| `shoot-*.mjs` | 用 Playwright + 系统 Edge 给各页面/状态截图（输出到 `screenshots/`，该目录不入库） | `node scripts/dev/shoot-r2.mjs` |
| `check-*.mjs` | 功能自检（导入、检索索引刷新、改密、打印等） | `node scripts/dev/check-password.mjs` |
| `db-*.mjs` | 开发库的查看/清理小工具（会直接操作 `prisma/dev.db`，慎用） | `node scripts/dev/db-peek.mjs` |
| `test-kb-import.mjs` | 知识库导入解析/校验的单元级测试 | `node --import tsx scripts/dev/test-kb-import.mjs` |

## 运行前提

- 需要先启动开发服务：`pnpm dev`（默认 http://localhost:3000）
- 截图脚本使用系统 Edge：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，路径写死在各脚本顶部
- 部分脚本会读取/写入演示库，**请先备份自己的数据**，或只在演示环境运行

## 说明

这些脚本是迭代过程中按当时需要写的，参数与选择器可能与最新 UI 不完全同步；仅作参考保留，不建议直接用于生产验收。
