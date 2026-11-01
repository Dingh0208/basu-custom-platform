# ClientHub v0.2.6

发布日期：2026-11-01

## 本次更新

- 修复桌面端 Sidecar 生命周期：使用当前安装实例的 PID 文件管理进程，兼容清理旧版本残留，并避免误杀其他同名进程。
- 应用退出时清理 Sidecar 和自动更新定时器，自动更新检查失败不会产生未处理的 Promise 错误。
- 发布构建默认不再携带 `services/ai/.env`，API Key 从用户数据目录读取；构建脚本提供 `-IncludeEnv` 仅用于明确的本地测试构建。
- Sidecar 构建固定检查 PDF、Word、Excel 解析依赖，CI 与本地构建使用同一依赖清单。
- 微信引擎发布包过滤开发文档、macOS 原生目录和测试夹具，减少无效文件。
- 安装器文件名自动读取 `package.json` 版本，避免版本号与安装包名称不一致。
- 包含上一轮的销售闭环、待归档批量确认、客户跟进提醒、全局搜索、文档解析、附件预览、任务队列和核心指标改进。

## 构建验证

本机使用 CPython 3.12 构建：

- Sidecar：约 17.1 MB
- Windows 目录包：约 552.3 MB
- NSIS 安装包：约 289.3 MB
- 安装包不包含 `services/ai/.env`
- 微信引擎中的 macOS 目录、README、`native/__init__.py` 和测试夹具已过滤

安装包体积仍主要来自 Electron 运行时、微信引擎和 FFmpeg。CI 会从 FFmpeg Essentials 下载当前版本，因此最终 Release 体积可能与本机略有差异。

## 验证范围

- 已完成前端构建、Python 编译、SQLite/API 回归测试、Node 语法检查和安装包内容检查。
- 自动更新的真实 Windows 虚拟机端到端流程（下载、进度、重启安装）仍需在实际旧版本安装环境中验证。
