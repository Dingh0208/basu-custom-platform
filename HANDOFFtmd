# ClientHub 交接文档（HANDOFF）

> 写给完全没有上下文的新会话。当前项目位于 `D:\code\Basu-Custom-Platform`，目标是交付一个 Windows 桌面客户情报工作台 ClientHub。

## 1. 我们在做什么

ClientHub 是一个「客户信息聚合工作台」，把通话、微信聊天、文件、截图、需求统一归到客户 360：

- Electron 33 + React 18 + TypeScript + Vite；
- Python Sidecar（标准库 HTTP Server + SQLite）；
- 内置 WeChatDataAnalysis 微信解析引擎；
- 内置 FFmpeg；
- MaaS / 聚合大模型（OpenAI 兼容接口）。

产品主要模块：

1. 首页工作台；
2. 导入中心（音频/文件/粘贴文本/聊天截图/微信库提取）；
3. 转写与摘要；
4. 聊天解析；
5. 客户档案 / 客户 360；
6. 项目聚合；
7. 需求清单；
8. 设置（大模型配置）；
9. 自动更新。

## 2. 当前已完成

### 2.1 导入与处理

- 拖拽/批量文件导入、粘贴文本、聊天截图 OCR；
- 音频真实链路：内置 FFmpeg 切片 → MaaS ASR → 结构化摘要；
- 导入记录删除：删除文件、转写/聊天、附件、关联需求，并刷新项目统计；
- 最近导入支持 `DELETE /api/imports/{id}`；
- 微信库提取：内置 `services/wechat-engine/wechat-backend.exe`，支持更新微信库、会话/日期/类型筛选，日期快捷键今天/3天/7天/全部；
- 微信引擎路径已修复为按 `sys.executable` 相对定位，不再依赖 `__file__` 临时目录。

### 2.2 客户 / 项目 / 需求

- 客户档案字段：姓名、公司、职位、手机号、微信号、邮箱、标签、来源、负责人、备注；
- 新建/编辑/合并/删除客户；
- 客户 360 项目卡片：名称、阶段（需求/报价/方案/签约/交付）、预算、目标上线、负责人、最近沟通、关联通话/聊天/文件/需求；
- 需求清单：标题、描述、P0/P1/P2、待确认/已确认/已报价/已实现、来源原文与时间；
- 需求自动从通话摘要/聊天解析抽取，支持手动新增/编辑/删除/合并；
- 独立项目模块：全部项目列表、按客户筛选展示、新建/编辑/删除；
- 项目模块与客户 360 共用 `projects` 表；导入中心项目下拉从 `/api/projects` 动态加载，不再写死「会员小程序商城 / CRM 二期」。

### 2.3 设置与首页

- 设置页保留：
  - 大模型配置（聚合 Key、Base URL、测试连接、拉取模型、ASR/文本/视觉模型选择、阿里云百炼跳转）；
  - 数据与版本信息；
  - 检查更新。
- 已移除“通用设置”卡片（用户明确不要）。
- 首页工作台：Hero、客户/项目/需求/待归档统计、最近导入、项目阶段分布、最新需求、快捷入口；
- 默认启动页为首页。

### 2.4 打包 / 更新 / GitHub

- GitHub 仓库：`https://github.com/Dingh0208/basu-custom-platform`
- 默认远程 `origin` 已指向 GitHub；
- `services/wechat-engine/**` 使用 **Git LFS**（约 201MB）；
- `.github/workflows/release.yml`：推送 `v*` tag 自动构建 Windows NSIS 并发布 Release；
- 工作流使用 `npm`（不要再用 pnpm，GitHub Actions 上 pnpm 报过 `packages field missing or empty`）；
- `electron-updater` 已接入，启动检查 + 每 3 小时后台检查；侧边栏头像附近显示更新/下载进度（`2.1 MB / 287.5 MB`）和“重启并安装”；
- 最新已发布 Release：`v0.2.5`，安装包约 **287.5MB**；
- v0.2.5 已包含首页、设置页精简、设置页布局优化与 Sidecar 生命周期修复；v0.2.4 / v0.2.3 为历史版本。

## 3. 当前卡点 / 状态

