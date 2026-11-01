# ClientHub · 客户信息聚合工作台

ClientHub 是本地客户信息聚合工作台：导入沟通资料，归属客户与项目，并从原文建立可追踪的需求和待办。

当前版本包含 **Python Sidecar + SQLite 持久化 + 可选 MaaS 摘要/转写**。文件解析使用本地 Python 包；Sidecar 不可用时前端会显示内置 Mock 数据。

## 快速启动

> Sidecar 开发需要 Python 3.11–3.12（推荐 3.12；当前本地 OCR 依赖不支持 3.13）。安装版已内置运行环境与 OCR 模型。

```bash
# 1. 安装依赖
pnpm install
python -m pip install -r services/ai/requirements.txt

# 如果 Electron 没有自动下载二进制（pnpm 忽略 postinstall 时）：
node node_modules/electron/install.js

# 2. 同时启动 AI Sidecar + 浏览器开发模式（推荐）
pnpm dev:full
# 打开 http://localhost:5173

# 或者分开启动
pnpm ai:dev      # 启动 http://127.0.0.1:8765
pnpm dev         # 启动 Vite

# 3. Electron 桌面模式（会同时启动 Sidecar + Vite + Electron）
pnpm electron:dev
```

生产构建：

```bash
pnpm build
pnpm electron:start
```

## 已实现页面

### 1. 导入中心

- 拖拽 / 批量选择文件（音频、视频、PDF、Word、Excel、PPT、图片、压缩包、聊天记录）；
- 最近导入支持删除：删除文件、转写/聊天内容、关联需求和附件，并重新计算客户项目统计；
- 粘贴文本：弹窗输入聊天记录，生成一条导入记录；
- 普通图片从“选择文件”或拖放入口执行本地 OCR；“聊天截图”使用视觉模型还原聊天消息；
- 本地 Sidecar 接收导入记录并写入 SQLite；
- 音视频、文档和图片按实际上传字节计算 SHA-256，跳过重复文件；
- 自动识别客户 / 待归档提示；
- 导入进度轮询、处理流程提示；
- AI 处理模式切换：阿里云百炼 / Mock。
- PDF 自动提取文本层，无文本页使用本地中英文 OCR；支持普通图片、多页 TIFF、Word 97–2003 DOC、DOCX、XLS/XLSX、PPT/PPTX、EML。PPT 读取当前保存版本，排除历史幻灯片和母版占位文字；PPTX 包含表格及备注。加密文档须先解锁，Word 97 以前的格式须转为 DOCX。
- 文档、原始图片与邮件附件会本机保存、预览或下载，并纳入检索及备份。每个导入文件最大 100 MB；PDF/PPT/多页图片最多 200 页，提取最多 100,000 字。
- 最近导入保留至少 360px 高度，左侧内容可滚动查看，AI 任务列表位于导入记录之后。
- 「待归档」为独立页面，点击未归档资料直接定位；可查看详情、预览已解析内容，批量确认客户、项目与负责人。

### 2. 转写与摘要

- FFmpeg 将长录音切为约 55 秒的单声道音轨，同一服务最多并发 3 个 Qwen ASR 请求；按原顺序合并，保留真实片段边界。句内时间是估计值，不是逐字时间戳。
- 成功片段写入本机 `asr-cache`；取消、重启恢复或失败重试时可复用相同文件片段。暂时性接口错误最多尝试 3 次，任务保持进度、取消和重试入口。
- 音频播放器模拟播放、进度、倍速切换；
- 转写稿按时间排序，区分“客户/我/说话人”；
- 点击任意句子跳转到对应时间点，当前句高亮；
- 搜索转写稿并高亮关键词；
- 只看客户过滤；
- AI 摘要固定七字段：一句话结论、客户需求与痛点、预算与报价、时间与优先级、决策人与角色、异议与风险、下一步动作；
- 空字段显示“未提及”；
- 每个字段可点击引用图标定位原文；
- “需求”页签：展示需求条目、状态、优先级、来源，可加入项目需求清单；
- “原文引用”页签：展示原文片段与时间点，点击可定位；
- 编辑摘要、保存修改、重新生成；
- 摘要显示原文证据覆盖度。编辑后证据会失效；可按已保存原文重新生成，逐段更正及摘要修改均有本地历史。
- 通话说话人可逐段人工标注为我方/客户；声纹自动分离未接入当前 ASR 能力。
- 摘要修改可保存到本地；下一步动作可确认负责人、日期并保存待办，需求可打开对应客户 360 继续跟进；
- 重新处理、导出纪要（原型模拟）。

