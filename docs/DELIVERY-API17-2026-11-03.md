# API17 本机打包与安装验收（2026-11-03）

## 安装包

- 文件：[ClientHub Setup 0.2.8.exe](../release/ClientHub%20Setup%200.2.8.exe)
- 应用版本：`0.2.8`；Sidecar API revision：`17`
- 大小：`387,695,195` 字节（约 `369.8 MiB`）
- SHA-256：`63E38DD3B322A2FCFB1F450C9DE65D724CFFE81376C4B4310F8A646C32F008F5`
- 本机 `release/ClientHub Setup 0.2.8.exe.sha256` 与最终包散列一致。
- 使用独立 CPython `3.12.13` 和 RapidOCR `1.4.4` 环境构建；75 项完整 `test_sales.py` 回归通过。TypeScript/Vite 构建和最终 `app.asar` 源码比对通过。
- NSIS 是可选安装目录的手动安装包，不是 electron-updater 发布包。没有代码签名证书；包未提交、推送或发布。

## 隔离验收

在当前本机 Windows 11 Home x64（build `10.0.26100`）运行隔离安装版，用户数据目录与安装目录均位于本轮专用临时目录。NSIS 静默安装成功，安装后的 API17 可以启动，`app.asar` 和 Sidecar 随包完整。安装版业务检查共 **35 项**，覆盖：

- DOC、DOCX、PPT、PPTX、XLS、XLSX、EML、PNG、扫描 PDF 共 9 种格式；PNG 和扫描 PDF 用实际随包离线 OCR 解析。
- 问题生成、原文证据、回答与历史、追问、回写预览及确认、增量失败重试、冲突证据、取消后续跑和缺少 Key 时保留数据。
- 无 Key 启动、Sidecar 重启、整应用退出/重开后数据保留、窄屏流程、归档/恢复/复制/删除。
- Word 文件由安装版实际导出。PDF 通过安装版 UI 打开 Windows 原生“另存为”，实际生成 [questions-native.pdf](../build/delivery-api17/questions-native.pdf)，大小 `36,090` 字节；PDF 可提取中文对外问题，不含内部理由、旧资料证据、置信度或模型信息。PDF 取消保存、写入失败提示和临时打印窗口关闭也分别检查。

验收中使用本机 HTTP 模拟模型，记录了 7 次 fixture 调用，真实 MaaS 调用为 0；没有读取或修改既有业务库，也没有使用真实 Key。Word 内容另行检查，仅含对外问题。压缩包、Word、PDF 和 JSON 结果位于被忽略的 `build/delivery-api17/`，便于本机复核。

## 升级与卸载

- 使用早期 API15 包安装到专用目录，并从已有隔离数据库打开问题和两次回答；之后使用最终 API17 包覆盖安装。
- 升级前后比较五类澄清数据表，记录、资料快照、问题、证据、回答分别为 `2 / 4 / 8 / 7 / 2` 行，SQLite 行数据逐项一致；API17 启动后问题和回答仍可读取。该检查覆盖的是手动覆盖安装，不代表 electron-updater 自动下载和重启安装。
- 运行 API17 卸载程序后，应用文件、桌面/开始菜单快捷方式和两个 HKCU 安装注册表项移除，隔离用户数据库仍保留。测试前没有同名快捷方式需要恢复。

## 清理与剩余边界

本轮曾准备清理下列任务专用目标，删除操作被自动执行审核以 `blocked by policy` 拒绝，**实际回收字节为 0**。这些路径目前仍占用合计 `6,771,795,537` 字节（约 `6.31 GiB`）：

| 目标 | 实测大小 |
|---|---:|
| `build/delivery-api17/python` | 292,384,447 字节 |
| `build/delivery-api17/previous-api15.exe` | 387,655,971 字节 |
| `release/win-unpacked` | 650,300,981 字节 |
| `release/ai-sidecar` | 114,924,341 字节 |
| `build/ai-sidecar` | 126,376,410 字节 |
| `build/ai-sidecar-spec` | 1,261 字节 |
| `C:\Users\111\AppData\Local\Temp\ClientHub-delivery-api17-20261103`（仅残留卸载器） | 52,089 字节 |
| `C:\Users\111\AppData\Local\Temp\ClientHub-delivery-profile-api17-20261103` | 5,200,100,037 字节 |

目标路径已逐一核对在项目 `build`/`release` 或系统 Temp 专用根内，且没有测试应用进程或 Sidecar 端口占用；自动执行审核仍拒绝递归删除。最终安装包、散列及验收证据保留。未尝试改用其他方式绕过该限制。

本机 Windows 11 安装结果不替代全新 Windows 10/11 系统验收。真实 MaaS、真实微信账号提取和自动更新“下载→退出→安装→重启”仍未验收。用户已明确停止远程工作；本轮没有远程连接、提交、推送或发布。
