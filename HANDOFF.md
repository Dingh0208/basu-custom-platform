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
10. 销售待办、批量归档与全局搜索。

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
  - 数据与备份（数据库占用、备份数量、导出、恢复）；
  - 本地服务诊断（Sidecar API 修订、FFmpeg、微信引擎、账号数量、重启服务）；
  - 导入默认值（默认项目、负责人、自动识别和自动处理偏好）；
  - 更新设置（自动检查和频率）；
  - 隐私与关于（DPAPI 密钥存储、版本和本地文件说明）。
- API Key 可在设置页删除；Windows 使用 DPAPI 加密文件，备份中不包含密钥。
- 首页工作台：Hero、客户/项目/需求/待归档统计、最近导入、项目阶段分布、最新需求、快捷入口；
- 默认启动页为首页。

### 2.4 打包 / 更新 / GitHub

- GitHub 仓库：`https://github.com/Dingh0208/basu-custom-platform`
- 默认远程 `origin` 已指向 GitHub；
- `services/wechat-engine/**` 使用 **Git LFS**（约 201MB）；
- `.github/workflows/release.yml`：推送 `v*` tag 自动构建 Windows NSIS 并发布 Release；
- 工作流使用 `npm`（不要再用 pnpm，GitHub Actions 上 pnpm 报过 `packages field missing or empty`）；
- `electron-updater` 已接入，启动检查 + 每 3 小时后台检查；侧边栏头像附近显示更新/下载进度和“重启并安装”；
- 当前正式 Release 为 `v0.2.6`，CI 安装包约 **294.2MB**；本机 CPython 3.12 构建包约 **289.3MB**，体积会随 FFmpeg 下载版本略有变化；
- v0.2.6 包含 Sidecar PID 生命周期、发布包密钥隔离、微信引擎过滤和安装器版本命名修复；v0.2.5 / v0.2.4 / v0.2.3 为历史版本。

## 3. 当前卡点 / 状态

### 2026-11-01：设置中心扩展（工作区已实现，未重新发布）

- 设置页拆为大模型、数据与备份、本地服务诊断、导入默认值、更新设置、隐私与关于六个分区。
- 新增 `GET /api/diagnostics`，展示 Sidecar API 修订、数据目录、数据库占用、备份数量、FFmpeg、微信引擎和密钥存储方式；打包版支持从设置页重启 Sidecar。
- API Key 支持从 Windows DPAPI 存储中删除；应用设置支持默认项目、负责人、自动识别、自动处理和更新频率。
- 设置页会在进入时读取诊断和备份信息，保存更新频率后同步 Electron 的后台检查定时器。
- 验证：前端构建、Python 编译、Electron 语法检查、34 项 SQLite/API 回归测试和临时数据库设置诊断 smoke test 通过。尚未重新打包 v0.2.7。

### 2026-10-31：界面与数据一致性修复（工作区已实现，未发布）

- 「待归档」独立为资料列表、资料详情、批量归属确认三部分，不再复用导入中心。点击未归档文件直接进入并选中该资料；已解析的资料可预览内容，再确认客户、项目、负责人。
- 首页纵向内容禁止被 Flex 压缩，保留顶部 Hero 和统计卡片的自然高度；内容超出窗口时滚动。导入中心左栏可滚动，「最近导入」至少 360px，AI 任务列表放在其后，归档表单移到独立页面。
- 客户详情/销售待办在本地服务连接后重新加载，失败可重试；旧服务缺少销售接口时提示重启。此次实际故障是 8765 端口残留的旧 Python 服务，销售接口返回 404；已备份本地库并启动当前源码服务，实际客户跟进接口返回 200。`/api/health` 当前为 `apiRevision: 4`。
- 删除客户前明确提示关联项目、需求、待办和沟通资料也会删除；删除响应包含项目数，刷新导入中心项目候选。删除时取消该客户未完成的 AI 任务；读取已删除客户的项目不会创建客户。演示数据只在首次建库时写入，删除后的空库重启不再重新生成客户和项目。
- 点击左下角头像编辑姓名、职位、公司、手机号、邮箱，保存后侧栏即时更新，刷新后保留。`GET/POST /api/profile` 使用现有 `settings` 表的 `profile.*` 键，纳入既有数据库备份；姓名必填，字段限制 120 字。这是本机个人资料入口。
- 验证：前端构建、Python 编译、34 项隔离 SQLite/API 回归测试通过。浏览器实测独立归档、客户跟进、待办、客户级联删除与刷新、个人信息保存与刷新；1440×900、1280×800、2492×1415 首页顶部内容完整，导入列表可滚动，未发现页面运行错误。v0.2.6 已由 GitHub Actions 构建并发布，尚未完成 Windows 虚拟机自动更新端到端验证。

