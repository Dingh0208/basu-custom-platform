# ClientHub 交接文档（HANDOFF）

> 写给完全没有上下文的新会话。当前项目位于 `D:\code\Basu-Custom-Platform`，目标是交付一个 Windows 桌面客户情报工作台 ClientHub。

## 0. 当前交接总览（新会话先读这里）

> 本节是当前状态的唯一准确信源。文档后面的“2026-11-02 第 1–6 次开发”等章节是历史记录，里面的 API revision、测试数量和“待实现”描述可能早于当前代码，不要用它们覆盖本节。

### 0.1 当前任务

当前新增的**资料模块与共享 AI 自动导入开关**已完成源码开发并合入主 PRD。当前源码 Sidecar API revision 为 18；本轮 `npm run build`、69 项 `test_sales.py`、Python 编译和 `git diff --check` 均通过。API18 功能尚未重新打 NSIS 包或安装验收，也未提交、推送或发布。ClientHub `v0.2.9` 仍是此前 API17 版本的 Latest Release，不含本轮 API18 改动；不连接远程云服务器。产品继续保持 Windows 单机单用户边界。

完整目标链路是：

```text
选资料 → 发送前确认 → 分批分析 → 问题/证据 → 记录回答 → 手动追问
       → 预览并确认回写需求/项目 → 复制或 Word/PDF 导出 → 历史继续跟进
```

主 PRD 已合并需求澄清助手内容：

- 主文档：`docs/PRD-客户信息聚合工作台-v1.0.md`
- 访谈追溯文档：`docs/PRD-客户需求澄清助手.md`
- 资料模块与共享 AI 自动导入需求：主 PRD 第 6.16 节
- API17 本机交付验收：`docs/DELIVERY-API17-2026-11-03.md`
- 项目交接文档：本文件 `HANDOFF.md`

### 0.2 当前代码和工作区状态

- 当前分支：`main`。
- 当前工作区有本会话之前和本会话产生的**未提交改动**，不能 reset、clean 或覆盖；先执行 `git status --short --branch`，只处理能归因于当前任务的文件。
- 当前最新正式版本为 `v0.2.9`，上一版本是 `v0.2.8`；本次需求澄清助手和发布配置已提交并推送，Release 已公开。
- 当前源码 Sidecar API revision 是 **18**，应用版本仍为 `0.2.9`；本轮改动未打包。API17 本机安装验收记录 `docs/DELIVERY-API17-2026-11-03.md` 只代表先前版本，不覆盖 API18 资料功能。
- 本次新增/重点文件：
  - `services/ai/clarifications.py`：需求澄清 SQLite 表、迁移、快照、问题、证据、回答、生命周期、增量资料和指标统计。
  - `services/ai/main.py`：澄清 API、持久化任务队列、模型调用、分批分析、追问、回写和指标/复制记录接口。
  - `services/ai/test_sales.py`：隔离 SQLite/API 回归测试。
  - `src/components/ClarificationWorkspace.tsx`：历史列表、资料选择、分析进度、问题工作台、回答、追问、回写、追加资料、问题归属。
  - `src/components/MaterialsPage.tsx`：资料列表、状态/类型/客户/项目筛选和预览入口。
  - `src/components/ImportCenter.tsx`、`src/components/SettingsPage.tsx`：共享 AI 自动导入开关。
  - `src/api/client.ts`、`src/types.ts`、`src/styles.css`：对应 API、类型和界面样式。

### 0.3 已完成范围

#### 需求澄清助手第 1–5 次开发

- SQLite 迁移和五类核心实体：澄清单、资料快照、问题、证据、回答；迁移可重复执行。
- 侧栏独立入口、历史列表、草稿、客户/项目/未归属资料筛选、逐条勾选和全选。
- 发送前逐条确认资料名称、类型、归属、可读性和默认文本模型；不可读资料显示原因，没有可读资料时禁止分析。
- 真实模型分析：读取聊天、转写、文档/OCR 文本，按输入长度分批，保存原文证据、来源、时间和快照。
- 持久化任务状态、进度、取消、失败原因、部分结果保留、失败/取消后的重试和应用重启恢复。
- 问题按客户/项目分区，优先级外层、固定行业维度内层；支持事实、推断、缺口、冲突和低置信度信息。
- 支持问题编辑、优先级/维度调整、标记已问、回答历史、不适用、逻辑删除、自定义问题和手动生成追问。
- 回答可先预览再转为需求或更新项目；只预填回答有依据的字段，新需求默认“待确认”，回写保存问题/回答来源。

#### 第 6 次开发及补全

- 历史记录支持客户、项目、状态、日期筛选；记录可归档、恢复、删除和复制为新草稿。
- 对外问题支持按客户/项目复制文本、导出 Word、打印保存 PDF；对外内容不包含内部理由、证据、置信度和模型信息。
- `clarification_sources.analyzed` 已加入幂等迁移，区分已经分析和等待增量分析的资料。
- 已生成的澄清单可通过 `POST /api/clarifications/{id}/sources/append` 追加资料；按来源 ID、内容哈希和名称去重，旧资料、旧问题、回答和证据不被覆盖。
- 追加后可启动增量分析，只读取未分析且可读的新资料；新问题与旧问题精确去重并合并证据。
- 模型返回 `conclusionType=conflict` 时强制保存为 `must_confirm`，保留冲突资料的双方证据。
- 未归属问题可以在工作台勾选后批量设置客户和项目归属；这是当前已实现的“按问题拆分”路径，原始资料和证据仍保留。
- 增量追加会清零本轮批次计数；失败或取消后重试会跳过已完成批次，避免重复调用模型。
- 指标按澄清单记录首次完成时间；生成问题包括初始分析、增量分析和追问，保留数按未删除计算，复制和已问按问题首次事件时间去重；参与率分子为三类问题的去重并集。
- 历史页展示前 10 份完成分析的指标基线；新字段不会为功能上线前的历史操作补造复制/已问数据。