1. **设置页右侧空白**：刚把 `.settings-workspace` 从固定 `760px + 420px` 改成 `1.35fr + 0.65fr` 并拉伸卡片高度；需要再截图确认 2503px 宽度下右侧是否仍空。修改在 `src/styles.css`。
2. **本地开发数据库状态**：`services/ai/data/clienthub.db` 当前只有少量测试数据（2 个客户、4 条导入），不是完整演示数据；不要随意清空，先确认用户数据。
3. **v0.2.5**：`package.json` 版本 `0.2.5`，已打 `v0.2.5` tag 并发布；设置页「测试连接 / 拉取模型」、退出残留 Sidecar、项目列表同步问题已修复。
4. **微信真实账号检测**：当前开发机 `GET /api/wechat/status` 返回 `available:true`，但 `accounts:[]`，没有真实微信库可测；需要在登录微信的 Windows VM 上验证。
5. **大模型 `/models` 接口**：部分聚合平台返回非 JSON 或 401；设置页“测试连接”已改为真实 `/chat/completions` 最小请求，已验证 `{"status":"ok"}`。但“拉取模型”仍依赖 `/models`，若平台不支持会报错，属正常边界。
6. **自动更新**：代码和 release 工作流已接入，但尚未在真实旧版本安装包上完成一次“下载→进度→重启安装”的端到端实测；需要 VM 验证。

## 4. 下一步计划

1. 确认设置页布局（右边空白）最终截图；如果仍空，改成一列/加一张状态卡填满。
2. 用 `pnpm build` + 本地打包验证首页、设置、项目模块。
3. 在 Windows VM 重新安装 v0.2.5 安装包，验证：
   - 微信库更新/账号检测；
   - 音频导入；
   - 聊天解析；
   - 自动更新检查（需要下一次 release）。
4. 如果用户要发新版：先改 `package.json` version（如 0.2.5），提交 main，打 `v0.2.5` tag；GitHub Actions 自动发布；不要版本号与 tag 不一致（之前出现过 v0.2.1 draft 问题）。
5. 如需进一步压缩安装包：当前 287.5MB 的瓶颈是 `wechat-engine` 192MB + Electron 180MB；可做“微信引擎首次使用下载”的 Lite 版（约 100MB 级），但会增加首次使用联网依赖。

## 5. 关键文件

```text
electron/main.cjs          Electron 主进程、Sidecar 启动、自动更新、安装更新 IPC
electron/preload.cjs       contextBridge：update 状态/安装
src/App.tsx                页面路由（home/import/customers/projects/settings/chat/transcript）
src/components/HomePage.tsx
src/components/ImportCenter.tsx
src/components/CustomerList.tsx
src/components/ProjectPage.tsx
src/components/SettingsPage.tsx
src/components/Sidebar.tsx
src/api/client.ts
src/types.ts
src/styles.css
services/ai/main.py        Sidecar API / SQLite / MaaS / 客户/项目/需求/设置
services/ai/wechat_engine.py 微信引擎桥接
services/wechat-engine/    微信后端（Git LFS）
services/ffmpeg/ffmpeg.exe # 本地构建用，gitignore；CI 下载
scripts/build-sidecar.ps1
scripts/build-installer.ps1
scripts/installer.nsi      自定义 NSIS（本地测试包；官方自动更新用 electron-builder NSIS）
.github/workflows/release.yml
```

## 6. 踩过的坑（绝对不要再踩）

### 6.1 Git / 数据

- **不要提交** `services/ai/.env`、`services/ai/data/`、`release/`、`build/`、`dist/`、`services/ffmpeg/`；这些都在 `.gitignore`。
- **不要用 `git add -A` 后不检查**：本会话曾把应用数据/旧截图混入提交，用户明确要求脱敏。
- **LFS 指针陷阱**：`services/wechat-engine/wechat-backend.exe` 是 LFS 文件，工作区如果显示 134 字节就是 pointer，不是真实 165MB 文件；打包前先 `git lfs checkout`，否则安装包里的引擎是坏的。
- **GitHub 100MB 限制**：`wechat-backend.exe` 165MB 不能直接普通 git push；已用 `git lfs migrate` 迁移，不要重新把它作为普通文件提交。
- **版本号必须与 tag 一致**：`electron-builder` 用 `package.json` version 生成 release；tag v0.2.2 + package 0.2.1 会产生错误 draft。发版前先改 version。
- 当前 `origin` 是 GitHub；旧的 Gogs 远程已不作为默认。