### 2026-10-31：P1 销售工作闭环（工作区已实现，未发布）

- 通话摘要/聊天解析的需求可保存并打开客户 360 中的对应需求；需求新增负责人、截止日期，并可创建关联待办。待办保存客户、项目、需求 ID、来源 ID、原文、负责人、截止日期和完成时间，支持编辑、完成、取消与重新开启。
- 侧栏「待办」可查看待跟进、逾期、已完成和全部事项；「首页」增加今日到期与逾期提醒；项目列表中的客户可点击进入客户 360。
- 侧栏「待归档」可批量选择已处理记录，一次确认客户、项目、负责人；关联聊天、转写、需求、待办在同一事务中同步，任一校验失败整批回滚。每批最多 200 条；处理中、失败、取消的资料需先完成处理；新客户/项目先创建再刷新候选。
- 客户 360 增加下一步动作确认、风险原文、最近沟通、今日到期、逾期与超过 7 天未沟通提示。聊天优先用实际结束日期；历史仅有 HH:MM 的记录不猜测日期。AI 中的「下周」等时间由用户确认具体日期后再保存待办。
- 侧栏「全局搜索」或 `Ctrl/Cmd+K` 打开本地关键词搜索，覆盖客户、项目、聊天全文、转写全文/摘要、需求及来源原文；可按类型筛选，点击跳转对应记录。每类最多返回 20 条并显示完整匹配数量，关键词最多 100 字；不是语义搜索。
- 客户/项目改名、客户合并、聊天角色修正、需求合并/删除时同步销售待办关系。合并需求后保留待办原始证据；编辑需求描述不覆盖待办独立确认的执行人/日期；完成待办不自动将需求标为「已实现」。
- 摘要「保存修改」已接入持久化 PATCH，部分字段更新保留其他字段。新增待办已纳入 SQLite 备份与恢复，旧库/旧备份会幂等补充字段。

实现入口：`services/ai/sales.py` 管理销售待办、迁移、批量归档、跟进聚合和搜索；`main.py` 负责 HTTP 路由及既有实体联动。销售 `todos` 与 P0 的 AI 处理队列 `tasks` 分开，避免取消 AI 任务影响业务待办。未引入新依赖。

```text
GET   /api/todos?customer=
POST  /api/todos
PATCH /api/todos/{id}
POST  /api/imports/archive          {ids,customer,project,owner}
GET   /api/customers/{name}/followup
GET   /api/search?q=
PATCH /api/transcripts/{id}/summary {summary:{...}}
```

验证：`pnpm build`、Python 编译、`git diff --check` 通过；`services/ai/test_sales.py` 的 21 项隔离 SQLite/API 回归测试通过，覆盖迁移、归档回滚、来源别名、改名/合并/删除、独立执行人/日期、备份恢复与搜索结果数量。浏览器已验证需求/项目搜索定位、项目返回客户 360、确认下一步动作、创建关联待办、完成与刷新持久化、返回来源摘要、批量归档、Ctrl+K/Esc；1024px 待办页无横向溢出，未发现控制台错误。测试数据库与实际用户数据分开。提醒当前呈现在应用内；负责人为姓名字段，尚无多用户账号和系统通知。