#### 客户/项目快捷入口补全（2026-11-03）

- 客户详情、客户项目卡片及共用项目详情弹窗新增“需求澄清”入口；进入新建选材页并带入当前客户/项目筛选。
- URL 保存客户和项目，刷新后保留入口范围；项目筛选同时匹配客户，避免跨客户的同名项目资料混入。
- 入口不自动勾选资料、不创建空工作单、不启动分析；无资料客户/项目仍保留筛选值并显示空状态。侧栏入口继续打开全局历史，新建分析无旧范围。
- `npm run build`、`git diff --check` 通过；Edge + 隔离 API mock 的 8 项浏览器检查通过，包含上述入口、刷新、同名隔离、零自动写入和手动选材后的发送确认，无页面异常。未调用真实模型。
- 当前保留的 NSIS 包早于这次入口补全，不包含本次新增入口；按用户要求没有重新打包。

#### 按次生成语言补全（2026-11-03）

- 选材页新增“生成语言”，默认简体中文，可填写 English、日本語等语言名称（最多 32 字符）；空白语言禁止保存和进入发送确认。
- 新建/修改草稿保存语言；历史打开和复制草稿恢复语言；普通新建恢复简体中文。旧记录的 `zh-CN` / `en` 显示为简体中文 / English。
- 发送前确认展示已保存的语言；开始分析后锁定编辑，增量和重试沿用原语言，复制为新草稿后可修改。
- 初次/增量各批次及基于回答的追问都使用工作单语言生成问题和提问理由；提示词要求分类枚举、客户/项目标识保持约定值，证据逐字引用原文，不翻译。
- 源码 Sidecar API revision 升为 16；未修改数据库结构、未下载依赖或重新构建安装包，未提交/推送/发布，未调用真实模型。
- 新增完整的语言持久化→初次分析→增量→回答追问回归，并补充默认中文和失败重试语言检查；56 项 `test_sales.py`、前端构建及 10 项 Edge + API mock 浏览器检查通过。浏览器覆盖空白校验、空格处理、历史刷新恢复、草稿改名/语言同时保存、确认展示、生成后/增量锁定、复制继承、新建重置、旧代码显示和 390px 窄屏。

#### 证据来源跳转补全（2026-11-03）

- 问题证据新增“查看原始资料”：通过 `sourceSnapshotId` 匹配本单保存的资料快照，再用快照的 `sourceId` 查找当前导入记录及聊天/转写；不使用模型生成的 `sourceReference` 作为路由目标。
- 已完成但未归属的文档/聊天允许直接预览；不同客户的同名项目按资料 ID 跳转，原始资料和归属不被修改。
- 来源页 URL 携带原澄清单 ID；聊天/转写页返回及刷新后返回均恢复原单。澄清页 `?view=clarifications&id=<记录ID>` 也可直接恢复；侧栏入口仍打开全局历史。
- 已删除或加载失败的来源不离开当前澄清单，证据快照保留。来源页刷新失败显示明确提示及“返回澄清单”，不显示其他客户或示例内容。
- `answer:<问题ID>` 类型的追问证据定位并展开原问题/回答；原问题缺失时保留回答证据快照。无匹配快照的证据显示未关联说明。
- 修复从澄清单进入来源页时，390px 窄屏顶部按钮遮挡“返回”的问题。本次跳转到完整来源记录，尚不提供摘录段落高亮或音频时间点定位。
- 16 项 Edge + 隔离 API mock 浏览器检查、`npm run build` 和 `git diff --check` 通过；全流程无页面异常、无自动写入、无模型调用。只修改前端和交接文档，源码 API revision 仍为 16，未重新打包、提交、推送或发布。

#### 按资料分配未归属结果补全（2026-11-03）

- 问题工作台新增“按资料选择问题”，使用本单保存的资料快照 ID 与证据关联，原文件删除后资料快照仍可用于筛选；不使用模型的 `sourceReference` 匹配资料。
- 可批量勾选仅关联所选资料的未归属问题；基于回答的追问通过 `answer:<问题ID>` 追溯原问题证据。已完整归属、已删除和其他资料的问题不被自动勾选。
- 引用多份资料的问题显示标记并默认不勾选，老板可手动选择；分配保留同一个问题和全部资料证据，不复制问题或自动重生。
- 按问题和按资料统一经过“预览分配 → 确认分配”；预览列出问题、当前/目标归属与证据资料，返回调整不写入。
- 只补充未归属的客户/项目；已有值与目标冲突时阻止整个分配，未指定新项目时保留原项目。目标项目按客户筛选，原始导入记录及资料快照的归属保持不变。
- 复用现有问题 PATCH 接口逐项保存；部分失败后立即保留成功结果，只勾选失败项供重试。这不是数据库原子批量操作，界面明确显示成功/失败数量。
- 新增实际 SQLite/API 回归，验证分配后问题 ID、文本、状态、回答历史、追问关系和双方证据完整保留，原始导入、转写和资料快照均未修改，无模型调用。
- 57 项后端回归、14 项 Edge + API mock 浏览器检查、TypeScript/Vite 构建及差异检查通过。浏览器覆盖跨资料选择、归属冲突、预览不写入、部分失败重试、同名项目隔离、已有项目保留、刷新及 390px 窄屏。
- 本轮未修改后端业务代码或数据库结构，API revision 仍为 16；未重新打包、连接远端、提交、推送或发布。