### 6.2 打包

- **Vite 必须 `base: './'`**：否则 Electron `file://` 白屏；见 `vite.config.ts`。
- **PyInstaller onefile 的 `__file__` 指向临时解包目录**：微信引擎路径要用 `sys.executable` 的 `../wechat-engine`；不要改回 `__file__`。
- **Low integrity ACL**：工作区文件可能带 Low mandatory label，PyInstaller onefile 会报 `Could not create temporary directory`；构建脚本会 `icacls /setintegritylevel Medium`，不要省略。
- **ffprobe 已移除**：安装包只带 `ffmpeg.exe`；`probe_duration` 已回退用 ffmpeg stderr 解析。不要把 `ffprobe.exe` 再塞回去（会多 83MB，且当前代码不依赖）。
- **Electron locales**：`scripts/afterPack.cjs` 只保留 `zh-CN.pak / en-US.pak`；不要恢复 40MB 全语言包。
- **本地自定义 NSIS 不用于自动更新**：官方 release 必须用 electron-builder NSIS（GitHub Actions），自定义 `scripts/installer.nsi` 只用于本地测试/手动安装；它不会生成 `app-update.yml/latest.yml`。
- **electron-builder 本地 NSIS 失败**：当前非交互环境会 `Exit code 2`（安装器 GUI/UAC 无法运行），不要反复重试；GitHub Actions 的 Windows runner 可以成功。
- **CI 用 npm**：pnpm 在 Actions 报 `packages field missing or empty`，已改 npm；不要改回。

### 6.3 运行时 / API

- **不要在前端写死项目名**：`会员小程序商城 / CRM 二期` 已从 ImportCenter 下拉移除，改 `/api/projects`；否则项目模块和客户模块会不一致。
- **不要在 App 里写死 `known ? '会员小程序商城'`**：已改为使用 `selectedProject`；如果新增导入路径，也要从项目 API 选择。
- **MaaS Key 不要打印、不要贴到聊天**；`.env` 中 key 在 DSH 输出里可能显示为 `{{SECRET_xxx}}` 占位符，这是正常的脱敏。
- **设置测试连接**：不要用 `/models` 作为唯一判断，部分平台返回 HTML/401；已改为 `/chat/completions` 最小请求。`/models` 只用于“拉取模型”。
- **微信引擎更新**：首次启动需要 10–30 秒；UI 已加 loading/自动重试，不要误判为“引擎未连接”。
- **删除客户/导入**：删除客户会级联删除记录/需求；删除导入会删除文件/转写/聊天/需求，操作前确认用户数据。
- **浏览器轮询断开**：前端关闭页面时可能打断正在写的 HTTP 响应；`_json` 已捕获 `BrokenPipeError/ConnectionAbortedError/ConnectionResetError`，不要再让这类异常冒到 `socketserver` 日志。
- **Sidecar 残留进程**：Electron 退出必须用 `taskkill /T` 清理 PyInstaller one-file 的进程树；Sidecar 另带 `--parent-pid` 看门狗，父进程消失后自动退出。不要恢复成只 `proc.kill()`。

## 7. 快速验证命令

```powershell
# 前端构建
pnpm build

# Python 语法
python -m py_compile services/ai/main.py services/ai/wechat_engine.py

# 本地 Sidecar
python services/ai/main.py --host 127.0.0.1 --port 8765

# 本地开发页面
$node = "C:\Users\111\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe"
& $node "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5173
```

API 快速检查：

```text
GET  /api/health
GET  /api/dashboard
GET  /api/projects
GET  /api/settings/llm
POST /api/settings/llm/test
GET  /api/customers
GET  /api/customers/{name}/projects
GET  /api/customers/{name}/requirements
```

## 8. 备注

- 本文件不含任何真实 API Key、密码或客户隐私数据。
- 最新正式 Release：`v0.2.5`；v0.2.4 / v0.2.3 为历史版本。
- 若新会话需要继续，先读本文件，再检查 `git status` 和 `release/`，不要重新从零猜架构。
