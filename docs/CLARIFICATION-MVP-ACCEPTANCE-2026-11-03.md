# 需求澄清助手 MVP 开发验收记录（2026-11-03）

当前源码：应用 `0.2.8`，Sidecar API revision **17**。本轮完成主 PRD 6.15.8 的开发环境核对及实际流程修复；随后完成 API17 NSIS 本机打包和隔离安装验收，剩余 **0 个开发步骤 + 0 个本机交付步骤**。包信息、35 项安装验收、原生 PDF 保存、覆盖升级和卸载证据见 [API17 本机交付验收](DELIVERY-API17-2026-11-03.md)。改动尚未提交、推送或发布。

## PRD 与验证对应

| 主 PRD 6.15.8 验收项 | 开发验证证据 |
| --- | --- |
| 现有资料选择、跨客户/项目隔离 | 前序快捷入口/按资料分配浏览器回归；本轮 `test_clarification_reads_frontend_import_ids_for_chat_and_transcript`、`test_clarification_model_cannot_change_known_customer_or_project`、`test_clarification_cross_source_conflict_keeps_both_evidence_and_scopes_context`；真实浏览器读取导入记录并生成问题 |
| 发送前逐条确认资料和模型 | 真实浏览器初次确认同时列出可读和不可读资料，确认前模型调用为 0；追加确认及取消不追加资料、不调用模型；无可读资料由后端拒绝 |
| 提问理由、原文、来源、时间及结论分类 | `test_clarification_analysis_saves_questions_and_evidence` 验证证据；真实浏览器显示事实/推断/缺口/冲突、低于 0.6 的待核验标记及来源跳转/刷新返回；来源名称和时间取实际快照 |
| 超长分批、取消及重试剩余批次 | `test_clarification_analysis_failure_keeps_completed_batches_for_retry`、`test_clarification_incremental_cancel_resumes_remaining_batch`、`test_clarification_queued_analysis_can_resume_after_restart`；真实浏览器增量失败后重试，不重跑旧资料 |
| 编辑、删除、不适用、优先级、回答及追问 | `test_clarification_question_workbench_updates_and_adds_questions`、`test_clarification_answers_followups_and_writeback_preview`；真实浏览器两次回答和完整历史，不自动追问；同秒回答回归验证历史、追问、回写均取最新保存内容 |
| 回写预览及有依据字段 | 后端预览/确认回归及真实浏览器：预览不写库，字段修改后要求重新预览，确认才创建待确认需求；新需求默认 P1；项目默认只回写回答说明，原预算、工期、阶段、负责人保留 |
| 未归属分配、追加去重及冲突 | `test_clarification_assignment_preserves_answers_evidence_and_original_sources`、`test_clarification_duplicate_questions_merge_evidence`、`test_clarification_incremental_sources_keep_history_and_mark_conflicts`；真实增量流程保留旧回答，冲突新增为 must_confirm 并保存新旧双方证据；前序 14 项归属浏览器检查仍为历史证据 |
| 草稿、自动保存、历史、生命周期及导出 | 分析批次自动落库，保存后的工作单和回答可重读；真实浏览器覆盖按客户/项目/日期默认命名、已生成单改名、历史打开、归档/恢复/删除、复制草稿、文本复制和 Word 下载；PDF 覆盖打印调用及对外内容，原生文件保存仍待交付验收 |
| 未配置/失败保留及重试 | `test_clarification_incremental_sources_keep_history_and_mark_conflicts` 包含无 Key/失败保留；部分批次失败回归和真实浏览器超时重试均保留旧问题、回答及证据 |
| 前 10 次分析指标 | `test_clarification_metrics_track_question_actions_and_first_ten`、`test_clarification_metrics_use_first_ten_completed_records`；持久化首次复制/已问时间，分子取保留/复制/已问问题的去重并集，历史页展示指标基线 |

“自动保存”沿用原始访谈第 10 轮含义：每次分析及已完成批次自动保存为可重新打开的工作单；回答、编辑、回写等按界面明确的保存/确认动作持久化，不自动提交尚未确认的输入。

## 本轮实际修复

- 前端传入的是导入 ID，后端通过导入记录查聊天/转写 ID，避免已解析资料读不到正文。
- 模型输出不能改变资料已有或未归属的客户/项目；每批旧问题上下文及历史证据限定在同一客户/项目。跨资料冲突可引用验证过的旧证据，保留双方来源。
- 追加模式允许勾选资料；先逐条确认再保存并分析；失败后重试只分析新增资料，不重跑历史资料；不可读资料保留在清单中。
- 展示结论类型、低置信度和完整回答历史；同一秒多次回答按保存顺序排列，追问、回写及回写结果归档使用最新回答。
- 澄清优先级与需求交付优先级分开，新需求默认 P1；项目回写只提交回答说明和用户实际修改/填写的字段。
- 历史筛选可匹配按问题分配后的客户/项目，补齐列表摘要；未归属 Word 筛选不再导出其他范围；支持已生成单改名及新单默认命名。

## 本轮验证结果

```powershell
python -m unittest discover -s services/ai -p test_sales.py -q
# Ran 63 tests ... OK
python -m unittest discover -s services/ai -p test_notifications.py -q
# Ran 4 tests ... OK
npm run build
python -m py_compile services/ai/main.py services/ai/clarifications.py services/ai/test_sales.py
git diff --check
```

上述检查通过；未跟踪的 `ClarificationWorkspace.tsx` 另经 `git diff --no-index --check -- NUL` 检查，无空白错误。Windows LF/CRLF 转换警告不影响检查结果。

Edge 无头浏览器连接真实 `main.Handler` 和隔离 SQLite，仅模拟 `maas_request`。14 项流程检查通过：

1. 默认命名、保存草稿、逐条发送确认，确认前零模型调用。
2. 由导入 ID 读取正文，生成问题并锁定实际客户/项目。
3. 事实/推断/缺口/冲突、低置信度及冲突优先级展示。
4. 标记已问、两次回答及可展开的完整历史。
5. 转需求预览、修改后重新预览及确认创建待确认需求。
6. 项目回写只变更回答说明，保留其他原字段。
7. 手动追问并保留父问题关系。
8. 追加资料确认和返回调整均不提前分析。
9. 增量模拟超时、重试、保留旧回答及新旧冲突双方证据。
10. 已生成工作单改名，不替换资料或重新分析。
11. 复制文本、实际下载 Word、PDF 打印调用和对外内容隔离。
12. 查看原始资料，来源页刷新后返回原澄清单。
13. 归档/恢复、复制草稿不带回答和证据、删除不删原资料。
14. 390px 窄屏继续跟进，全流程无页面异常。

本轮浏览器共 4 次模型模拟调用，真实模型调用为 0；业务写入只在用户相应保存/确认动作后发生。脚本在内存中执行，fixture 使用 `TemporaryDirectory`，退出输出 `FIXTURE_CLEANED`；测试 Sidecar（18765）及 Vite（5188）退出，未新建 Python 环境或大型验收产物，未操作真实用户数据库或已有业务服务。

## 交付边界

本记录中的 PDF mock 仅为源码阶段证据。之后安装版已通过 Electron IPC、Windows 原生另存为保存 36,090 字节 PDF，并检查中文问题和内部信息隔离。API17 安装版另通过完整离线 OCR/Office 旧格式、重启、卸载与 API15→17 数据保留。真实 MaaS、全新 Windows 10/11 和自动更新下载→重启安装链路仍未验收；API15 历史数据见 `INSTALLER-ACCEPTANCE-2026-11-03.md`。

本轮本机交付步骤现已完成。不得据本记录恢复远程连接、提交、推送或发布。