#### 流程缺口修复及最终开发回归（2026-11-03）

- 修复前端传导入 ID 时，聊天/转写资料不能读取正文的问题；模型不能改写资料保存的客户/项目归属，证据来源名称和时间采用实际快照。
- 每批仅提供同客户/项目的旧问题及已验证历史证据；初次后续批次和增量分析均可引用旧证据，冲突保留新旧双方原文，不混入其他客户问题。
- 修复追加资料无法勾选、未经过发送确认就分析、启动失败缺少重试入口及重试误回到全量分析的问题；不可读资料也保留在确认清单和快照中。
- 展示事实/推断/缺口/冲突、低于 0.6 的待核验标记及完整回答历史；同秒多次保存按实际保存顺序显示，追问、回写和回写记录都使用最新回答。
- 新需求默认 P1，与澄清优先级分开；项目回写默认只提交回答说明，阶段/负责人仅在用户修改时提交，预算和日期由用户手填。
- 历史列表纳入按问题分配后的归属，显示客户/项目、问题数、未完成数及更新时间；修复无筛选快照时的历史筛选穿透和未归属 Word 导出范围；已生成单可改名，新建默认按所选客户/项目及日期命名。
- 开发验收与 PRD 对应关系见 `docs/CLARIFICATION-MVP-ACCEPTANCE-2026-11-03.md`。源码 API revision 升为 17，未改数据库结构。

#### 资料模块与共享 AI 自动导入（2026-11-03）

- 新增资料页，复用现有导入记录，支持全部/待归档/已关联状态筛选，以及资料类型、客户、项目过滤；原件可通过 Sidecar 预览，解析内容沿用现有聊天/转写查看路径。
- 设置页和导入中心共用持久化的 `aiImportEnabled`。新安装默认关闭；旧设置按原 `autoMatch` 与 `autoProcess` 偏好迁移；只影响之后新导入的资料。
- 关闭时保留手动客户/项目关联，不做自动客户匹配或自动 AI 任务。普通文档、邮件、文本和聊天做本地解析，截图使用离线 OCR；音视频只保留原件。
- 需求澄清开始分析后，只对用户选中的未转写音视频执行 ASR。资料筛选和原件预览增加 API 支持。
- 源码 Sidecar API revision 升为 18；新增默认值/旧设置迁移、关闭模式导入、手动关联保留、原件预览、资料筛选和澄清时延后转写回归。
- 本轮 69 项 `test_sales.py`、Python 编译、前端构建和 `git diff --check` 通过。尚未生成 API18 NSIS 包或做 Windows 安装验收；未提交、推送、发布，也未连接远程主机。

### 0.4 当前验证证据

本轮 API18 源码验证：`npm run build` 通过；`python -m py_compile services/ai/main.py services/ai/document_ingest.py services/ai/wechat_engine.py services/ai/test_sales.py` 通过；`python -m unittest discover -s services/ai -p test_sales.py -q` 共 69 项通过；`git diff --check` 无空白错误。此处不代表 API18 已打包或安装验收。

本机 API17 完整交付证据见 `docs/DELIVERY-API17-2026-11-03.md`：独立 Python 3.12.13 构建环境的 75 项完整后端回归、前端 TypeScript/Vite 构建及 NSIS 安装版 35 项检查通过。模拟模型调用 7 次，真实模型调用 0；涵盖 9 种资料解析、离线 OCR、工作单操作、回写、取消/续跑、缺少 Key、重启和导出。Word 已实际保存；Windows 原生“另存为”已保存 36,090 字节 PDF，中文内容可提取，不含内部理由、证据或模型数据。API15→17 覆盖安装前后，SQLite 五类澄清数据逐行一致，共 23 行。另有 63 项开发业务、4 项通知和 14 项真实前后端流程回归；与早期 14 项归属检查是不同测试集。

API17 浏览器 fixture 当时输出 `FIXTURE_CLEANED` 并自动清理数据库；该轮验证服务和 Vite 已退出。脚本从内存执行，未新建依赖环境、大型验收目录或安装包。浏览器阶段 PDF mock 只验证打印调用和对外内容；Windows 原生 PDF 保存已在 API17 安装版验收（见上一段）。

API17 开发阶段留下的历史检查命令与计数如下；当前 API18 结果以上方 69 项测试记录为准：

```powershell
python -m unittest discover -s services/ai -p test_sales.py -q
# Ran 63 tests ... OK

python -m unittest discover -s services/ai -p test_notifications.py -q
# Ran 4 tests ... OK

npm run build
python -m py_compile services/ai/main.py services/ai/clarifications.py services/ai/test_sales.py
git diff --check
```

