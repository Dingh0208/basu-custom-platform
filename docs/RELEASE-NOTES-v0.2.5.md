# ClientHub v0.2.5 更新内容

发布日期：2026-10-30

## 修复

- **退出软件后残留 Python 进程**
  - Electron 退出时使用 `taskkill /T /F` 终止 Sidecar 进程树，覆盖 PyInstaller one-file 启动器产生的子进程；
  - 新增单实例锁，避免同时启动多个 ClientHub 实例和多个 Sidecar；
  - Sidecar 新增 `--parent-pid` 看门狗，Electron/Node 父进程消失后 2 秒内自动退出；
  - 开发模式下 `scripts/start-ai.mjs` 同样按进程树清理。

- **客户已关联项目、但「项目」页不显示**
  - `list_all_projects()` / `dashboard_summary()` 启动时会从导入记录和聊天记录中同步项目到 `projects` 表；
  - 项目页重新获得焦点时自动刷新，避免页面先打开时显示 0 个项目；
  - 客户 360 的项目卡片与项目模块现在使用同一套项目数据。

- **设置页「测试连接」「拉取模型」仍可能失败**
  - 继续保留 v0.2.4 的 `/models` 响应体修复；
  - v0.2.5 增加旧 Sidecar 清理，避免新版 App 连到升级前残留的旧 Sidecar（旧代码会复现 `Expecting value: line 1 column 1 (char 0)`）；
  - `/api/health` 返回实际应用版本，便于确认当前连接的 Sidecar 版本。

## 安装

- 下载 `ClientHub-Setup-0.2.5.exe`，安装前请先退出旧版 ClientHub。
- 覆盖安装会保留客户记录、导入文件与大模型配置。