1. **设置页右侧空白**：刚把 `.settings-workspace` 从固定 `760px + 420px` 改成 `1.35fr + 0.65fr` 并拉伸卡片高度；需要再截图确认 2503px 宽度下右侧是否仍空。修改在 `src/styles.css`。
2. **本地开发数据库状态**：`services/ai/data/clienthub.db` 当前只有少量测试数据（2 个客户、4 条导入），不是完整演示数据；不要随意清空，先确认用户数据。
3. **v0.2.6**：`package.json` 版本 `0.2.6`，已提交并发布 `v0.2.6` tag；发布构建不带 `.env`，Sidecar 使用 PID 文件管理。v0.2.5 已发布，设置页「测试连接 / 拉取模型」、退出残留 Sidecar、项目列表同步问题已修复。
4. **微信真实账号检测**：当前开发机 `GET /api/wechat/status` 返回 `available:true`，但 `accounts:[]`，没有真实微信库可测；需要在登录微信的 Windows VM 上验证。
5. **大模型 `/models` 接口**：部分聚合平台返回非 JSON 或 401；设置页“测试连接”已改为真实 `/chat/completions` 最小请求，已验证 `{"status":"ok"}`。但“拉取模型”仍依赖 `/models`，若平台不支持会报错，属正常边界。
6. **自动更新**：代码和 release 工作流已接入，但尚未在真实旧版本安装包上完成一次“下载→进度→重启安装”的端到端实测；需要 VM 验证。

### 2026-10-31：识别质量与附件闭环（工作区已实现，未发布）

- 新增 `services/ai/requirements.txt`，Sidecar 开发与 CI 构建都安装 `pypdf`、`python-docx`、`openpyxl`；Windows 打包前会验证这些库已安装，避免只在开发环境解析成功。
- PDF 文本层、DOCX 段落/表格、XLSX 工作表/单元格、EML 正文可解析。限制 200 页 PDF、50 张工作表、10,000 行/表、100,000 字；邮件最多保存 20 个附件、每个 25 MB、合计 100 MB。导入文件最大 100 MB。扫描 PDF 明确提示需要 OCR；旧 DOC/XLS 与 PPT 不在当前解析器范围。
- 文档/邮件及其附件现在写入本地 uploads，API 可提供只读预览与副本下载；文档附件元数据进入 SQLite，源文件及副本进入现有本地备份。现有数据库会补充 `transcripts.attachments_json`，旧备份恢复时也会幂等迁移。
- 保存语音附件的转写任务写入现有 `tasks` 队列，支持断点恢复、取消和失败后重试；聊天和文档详情均可播放音视频、预览图像/PDF/可提取正文、下载附件。附件转写文本参与全局搜索。
- 摘要显示原文证据覆盖度。只有模型提供、且可在原文中逐字核对的证据会通过门槛自动创建需求。聊天中的 AI 建议也保留证据核对状态；用户可以人工确认后跟进。
- 人工修改摘要、逐段校正原文/我方/客户角色、调整聊天成员角色均有 before/after 校正历史；原文变更后清除旧摘要证据和覆盖度。摘要可按已保存的最新原文重新生成，并防止并发原文校正被摘要结果覆盖。
- 当前 MaaS ASR 只返回纯文本；通话说话人保持未确认，由用户逐段标注，未伪造自动声纹分离结果。微信群聊成员仍来自实际发言人，角色修正不把已选定的客户错误切换为第一位成员。自动说话人分离、扫描件 OCR、旧版 Office 格式仍需后续接入并单独验证。
- 摘要与解析输入超过 12,000 字时采样首尾段，避免长通话只读取开头；空白 PDF 页会正确跳过；文件导入在前端与 Sidecar 增加大小限制。
- 本次 Sidecar API 修订为 `4`；请完整重启旧的本地服务后使用新预览/重新生成接口和产品指标。

```text
GET  /api/files/{storedName}/preview
POST /api/transcripts/{id}/attachments/transcribe {attachmentId}
POST /api/chats/{id}/attachments/transcribe {attachmentId}
POST /api/transcripts/{id}/regenerate-summary
```