`git diff --check` 只输出 Windows 工作区的 LF/CRLF 警告，没有空白错误。

本次 API17 包另在隔离安装版中通过 9 种资料格式解析、真实离线 OCR、API15→17 手动覆盖升级、实际 PDF/Word 文件导出、应用重启和卸载验收。更早的 API15 记录仍只代表历史包；当前包的清单、散列和边界见 API17 交付记录。

早期本地开发服务曾验证以下地址：

- 前端：`http://localhost:5173/?view=clarifications`
- Sidecar：`http://127.0.0.1:8765`
- 历史健康结果：`version=0.2.8`、`apiRevision=15`、`status=ok`；这是早期开发服务，不代表 API17 安装包。
- 本轮本地预览：前端 `http://127.0.0.1:5173/` 和 Sidecar `http://127.0.0.1:8765` 均在运行；`GET /api/health` 返回 `status=ok`、`version=0.2.9`、`apiRevision=18`。Sidecar 使用仓库默认数据目录 `services/ai/data`；启动前没有排队任务或处理中导入。
- `GET /api/clarifications/metrics` 正常；当前本机历史完成分析数为 0。
- 临时数据库 1,000 条澄清历史列表读取约 0.016 秒，指标汇总低于 0.001 秒。

新会话开始时不要假设服务仍在运行，先访问 `/api/health` 和前端地址；若 8765 返回 API 18 以下，说明端口上是旧 Sidecar，不能作为本轮源码验证证据。本轮回归使用独立端口 18765，不操作真实用户数据库或已有业务服务。

### 0.5 当前卡点和明确未完成项

本轮 API18 源码开发和回归已完成；API18 的 NSIS 打包、Windows 安装验收及发布未进行。API17 的历史安装结果只适用于 `v0.2.9`。以下仍是独立的环境边界或历史事项：

1. 本机 Windows 安装版和 API15→17 覆盖升级已通过，且实际生成 PDF。全新 Windows 10/11、真实模型和自动更新下载→重启安装链路仍未验收；用户已停止远程工作，不再连接云服务器。
2. 真实 MaaS 模型联调尚未作为自动化测试执行；回归测试使用 `patch('main.maas_request', ...)`，不要在测试中调用真实 API 或消耗 Key。
3. 指标持久化与历史页展示已完成；基线只纳入功能上线后记录完成时间的分析，不回填上线前无法追溯的复制/已问操作。
4. 按问题/资料分配均已实现；引用多份资料的问题需手动选择并整体分配，预览后确认，只补充缺失归属，保留问题/回答/证据和原始资料。归属保存逐项执行，部分失败时只重试失败项。
5. 缺少 `xlrd` 的构建卡点已在此前解决。独立 Python 3.12.13 环境和 RapidOCR 1.4.4 构建的 API17 包通过 9 种文档/邮件/图片格式解析、真实离线 OCR、澄清失败保留/取消续跑/增量冲突、回写和安装版导出检查。API17 最终安装结果见 `docs/DELIVERY-API17-2026-11-03.md`；`docs/INSTALLER-ACCEPTANCE-2026-11-03.md` 是 API15 历史记录。
6. `v0.2.9` 曾正式发布；Windows workflow `41585489196` 成功，Release Notes、NSIS 安装包、`.blockmap` 和 `latest.yml` 均已核验。该版本不含本轮 API18 资料模块及共享开关改动。
7. 主 PRD 6.15.3 的证据来源跳转已完成；记录级来源查看和刷新后返回原单已验证，段落/音频时间点精确定位未纳入本轮。
8. 上次本机只读预览报告 `Audited local temporary files: 5.01 GiB`；用户未确认随后是否运行 `-Apply`，因此不能记为已删除。清理脚本只操作固定的本机路径，命令由用户自行运行。

### 0.6 下一步：资料模块交付验收

本轮源码开发已完成，当前工作区尚未提交。接下来若继续交付，应基于 API18 源码重新构建 NSIS 安装包，并在本机 Windows 环境验证新安装默认关闭、旧设置迁移、资料预览/筛选和音视频按需转写；完成验收前不得将 API18 标记为已发布。此前 `v0.2.9` 的发布和 API17 安装验收仍是历史记录。

### 0.7 新会话必须遵守的边界

- 继续保持单机单用户；不要自行引入账号、权限、多人协作或云端共享。
- 需求澄清单只保存资料快照和工作结果；删除澄清单不能删除原始聊天、转写、文件或导入记录。
- 甲方回答转需求/项目必须经过预览和手动确认；不能直接写库。
- 追加分析不能覆盖旧结论；冲突必须新增问题并保留双方证据。
- 任何模型失败、取消或不可读资料都必须保留工作单、已有问题、回答和错误原因，并允许重试。

### 0.8 本机临时文件清理状态（2026-11-03）