### 3. 客户模块

- 客户列表：客户名、公司、职位、当前项目、最近沟通、记录数、状态；
- 搜索客户 / 公司 / 职位 / 标签；
- 客户档案：姓名、公司、职位、手机号、微信号、邮箱、标签、来源渠道、负责人、备注；
- 新建客户、编辑档案、重复客户合并、客户删除；
- 删除客户前明确提示：名下项目、需求、销售待办和沟通资料会同步删除；删除后的空库重启不会重新生成演示数据。
- 客户 360 项目聚合：项目名称、阶段（需求/报价/方案/签约/交付）、预算、目标上线时间、负责人；
- 项目卡片显示关联通话/聊天/文件数量，并可直接打开关联记录；
- 支持新建项目、编辑项目、删除项目；
- 需求清单：从通话摘要和聊天解析自动抽取需求，支持标题、描述、P0/P1/P2、待确认/已确认/已报价/已实现、来源原文与时间；
- 需求支持手动新增、编辑、删除、多选合并；
- 客户 360 统一时间线：按时间聚合通话、聊天、文件记录；
- 点击时间线记录直接打开对应转写或聊天详情；
- 客户 360 已具备基础聚合能力，完整客户画像与 AI 问答仍可继续扩展。

### 4. 聊天解析

- 支持粘贴微信聊天文本、导入 TXT/HTML/JSON/CSV 聊天文件；
- 支持微信聊天截图 OCR（`qwen3.8-omni-flash`）并还原为消息时间线；
- 自动解析发言人、时间、消息内容；
- 自动判断“我 / 客户”，支持手动调整角色并同步客户归属；
- 生成聊天摘要、主题、标签；
- 提取关键问答、需求、承诺、下一步；
- 聊天详情页左侧信息、中间气泡时间线、右侧 AI 对话解析；
- 附件索引：原始截图、图片/语音/文件/链接消息统一列出。已保存在本机的图片、语音、视频、PDF、Word、Excel 和邮件可预览/播放或下载；语音可提交队列转写。
- 已用真实样例 `Martin Zhong / 梧桐` 验证 11 条消息；已用两张微信聊天截图验证 13 条 / 31 条消息的 OCR 与结构化解析。

### 5. 设置与大模型配置