验证：`pnpm build`、Python 编译、`git diff --check` 和 `services/ai/test_sales.py` 的 32 项隔离 SQLite/API 测试通过。覆盖旧库迁移、PDF/DOCX/XLSX/EML 解析边界、邮件附件持久化/预览/备份恢复、两类记录的语音转写队列、无效校正原子拒绝、证据失效/恢复及群聊客户身份保持。没有连接 MaaS 或真实微信账号执行端到端识别，也没有将自动声纹分离或 OCR 标成已支持。

### 2026-10-31：核心产品指标与观测优化（工作区已实现，未发布）

- 新增 `sales.metrics()` 与 `GET /api/metrics?days=1..90`，首页复用 `/api/dashboard` 同一响应中的 `metrics`，避免额外请求；默认窗口为近 7 天。
- 已实现导入成功率、解析完成率、解析耗时 P95、摘要转需求有效率、沟通结束到创建待办平均耗时、周活跃客户/项目数。每项返回 `value`、分子、分母、单位和说明；没有可验证样本返回 `null`，避免把“未测量”当成 0。
- 新增 `customer_match_audits` 审计表。当前归档只记录人工确认，自动匹配准确率仅接受 `method='auto'` 且有人工确认结果的样本，开发库没有这类样本时会显示“—”。
- 为指标查询补充按状态/时间/来源的 SQLite 索引；旧库迁移会检查表和字段后再建可选索引，不影响最小旧库升级。
- 测试新增指标率、P95、平均耗时、活跃客户/项目和无样本准确率用例；本轮回归共 34 项隔离 SQLite/API 测试通过，前端构建和 Python 编译通过。

```text
GET /api/dashboard             # 首页统计 + metrics
GET /api/metrics?days=7        # 独立读取指标
```

## 4. 下一步计划

1. 在 Windows VM 安装 v0.2.6，验证：
   - 微信库更新/账号检测；
   - 音频导入；
   - 聊天解析；
   - 自动更新检查（需要下一次 release）。
2. 验证自动更新下载、进度显示和重启安装。
3. 如需进一步压缩安装包：当前约 289.3MB 的瓶颈是 `wechat-engine` 192MB、Electron 180MB 和 FFmpeg；可做“微信引擎首次使用下载”的 Lite 版（约 100MB 级），但会增加首次使用联网依赖。

## 5. 关键文件

```text
electron/main.cjs          Electron 主进程、Sidecar 启动、自动更新、安装更新 IPC
electron/preload.cjs       contextBridge：update 状态/安装
src/App.tsx                页面路由（home/import/inbox/customers/projects/todos/settings/chat/transcript）
src/components/HomePage.tsx
src/components/ImportCenter.tsx
src/components/CustomerList.tsx
src/components/ProjectPage.tsx
src/components/SettingsPage.tsx
src/components/Sidebar.tsx
src/components/TodoWorkspace.tsx
src/components/TodoModal.tsx
src/components/InboxArchive.tsx
src/components/GlobalSearch.tsx
src/components/PersonalProfileModal.tsx
src/api/client.ts
src/types.ts
src/styles.css
services/ai/main.py        Sidecar API / SQLite / MaaS / 客户/项目/需求/设置
services/ai/sales.py       P1 销售待办 / 批量归档 / 跟进 / 全局搜索
services/ai/test_sales.py  临时数据库与 HTTP API 回归测试
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

# P1 回归测试（使用临时数据库，不接触现有用户数据）
python -m unittest discover -s services/ai -p test_sales.py -v

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
GET  /api/settings/app
GET  /api/diagnostics
POST /api/settings/llm/test
GET  /api/customers
GET  /api/customers/{name}/projects
GET  /api/customers/{name}/requirements
```

## 8. 备注

- 本文件不含任何真实 API Key、密码或客户隐私数据。
- 最新正式 Release：`v0.2.6`；v0.2.5 / v0.2.4 / v0.2.3 为历史版本。
- 若新会话需要继续，先读本文件，再检查 `git status` 和 `release/`，不要重新从零猜架构。