- 用户要求清理的是本机临时文件；当前没有 `mstsc.exe` 连接进程，本机 `X:` 到 `build/vm-transfer` 的临时映射已解除，不再操作远端。
- 历史审计清单曾统计 61 个明确本地目标，共 5,380,390,577 字节（5.38 GB / 5.011 GiB）：构建中间物、测试环境/数据、可归因的 Sidecar `_MEI` 解压残留及旧 0.2.6 构建包。
- 用户最近贴出的脚本结果是只读预览：`Audited local temporary files: 5.01 GiB`。本记录不假设已执行删除；用户可在确认目标清单后自行添加 `-Apply` 执行。
- `scripts/cleanup-local-acceptance-temp.ps1` 默认只预览，`-Apply` 才删除；调用命令使用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\code\Basu-Custom-Platform\scripts\cleanup-local-acceptance-temp.ps1" -Apply`，绕过只作用于该子进程，不修改长期执行策略。脚本限定本机固定路径、检查根目录/重解析点，不包含远程命令。
- 清理脚本保留最终安装包、校验文件、构建图标、验收证据、源码、依赖及真实业务数据；不清空共享 pip/uv 缓存或来源不明的其他应用 `_MEI` 目录。

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
10. 需求澄清助手（选材、分析、问题、回答、回写、导出）；
11. 销售待办、批量归档与全局搜索。

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
  - 通知（Windows 到期提醒开关、免打扰起止时间）；
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
- `electron-updater` 已接入，启动检查 + 每 3 小时后台检查；左上角版本徽标在有新版本时变黄，弹窗支持检查、下载、进度、重启安装和历史更新；设置页提供同一套更新操作；
- 当前正式 Release 为 [`v0.2.8`](https://github.com/Dingh0208/basu-custom-platform/releases/tag/v0.2.8)，已设为最新版；CI 安装包 **393,899,179 字节（约 393.9 MB / 375.6 MiB）**，包含 `ClientHub-Setup-0.2.8.exe`、`.blockmap` 和 `latest.yml`；
- v0.2.6 包含 Sidecar PID 生命周期、发布包密钥隔离、微信引擎过滤和安装器版本命名修复；v0.2.6 / v0.2.5 / v0.2.4 / v0.2.3 为历史版本。

## 3. 当前卡点 / 状态

### 2026-11-02：需求澄清助手第 1 次开发（工作区未发布）

- 新增 `services/ai/clarifications.py`，提供需求澄清单、资料快照、问题、证据和回答五类 SQLite 表；迁移可重复执行。
- `main.py` 已接入正常启动和备份恢复迁移；新增澄清单草稿的列表、详情、创建、修改、归档筛选和删除 API。删除澄清单只删除工作单及其快照，不删除原始导入/转写资料。
- 前端已补充 `ClarificationRecord` 等类型和客户端 API，页面入口与资料选择放在第 2 次开发实现。
- Sidecar API revision 当前源码升为 **8**；本次尚未重新打包或发布 Release。
- 回归验证：`test_sales.py` 共 42 项通过，前端构建、Python 编译和 `git diff --check` 通过。

### 2026-11-02：v0.2.8 已发布

- `main` 与 `v0.2.8` 标签已推送，GitHub Actions 构建成功；Release 已正式公开并设为最新版。安装包 SHA-256：`da105cc1294b0602b9a22d7e822855a05853222e5e5117d7249215c20da6bce7`。
- 微信引擎诊断增加手动启动/检测入口；启动失败会给出修复步骤和日志位置。Sidecar 启动操作已串行化，避免重复拉起。
- Todo 工作区使用可用宽度，空状态提供创建入口；此前已实现的客户归档与关联项目恢复流程一并包含。
- 本机 Sidecar 已从当前源码重启，诊断报告 `0.2.8 / API 7`；数据目录未更改，微信解析后端未自动启动。
- 回归验证：前端构建、Electron 语法检查、Python 编译、`git diff --check` 和 40 项 `test_sales.py` 测试通过。完整本地测试有 3 项因环境缺少 `rapidocr_onnxruntime`、`olefile`、`xlwt` 报错；CI 安装声明依赖后已通过 Windows 打包和资产上传。

### 2026-11-01：v0.2.7 已发布

- 用户已授权将本轮改动推送 GitHub，并构建发布新的 Release。`package.json`、侧栏、设置页和 Sidecar 版本统一为 `0.2.7`。
- 本版本包含本轮长音频/OCR/通知功能，以及此前尚未推送的设置布局和版本更新弹窗改动。发布说明：`docs/RELEASE-NOTES-v0.2.7.md`。
- 远端 v0.2.6 的两笔提交与本地对应提交内容相同、SHA 不同；通过正常合并保留双方提交历史，不强制推送。
- `main` 和 `v0.2.7` 标签已推送；发布标签指向 `01cf75c1ce39626b9ac7bb9458c875696a3ed6c5`，后续发布记录作为文档提交更新，不移动标签。
- [GitHub Actions 构建](https://github.com/Dingh0208/basu-custom-platform/actions/runs/41322933804) 成功：47 项回归、前端构建、Windows Sidecar 构建、NSIS 打包和资产上传全部通过。
- Release 已正式公开并设为最新版，包含 `ClientHub-Setup-0.2.7.exe`、`.exe.blockmap` 和 `latest.yml`；更新元数据中的版本、文件名和安装器大小一致。
- 安装器 SHA-256：`e85987a9321a03fcaf1616a1c27ce1771ecb1c46be855c8d371930be86ef4d0b`。

### 2026-11-01：长音频、OCR 与系统通知（已随 v0.2.7 发布）

- 用户明确确认继续使用**单机单用户**，不增加账号、团队权限或共享服务器；自动说话人分离不在本轮范围。PRD 原有单用户边界继续生效。
- 长音频由 `audio_pipeline.py` 使用 FFmpeg segment 切为约 55 秒 MP3，为 Qwen 60 秒限制留编码余量；线程池和全局信号量将 ASR 并发限定为 3。结果按原序合并，保留实际片段起止，句子时间仍是片内估计。ASR 配置在一次转写内固定，避免处理中改模型污染缓存。
- 成功片段写入 `DATA_DIR/asr-cache`，以模型配置与片段字节 SHA-256 建索引；失败重试和任务恢复时复用，取消后的响应不再保存。429、5xx、超时和连接错误最多尝试 3 次。缓存不进入便携备份，原文件、转写正文及附件仍进入备份。
- 文档解析新增扫描 PDF 本地 OCR、PNG/JPEG/WebP/BMP/TIFF（含多页）、DOC、XLS、PPT/PPTX。RapidOCR 模型随 Sidecar 打包，PDFium 渲染扫描页；PPTX 提取文本、表格和备注。旧 PPT 根据 Current User、UserEdit 和持久对象索引读取当前幻灯片/备注，过滤旧保存版本及母版。Word 97 以前和加密 Office 文件需先转换/解锁。
- 普通图片使用文件选择/拖放入口，本地提取原文后进入现有任务、转写、归档、搜索与附件链路；专用“聊天截图”入口继续使用视觉模型。旧 Office/PPT 可预览正文；TIFF 预览提取原文，并提供原文件下载。
- `notifications.py` 增加持久化到期提醒：09:00 生成、应用内未读数、Windows 通知、默认 22:00–08:00 免打扰。已读与已送达分开保存，同一待办截止日期去重；完成、取消、删除、延期会移除过时提醒。桌面端每 30 秒或窗口聚焦时刷新，积压提醒合并发送；点击单条定位待办，批量通知打开通知列表。应用退出后不驻留发送，重新启动后补提醒。
- 设置页新增通知分区：系统通知开关、免打扰起止时间；开始等于结束表示关闭免打扰。设置和通知表进入 SQLite 备份，旧库/备份恢复幂等迁移。Sidecar API revision 升为 **5**。
- 依赖开发环境使用 **Python 3.11–3.12，推荐 3.12**，当前 RapidOCR 1.4 不支持 3.13。`requirements-dev.txt` 增加仅测试使用的 xlwt。发布 CI 先执行全部回归，再打包。
- 修复实测安装版崩溃：PyInstaller 曾从 PATH 中 Java 目录收集旧版 VC++ DLL，源码 OCR 正常但 exe 在 MSVCP140.dll 崩溃。构建时临时优先 System32，收集一致的已安装运行库；打包加入 RapidOCR 模型、ONNX Runtime 和 PDFium 原生依赖。
- 验证：47 项隔离回归通过（含真实 FFmpeg 短尾片、并发排序/缓存/取消、真实离线 OCR、旧 Word/PPT 样本、通知/API/备份恢复）。前端构建通过；1280×800 浏览器实测通知定位、设置保存及 PNG/扫描 PDF/DOC/PPT 上传闭环，无页面错误。打包后的 `release/ai-sidecar/clienthub-ai.exe` 实测四类文件均解析成功，大小约 112 MiB；完整 NSIS 已由 CI 构建并发布，未调用真实 Qwen ASR 计费接口。Windows 原生烟测中当前执行环境的 `Notification.isSupported()` 返回 false，已确认回退到应用内提醒且不误标已送达；原生弹窗与点击激活仍需在正常安装后的交互式 Windows 会话验证。

```text
GET  /api/notifications
POST /api/notifications {action:"read"|"delivered",ids:[...]}  # read 支持 all:true
GET/POST /api/settings/app  # systemNotifications, quietStart, quietEnd

python -m pip install -r services/ai/requirements-dev.txt
python -m unittest discover -s services/ai -p "test_*.py" -v
```

### 2026-11-01：设置中心扩展（已随 v0.2.7 发布）

- 设置页拆为大模型、数据与备份、本地服务诊断、导入默认值、更新设置、隐私与关于六个分区。
- 新增 `GET /api/diagnostics`，展示 Sidecar API 修订、数据目录、数据库占用、备份数量、FFmpeg、微信引擎和密钥存储方式；打包版支持从设置页重启 Sidecar。
- API Key 支持从 Windows DPAPI 存储中删除；应用设置支持默认项目、负责人、自动识别、自动处理和更新频率。
- 设置页会在进入时读取诊断和备份信息，保存更新频率后同步 Electron 的后台检查定时器。
- 更新检查与下载分离：发现版本后由用户点击“下载更新”，下载完成后点击“重启该应用”完成安装；无更新时左上角只显示当前版本号。
- 验证：前端构建、Python 编译、Electron 语法检查、34 项 SQLite/API 回归测试和临时数据库设置诊断 smoke test 通过；v0.2.7 发布时扩展至 47 项回归并通过 CI 打包。

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
src/components/ClarificationWorkspace.tsx
src/api/client.ts
src/types.ts
src/styles.css
services/ai/main.py        Sidecar API / SQLite / MaaS / 客户/项目/需求/设置
services/ai/sales.py       P1 销售待办 / 批量归档 / 跟进 / 全局搜索
services/ai/clarifications.py 需求澄清数据模型、资料快照、问题和增量分析持久化
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
- **删除客户/导入**：删除客户时关联项目及客户档案会写入归档快照，可逐项目恢复；记录、需求和待办仍会删除。删除导入会删除文件/转写/聊天/需求，操作前确认用户数据。
- **浏览器轮询断开**：前端关闭页面时可能打断正在写的 HTTP 响应；`_json` 已捕获 `BrokenPipeError/ConnectionAbortedError/ConnectionResetError`，不要再让这类异常冒到 `socketserver` 日志。
- **Sidecar 残留进程**：Electron 退出必须用 `taskkill /T` 清理 PyInstaller one-file 的进程树；Sidecar 另带 `--parent-pid` 看门狗，父进程消失后自动退出。不要恢复成只 `proc.kill()`。

### 2026-11-02：界面、Sidecar 诊断与客户项目归档

- 首页快速操作改为六个全宽方块入口；最近导入移除固定录音时长，支持格式说明保持单行横向显示。
- 设置分区序号与导航顺序统一；诊断以 `/api/health` 识别 Sidecar 在线状态，并提供重试和安装版启动/重启操作。
- 设置诊断增加“启动 / 检测微信引擎”；失败响应包含错误、日志路径和按错误类型区分的修复步骤。启动流程加锁，避免检测和按钮同时创建多个引擎进程。
- 待办面板取消 900px 固定宽度，改为占满工作区；空列表增加直接创建入口。
- 删除客户时在同一 SQLite 事务内归档关联项目和客户档案快照；设置页可逐项目恢复。项目冲突返回 409，不覆盖既有数据；已删除的导入、沟通、需求和待办不会随项目恢复。归档表随 SQLite 备份恢复。
- 归档接口要求 API revision 6；本地微信引擎启动接口将 API revision 升至 7。旧 Sidecar 下前端禁止删除客户，避免触发旧版硬删除行为。
- 本机遗留 Sidecar 已确认无活动任务后停止，并以 `0.2.8 / API 7` 从当前源码重启；SQLite 数据目录未更换。未自动启动微信读取引擎。
- 验证：销售后端 40 项隔离 SQLite/API 回归测试、前端构建、Electron 语法检查和 `git diff --check` 通过；宽屏待办截图确认面板填满内容区。

### 6.4 本轮需求澄清助手专属坑（绝对不要再踩）

- **不要混淆两个资料接口**：`POST /api/clarifications/{id}/sources` 只用于草稿/待确认状态替换选材；已生成记录追加资料必须调用 `/sources/append`。后者会去重并把新快照标为 `analyzed=0`。
- **不要把 `completed_batches` 直接当增量批次数循环**：`process_clarification_analysis(record_id, incremental_only=False, task_id=None)` 的增量批次从 0 开始，`_run_task` 会用关键字传入 `task_id`。如果改参数顺序，旧测试会出现 `got multiple values for argument 'task_id'`，任务会停在 `analyzing`。
- **不要在增量分析中覆盖旧问题**：`append_questions` 只精确去重并合并证据；冲突问题必须新增，旧问题和旧证据不能更新覆盖。
- **不要相信模型自己正确标记冲突优先级**：服务端解析 `conclusionType=conflict` 时会强制转换成 `must_confirm`，这条规则必须保留。
- **不要把证据 excerpt 当模型任意文本保存**：只接受实际出现在当前资料快照中的原文片段，否则保留问题但降低置信度，避免伪造证据。
- **不要把问题归属写回原始资料**：当前批量归属只更新 `clarification_questions.customer_id/project_id`；资料快照、原始导入记录和证据来源必须保留。
- **不要用真实 MaaS 做回归测试**：测试必须放在临时 `CLIENTHUB_DATA_DIR`，并 patch `main.get_llm_config`、`main.maas_request` 和任务启动函数。
- **不要只看 HTTP 202 判断分析完成**：分析是持久化任务，启动后必须读取澄清详情或任务状态；失败和取消也可能已经保存部分问题。
- **不要因为 API revision 变化就清空用户库**：`clarifications.migrate()` 会为旧 `clarification_sources` 幂等补 `analyzed` 字段；迁移前后都要保留原始资料。
- **不要把“历史开发章节”当当前状态**：第 1–6 次记录里的 API 8–13 和 42–49 项测试是阶段快照，当前源码以本节 API14、50 项测试为准。

## 7. 快速验证命令

```powershell
# 前端构建（项目脚本使用 npm；不要改回 pnpm）
npm run build

# Python 语法
python -m py_compile services/ai/main.py services/ai/clarifications.py services/ai/test_sales.py services/ai/wechat_engine.py

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
GET  /api/clarifications
GET  /api/clarifications/{id}
POST /api/clarifications/{id}/analyze
POST /api/clarifications/{id}/sources/append
PATCH /api/clarification-questions/{id}
```

## 8. 备注

- 本文件不含任何真实 API Key、密码或客户隐私数据。
- 最新正式 Release：`v0.2.8`；v0.2.7 / v0.2.6 / v0.2.5 / v0.2.4 / v0.2.3 为历史版本。当前需求澄清助手改动尚未发布。
- 若新会话需要继续，先读本文件，再检查 `git status` 和 `release/`，不要重新从零猜架构。

### 2026-11-02：需求澄清助手第 2 次开发（工作区未发布）

- 新增侧栏“需求澄清”入口和独立工作台：历史澄清记录、新建分析、草稿继续编辑。
- 资料选择复用现有 `/api/imports`，支持按客户、项目、未归档筛选，逐条勾选和全选当前筛选结果；跨客户/项目选择只保存来源快照，不修改原始导入记录。
- 不可读资料显示具体原因（处理中、待归档、处理失败、已取消）；发送前确认框逐条列出资料名称、类型、归属、可读性和设置中的默认文本模型；没有可读资料时禁止确认。
- 新增 `POST /api/clarifications/{id}/sources`，仅允许草稿或待确认澄清单幂等替换资料快照；API revision 升至 9。
- 本轮验证：43 项隔离 SQLite/API 回归测试、Python 编译、前端构建通过。实际模型分析留在第 3 次开发。

### 2026-11-02：需求澄清助手第 3 次开发（工作区未发布）

- 新增 `POST /api/clarifications/{id}/analyze`，复用持久化任务队列执行需求澄清分析；API revision 升至 10。
- 分析从已保存转写、聊天解析、文档/OCR 文本读取，按 12,000 字自动分批；每批使用资料客户/项目归属和来源快照生成结构化问题与证据，精确重复问题合并。
- 任务支持进度、取消、失败原因、部分结果保留和重试剩余批次；模型未配置、无可读文本、模型超时或返回非法 JSON 都会保留澄清单并显示错误。
- 前端确认资料后启动分析，显示批次进度；分析中可取消，部分完成/失败可继续分析或重试；已进入分析流程的资料只读。
- 本轮验证：新增成功、不可读资料、失败保留与重试测试；总计 46 项隔离 SQLite/API 回归测试、Python 编译和前端构建通过。

### 2026-11-02：需求澄清助手第 4 次开发（工作区未发布）

- 新增问题工作台：按客户/项目分区，优先级外层、固定行业维度内层；“必须先确认”默认展开，其余优先级折叠。
- 问题行展示状态、置信度、提问理由和证据原文；证据可展开查看来源、时间和来源快照。
- 新增问题编辑、优先级/维度调整、标记“不适用”、逻辑删除和自定义问题；删除不会删除原始资料或澄清单。
- 新增 `PATCH /api/clarification-questions/{id}` 与 `POST /api/clarifications/{id}/questions`；API revision 升至 11。
- 回答记录、追问和需求/项目回写留到第 5 次开发。本轮总计 47 项隔离 SQLite/API 回归测试、Python 编译和前端构建通过。

### 2026-11-02：需求澄清助手第 5 次开发（工作区未发布）

- 问题工作台支持将问题标记为“已问”，录入多次甲方回答并保留回答时间快照；回答后可手动触发追问生成，追问保留父问题关系和回答证据。
- 新增回答、追问和回写 API：`POST /api/clarification-questions/{id}/answers`、`POST /api/clarification-questions/{id}/follow-up`、`POST /api/clarification-questions/{id}/action-preview`、`POST /api/clarification-questions/{id}/action-confirm`。
- 回答闭环自动更新澄清单完成状态；所有问题都有回答或“不适用”结论时自动标记为已完成，新增问题后恢复为未完成。
- 回写支持选择目标客户/项目，先预览字段变更再确认；回答可转为“待确认”需求，或只更新项目中明确填写的字段，并在回答上保存已确认的操作快照。
- API revision 升至 12；新增回答、追问、需求/项目回写预览和确认的隔离回归测试。本轮总计 48 项测试通过，Python 编译和前端构建通过。

### 2026-11-02：需求澄清助手第 6 次开发（工作区未发布）

- 历史列表增加客户、项目、状态、日期筛选，并支持包含已归档记录；记录可归档、恢复、删除和复制为新草稿。
- 复制只保留问题结构、维度和优先级，不复制客户/项目归属、回答、证据和处理状态；新单要求重新选择资料。
- 问题工作台支持按客户/项目生成对外问题范围，复制文本、导出 Word；对外打印窗口只输出问题文本，内部理由、证据和回答不进入交付内容。
- 新增 `POST /api/clarifications/{id}/duplicate` 与 `GET /api/clarifications/{id}/export?format=docx`；API revision 升至 13。
- 本轮新增生命周期、归档筛选、复制结构和 Word 导出回归测试；总计 49 项隔离 SQLite/API 回归测试、Python 编译、前端构建和 `git diff --check` 通过。

### 2026-11-02：需求澄清助手第 6 次开发补全（工作区未发布）

- 澄清资料快照新增 `analyzed` 标记；已完成澄清单可通过 `POST /api/clarifications/{id}/sources/append` 追加资料，按来源 ID、内容哈希和名称去重，旧资料和旧问题不被覆盖。
- 追加资料后自动启动增量分析，只读取未分析且可读的资料；分析失败、取消或重试仍保留已有问题、回答和证据，重复问题合并并追加新证据。
- 模型返回 `conclusionType=conflict` 时强制保存为“必须先确认”，保留冲突资料的双方证据；问题工作台支持勾选未归属问题并批量设置客户/项目归属。
- API revision 升至 14；本轮总计 50 项隔离 SQLite/API 回归测试、Python 编译、前端构建和 `git diff --check` 通过。