- 底部“设置”进入设置页；
- **大模型配置**：一个聚合 Key 通配音频 / 文本 / 视频三种功能模型；
- 支持填写 Base URL 与 API Key、**测试连接**、**拉取模型**；
- 可为 ASR（音频转写）、总结（文本/聊天）、视觉（视频/图像 OCR）分别指定模型；
- 提供跳转 [阿里云百炼](https://bailian.console.aliyun.com/) 的入口；
- **数据与备份**：查看数据库占用和备份数量，导出或恢复本地备份；备份不包含 API Key；
- **本地服务诊断**：查看 Sidecar API、FFmpeg、微信引擎和微信账号状态，可重启已打包的 Sidecar；
- **导入默认值**：设置默认负责人、默认项目、客户自动识别和自动处理偏好；
- **更新设置**：控制自动检查更新和检查频率；
- **通知**：系统通知开关与免打扰时段；09:00 到期提醒、应用内未读数、点击定位待办。应用运行时发送，退出后重新启动补提醒，完成/延期自动清理旧提醒；
- **隐私与关于**：查看 Windows DPAPI 密钥存储方式、删除已保存 Key 和当前版本；客户记录、导入文件、大模型 Key 只保存在本机。
- 点击左下角头像可修改姓名、职位、公司、手机号、邮箱，保存后同步显示在侧栏并在本机持久化。

### 6. 从本地微信聊天库提取

- 导入中心 → “从微信库提取”；
- 自动连接 WeChatDataAnalysis 本地后端（微信 4.x SQLCipher/WCDB 解密、WCDB 会话/消息读取）；
- 顶部“更新微信库”：检测微信目录 → 读取密钥 → 批量解密 → 构建会话缓存，并显示实时进度；
- 未完成解密时“开始提取”按钮禁用；
- 选择账号、会话、开始/结束日期、记录类型；
- 日期支持快捷选择：今天 / 3 天内 / 7 天内 / 全部；
- 记录类型支持：文本、图片、语音、视频、文件、链接、聊天记录、引用、系统消息、表情、转账、红包、位置、通话；
- 提取过程显示动态进度：读取消息 → 日期/类型筛选 → 创建聊天记录 → AI 对话解析；
- 提取结果写入 `services/ai/data/wechat-exports/` JSON，并自动创建聊天记录、触发 AI 对话解析；
- 项目字段不再固定为“微信提取”，由 AI 根据聊天内容总结当前跟进项目；无明确项目显示“—”；
- 后续与普通聊天导入完全一致：客户匹配、客户 360 时间线、需求抽取。
- 实现依据：微信 4.x SQLCipher 4 页面解密（PBKDF2-SHA512 256000 轮、AES-256-CBC、HMAC-SHA512、4096 字节页），以及 WCDB `session.db / contact.db / message_*.db` 的会话与消息读取逻辑；参考开源项目 [LifeArchiveProject/WeChatDataAnalysis](https://github.com/LifeArchiveProject/WeChatDataAnalysis)。
- 逆向与集成细节：[docs/reverse-wechat/ANALYSIS.md](<docs/reverse-wechat/ANALYSIS.md>)。

### 7. 销售工作闭环（P1）

- 「待办」统一管理销售动作，保存客户、项目、关联需求、来源原文、负责人、截止日期与完成状态；可从需求或摘要创建，并返回来源查看。
- 「待归档」支持批量确认客户、项目和负责人，关联需求与待办同步更新；每批最多 200 条，校验失败整批回滚。
- 客户 360 展示下一步动作、风险来源、最近沟通、今日到期与逾期提醒；首页增加今日跟进提醒。提醒显示在应用内。
- 本地服务就绪后自动重新加载跟进数据，加载失败可重试；若提示服务版本较旧，请完整重启 ClientHub。开发模式还需确认 8765 端口未被旧 Sidecar 占用。
- 点击侧栏「全局搜索」或按 `Ctrl/Cmd+K`，统一检索客户、项目、聊天、转写与需求；支持类型筛选和结果跳转，每类最多显示 20 条。
- 旧数据库自动补充字段；销售待办与 AI 处理任务分开保存，并随本地备份导出/恢复。负责人为姓名，AI 给出的相对日期需要手动确认。
- 首页的“核心产品指标”从同一次 `/api/dashboard` 请求返回，默认统计近 7 天；`/api/metrics?days=1..90` 可单独读取窗口数据。每项都返回样本数，暂无可验证样本时显示“—”。客户自动匹配准确率只统计带自动建议、人工确认结果的审计记录，人工归档不会被计入。

验证：先安装 `python -m pip install -r services/ai/requirements-dev.txt`，执行 `python -m unittest discover -s services/ai -p "test_*.py" -v`。47 项测试使用临时数据库及公开 Office 样本，不访问用户数据或计费模型接口；详细记录见 [HANDOFF.md](HANDOFF.md)。

## 项目结构

```text
├─ electron/              # Electron 主进程 + preload
├─ services/ai/           # Python Sidecar（HTTP API + SQLite + Mock 转写/摘要）
│  ├─ main.py
│  ├─ wechat_engine.py    # WeChatDataAnalysis 本地引擎桥接（启动/会话/消息/导入）
│  └─ data/               # 本地 SQLite 数据（首次启动自动生成）
├─ services/wechat-engine/ # 内置微信后端 + native core（打包时作为 extraResources）
│  ├─ wechat-backend.exe
│  └─ native/
├─ src/
│  ├─ api/                # Sidecar HTTP 客户端（自动回退内置 Mock）
│  ├─ components/         # Sidebar / ImportCenter / TranscriptWorkspace / Modal / Toast / Icons
│  ├─ mock/               # 内置 Mock 数据（Sidecar 不可用时兜底）
│  ├─ App.tsx             # 应用状态、Sidecar 健康检查与页面切换
│  ├─ main.tsx            # React 入口
│  ├─ styles.css          # 设计系统与页面样式
│  └─ types.ts
├─ docs/
│  ├─ prototype/          # 高保真静态原型（HTML + PNG + 参考图）
│  └─ app-screens/        # 当前可运行版本截图
├─ scripts/start-ai.mjs   # 启动 Python Sidecar
├─ index.html
├─ vite.config.ts
└─ package.json
```

## Sidecar API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/dashboard` | 首页聚合数据与近 7 天核心产品指标 |
| GET | `/api/metrics?days=7` | 指定窗口的导入、解析、匹配、需求和销售闭环指标 |
| GET | `/api/profile` | 获取本机个人资料 |
| POST | `/api/profile` | 保存姓名、职位、公司、手机号、邮箱 |
| GET | `/api/imports` | 导入记录列表 |
| POST | `/api/imports` | 创建导入记录；音频自动走真实 ASR + 摘要 |
| POST | `/api/imports/paste` | 粘贴文本导入（自动识别聊天格式并建聊天记录） |
| POST | `/api/imports/chat` | 直接导入微信聊天文本 |
| POST | `/api/imports/chat-screenshot` | 上传聊天截图并 OCR 成聊天记录 |
| DELETE | `/api/imports/{id}` | 删除导入文件及其转写/聊天/需求关联内容 |
| POST | `/api/asr` | 直接测试 qwen3-asr-flash 转写 |
| POST | `/api/summarize` | 直接测试 qwen3.8-flash 结构化摘要 |
| GET | `/api/transcripts/{id}` | 获取转写稿与摘要 |
| GET | `/api/chats/{id}` | 获取聊天时间线与对话解析 |
| PATCH | `/api/chats/{id}/participants` | 手动纠正“我 / 客户”角色 |
| GET | `/api/customers` | 客户档案列表 |
| GET | `/api/customers/{name}` | 获取客户档案 |
| POST | `/api/customers` | 新建客户 |
| PATCH | `/api/customers/{name}` | 编辑客户档案 |
| POST | `/api/customers/merge` | 合并重复客户 |
| DELETE | `/api/customers/{name}` | 删除客户及其沟通记录 |
| GET | `/api/customers/{name}/projects` | 获取客户项目聚合 |
| POST | `/api/customers/{name}/projects` | 新建客户项目 |
| PATCH | `/api/projects/{id}` | 编辑项目阶段/预算/时间/负责人 |
| DELETE | `/api/projects/{id}` | 删除项目（保留客户时间线记录） |
| GET | `/api/customers/{name}/requirements` | 获取客户需求清单（可按项目过滤） |
| POST | `/api/customers/{name}/requirements` | 新建需求 |
| PATCH | `/api/requirements/{id}` | 编辑需求 |
| DELETE | `/api/requirements/{id}` | 删除需求 |
| POST | `/api/requirements/merge` | 合并多条需求 |
| GET | `/api/customers/{name}/timeline` | 获取客户 360 统一时间线 |
| GET | `/api/files/{name}` | 读取原始截图/附件 |
| GET | `/api/settings/llm` | 获取大模型配置（Key 脱敏） |
| POST | `/api/settings/llm` | 保存大模型配置 |
| POST | `/api/settings/llm/test` | 测试聚合 Key / Base URL 连通性 |
| POST | `/api/settings/llm/models` | 拉取可用模型列表 |
| GET | `/api/wechat/status` | 微信解析引擎/账号/解密状态 |
| GET | `/api/wechat/sessions` | 微信会话列表 |
| GET | `/api/wechat/messages` | 微信消息预览（日期/类型过滤） |
| POST | `/api/wechat/prepare` | 更新微信库（检测/密钥/解密/缓存），异步任务 |
| GET | `/api/wechat/prepare/status` | 微信库更新进度 |
| POST | `/api/wechat/import` | 启动会话提取任务 |
| GET | `/api/wechat/import/status` | 会话提取与 AI 解析进度 |

Sidecar 从 `services/ai/.env` 读取配置（该文件已加入 `.gitignore`）：

```env
MAAS_API_KEY=你的 Key
MAAS_BASE_URL=https://maas.qianwenaiapi.com/compatible-mode/v1
MAAS_ASR_MODEL=qwen3-asr-flash
MAAS_SUMMARY_MODEL=qwen3.8-flash
MAAS_VISION_MODEL=qwen3.8-omni-flash

# 可选：覆盖内置微信库提取引擎路径
# 默认使用项目内 services/wechat-engine/wechat-backend.exe
# WECHAT_DATA_ANALYSIS_BACKEND=D:\path\to\wechat-backend.exe
WECHAT_DATA_ANALYSIS_PORT=10393
```

数据保存在 `services/ai/data/clienthub.db`，删除该文件即可重置演示数据。微信库提取的引擎日志在 `%APPDATA%\wechat-data-analysis-desktop\clienthub-wechat-engine.log`。

微信引擎已经内置在 `services/wechat-engine/`，包含 `wechat-backend.exe` 和 `native/`，不需要用户额外安装 WeChatDataAnalysis。

## 发布与自动更新（GitHub Releases）

本项目使用 `electron-builder` 的 NSIS 安装包 + `electron-updater` 实现自动更新：

- 每次打 `v*` 标签推送（例如 `v0.2.0`），GitHub Actions 会自动构建 Windows 安装包并发布到 Releases；
- 已安装的客户端启动后自动检查更新，发现新版本只提示，不会未经确认自动下载；
- 左上角版本徽标会在有新版本时变黄，点击可查看最新版本、下载进度、重启安装和历史更新；
- 设置页保留“检查更新、下载更新、重启该应用”入口，可调整自动检查频率。

**当前 Release 页面：**

```text
https://github.com/Dingh0208/basu-custom-platform/releases
```

当前正式版本为 [v0.2.7](https://github.com/Dingh0208/basu-custom-platform/releases/tag/v0.2.7)，[下载安装器](https://github.com/Dingh0208/basu-custom-platform/releases/download/v0.2.7/ClientHub-Setup-0.2.7.exe)，大小 **393,894,524 字节（约 393.9 MB / 375.6 MiB）**。新增离线 OCR 模型、ONNX Runtime 与 PDFium 原生依赖随包分发；历史 `v0.2.6` 本机包约 289.3 MB、CI 包约 294.2 MB。已经做了这些轻量化：

- 移除独立的 `ffprobe.exe`，时长探测改由 `ffmpeg` 完成；
- Electron 只保留 `zh-CN` / `en-US` 语言包；
- NSIS 使用 LZMA 压缩；
- 微信引擎、FFmpeg、Sidecar 仍全部内置，不牺牲功能。

**v0.2.7 更新内容：**

- 长音频切片、最多 3 个并发 Qwen ASR 请求、片段缓存和重试恢复；
- 扫描 PDF、图片及多页 TIFF 离线 OCR，DOC/XLS/PPT/PPTX 解析；
- 通知中心、到期提醒、免打扰与待办定位，保持单机单用户；
- 设置页布局和版本更新弹窗，修复打包版 OCR 运行库冲突；
- [发布构建](https://github.com/Dingh0208/basu-custom-platform/actions/runs/41322933804) 与 47 项回归通过，安装器、差分更新文件和 `latest.yml` 已公开发布。

**v0.2.6 更新内容：**

- Sidecar 使用 PID 文件和进程名校验管理，启动和退出时只清理当前 ClientHub 实例；
- 自动更新定时器在退出时清理，检查失败不会产生未处理错误；
- 发布构建不再携带本机 `services/ai/.env`，避免 API Key 进入安装包；
- Windows 微信引擎过滤开发文件、macOS 原生目录和测试夹具；
- Sidecar 构建统一校验 PDF、Word、Excel 解析依赖，安装器名称自动跟随版本号。

**v0.2.5 更新内容：**

- 修复退出软件后残留 Python Sidecar 进程（进程树清理 + 父进程看门狗 + 单实例锁）；
- 修复客户已关联项目但「项目」页显示 0 个项目（项目列表从导入/聊天记录自动同步）；
- 修复旧 Sidecar 残留导致的「测试连接 / 拉取模型」连接失败；
- 项目页重新获得焦点时自动刷新。

**v0.2.4 更新内容：**

- 修复设置页「测试连接」「拉取模型」报错 `Expecting value: line 1 column 1 (char 0)`；
- 修复 Sidecar 读取 `/models` 响应时响应体被提前关闭的问题；
- 设置页请求超时由 2 秒放宽到 60 秒，并补充空响应 / 非 JSON / HTTP 错误提示；
- 首页工作台上线（统计、最近导入、项目阶段分布、最新需求、快捷入口）；
- 设置页精简（移除「通用设置」）与右侧空白布局优化。

完整说明：[v0.2.7 更新内容](<docs/RELEASE-NOTES-v0.2.7.md>) · [v0.2.6 更新内容](<docs/RELEASE-NOTES-v0.2.6.md>) · [v0.2.5 更新内容](<docs/RELEASE-NOTES-v0.2.5.md>) · [v0.2.4 更新内容](<docs/RELEASE-NOTES-v0.2.4.md>)

体积主要来自必须内置的 `wechat-engine`（约 192 MB）和 Electron 运行时（约 180 MB）；如果还需要更小，可以再做“微信引擎首次使用时下载”的 Lite 版本（安装包约 100 MB 级别）。

**首次接入 GitHub 需要做的 2 件事：**

1. 在 GitHub 确认仓库 `Dingh0208/basu-custom-platform` 存在（或新建）；
2. 在仓库的 `Settings → Secrets and variables → Actions` 中确认 `GITHUB_TOKEN` 可用（默认可用，无需手动添加）。

之后推送标签即可自动发版：

```bash
git tag v0.2.0
git push origin v0.2.0
```

> 数据安全：`services/ai/.env`、`services/ai/data/`、`release/`、`build/`、`dist/` 均已加入 `.gitignore`，客户记录、导入文件、已配置的大模型 Key 不会推送到仓库。

## 复盘与优化

- [ClientHub 当前实现复盘与优化记录（2026-10-30）](<docs/REVIEW-2026-10-30.md>)

## MaaS 实测记录（2026-10-29）

- `https://maas.qianwenaiapi.com/compatible-mode/v1/models` 返回 183 个模型；
- `qwen3-asr-flash` 对中文 WAV/MP3 测试音频识别准确，返回完整中文文本；
- `qwen3.8-flash` 可稳定输出结构化 JSON 摘要；
- `https://maas.qianwenaiapi.com/apps/anthropic/v1/messages` 也可正常返回（当前 Sidecar 未使用该端点）；
- 当前 Sidecar 默认模型：ASR `qwen3-asr-flash`，摘要 `qwen3.8-flash`。

### 网络对话音频测试

- 素材：Internet Archive 公开的 [WHS Mandarin 2 Class Phone Conversations 2011](https://archive.org/details/wincamma2-WHS_Mandarin_2_Class_Phone_Conversations_2011)，6 分 01 秒中文双人电话对话；
- 直接调用 `qwen3-asr-flash` 会返回 `The audio is too long`，Sidecar 已实现 **60 秒切片 + 逐片转写 + 拼接**；
- 6 分钟音频共 7 个切片，总转写耗时约 **52–57 秒**，拼接后约 **1,185 字**；
- 全文摘要由 `qwen3.8-flash` 生成，耗时约 **40 秒**，可输出需求、时间、异议、下一步等结构化字段；
- 由于当前模型不提供说话人分离，转写文本统一标记为“说话人”；后续接 diarization 后可区分 A/B。

## 当前截图

- [首页 · 客户情报工作台](<docs/app-screens/home.png>)
- [项目模块 · 全部项目与客户同步](<docs/app-screens/projects.png>)
- [设置 · 大模型配置](<docs/app-screens/settings-final.png>)
- [导入中心（含真实 6 分钟对话测试记录）](<docs/app-screens/import-real.png>)
- [最近导入：文件删除与关联内容清理](<docs/app-screens/import-delete-final.png>)
- [转写与摘要（Sidecar + MaaS 已连接）](<docs/app-screens/transcript-maas.png>)
- [真实 6 分钟双人对话转写](<docs/app-screens/real-dialogue-transcript.png>)
- [客户列表与基础客户 360](<docs/app-screens/customers.png>)
- [客户档案：资料、标签、联系人信息、合并/删除入口](<docs/app-screens/customer-profile.png>)
- [客户 360 项目聚合：阶段、预算、上线时间、负责人和关联记录](<docs/app-screens/customer-projects.png>)
- [客户 360 需求清单：优先级、状态、来源和合并](<docs/app-screens/customer-requirements.png>)
- [客户 360 统一时间线（通话 + 聊天）](<docs/app-screens/customer-360-zhangsan.png>)
- [摘要 · 需求页签](<docs/app-screens/transcript-requirements.png>)
- [摘要 · 原文引用页签](<docs/app-screens/transcript-citations.png>)
- [聊天详情与 AI 对话解析](<docs/app-screens/chat-detail.png>)
- [聊天截图 OCR 导入后的详情页](<docs/app-screens/chat-screenshot-result.png>)
- [聊天附件索引与角色调整入口](<docs/app-screens/chat-attachments-roles.png>)
- [从微信库提取聊天记录（会话/日期/类型选择）](<docs/app-screens/wechat-import-modal.png>)
- [真实微信聊天库导入后的聊天详情](<docs/app-screens/wechat-chat-detail.png>)
- [导入中心（内置 Mock）](<docs/app-screens/import.png>)
- [转写与摘要（内置 Mock）](<docs/app-screens/transcript.png>)

## 已知边界

- 导入记录与转写稿已持久化到 SQLite，刷新不会丢失；
- **音频导入已接真实链路**：前端上传音频 → Sidecar 内置 `ffmpeg` 压缩/切片 → 聚合 ASR 模型转写 → 文本模型结构化摘要；
- 安装包已做轻量化：只内置 `ffmpeg.exe`（`ffprobe` 已由 ffmpeg 时长探测替代），Electron 只保留中文/英文语言包；
- 音频播放仍是模拟进度，不读取真实音频播放；
- 文档支持 PDF 文本层/扫描件、普通图片、DOC/DOCX、XLS/XLSX、PPT/PPTX、EML；复杂版式不保留原排版，Word 97 以前的格式需转换；
- 本轮按用户要求不接入自动说话人分离；保留人工角色标注；
- 长音频按约 55 秒切片，最多并发 3 个 ASR 请求，成功片段缓存支持重试恢复；已验证真实 FFmpeg 和模拟 ASR 并发，数小时真实录音及外部服务额度仍需实测；
- 上传音视频、文档和图片按真实字节计算 SHA-256；无文件内容的历史记录仍按元数据计算；
- 客户识别目前是文件名/文本关键词规则，真实手机号/微信号匹配待接入；
- 微信库提取引擎已内置到 `services/wechat-engine/`，不再依赖用户安装 WeChatDataAnalysis；首次使用需要微信已登录并保持运行以完成密钥获取/解密；
- 微信图片/语音/视频/文件消息会进入附件索引，附件支持本地预览、下载和语音转写任务；普通图片导入可离线 OCR，聊天截图继续使用视觉模型；
- 保持单机单用户，不增加多人协作。系统通知取决于 Windows 原生通知支持；不可用时保留应用内提醒，应用退出后不发送；
- 安装包已接入 GitHub Releases 自动更新，仓库为 `Dingh0208/basu-custom-platform`；

## 后续验收

1. 在正常安装后的 Windows 交互会话验证系统弹窗、点击激活与免打扰；
2. 使用真实数小时录音验证 Qwen ASR 并发额度、耗时及断点恢复；
3. 用实际客户扫描件和 Office 文件验收复杂版式及 OCR 识别效果。
