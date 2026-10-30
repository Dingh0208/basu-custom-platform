# ClientHub · 客户信息聚合工作台

Sprint 1 可运行原型：**导入中心 → 录音转写 → 七字段 AI 摘要**。

当前版本包含 **Python Sidecar（本地 HTTP API，标准库零依赖）+ SQLite 持久化 + Mock AI**；接口按 FastAPI 风格设计，后续可无缝切换为 FastAPI。Sidecar 不可用时前端自动回退到内置 Mock 数据。

## 快速启动

> Sidecar 需要本机安装 Python 3.11+；当前使用标准库，无需 `pip install` 依赖。

```bash
# 1. 安装依赖
pnpm install

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
- 粘贴截图：选择图片文件模拟截图导入；
- 本地 Sidecar 接收导入记录并写入 SQLite；
- 音频按真实文件字节计算 SHA-256，其他文件按元数据计算；
- 自动识别客户 / 待归档提示；
- 导入进度轮询、处理流程提示；
- AI 处理模式切换：阿里云百炼 / Mock。

### 2. 转写与摘要

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
- 重新处理、导出纪要、添加待办（原型模拟）。

### 3. 客户模块

- 客户列表：客户名、公司、职位、当前项目、最近沟通、记录数、状态；
- 搜索客户 / 公司 / 职位 / 标签；
- 客户档案：姓名、公司、职位、手机号、微信号、邮箱、标签、来源渠道、负责人、备注；
- 新建客户、编辑档案、重复客户合并、客户删除；
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
- 附件索引：原始截图、图片/语音/文件/链接消息统一列出，图片可预览；
- 已用真实样例 `Martin Zhong / 梧桐` 验证 11 条消息；已用两张微信聊天截图验证 13 条 / 31 条消息的 OCR 与结构化解析。

### 5. 从本地微信聊天库提取

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
- **音频导入已接真实链路**：前端上传音频 → Sidecar `ffmpeg` 压缩 → `qwen3-asr-flash` 转写 → `qwen3.8-flash` 结构化摘要；
- 音频播放仍是模拟进度，不读取真实音频播放；
- 其他文件类型（PDF/Word/Excel/图片/压缩包）仍走模拟解析；
- 说话人区分尚未实现，真实转写统一标记为“说话人”，后续接 diarization；
- 长音频已按 60 秒切片，6 分钟对话实测通过；数小时级别音频仍需任务队列与分批调度；
- 文件 SHA-256 对音频按真实字节计算，其他文件按元数据计算；
- 客户识别目前是文件名/文本关键词规则，真实手机号/微信号匹配待接入；
- 微信库提取引擎已内置到 `services/wechat-engine/`，不再依赖用户安装 WeChatDataAnalysis；首次使用需要微信已登录并保持运行以完成密钥获取/解密；
- 微信图片/语音/视频/文件消息会进入附件索引，实际媒体文件的离线复制与语音转写仍可继续扩展；
- Electron 安装包（NSIS）与 PyInstaller 打包尚未接入，当前 Electron 壳可直接加载 Vite 页面。

## 下一步

1. 长音频切片与并发转写（ffmpeg segment + Qwen ASR）；
2. 说话人分离（ASR diarization 或本地声纹）；
3. 其他文件类型解析：PDF/Word/Excel/图片 OCR；
4. 打包 electron-builder NSIS 安装包 + PyInstaller Sidecar；
5. 按 PRD Sprint 2 接聊天解析与客户 360。
