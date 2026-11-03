# ClientHub 安装包验收记录（2026-11-03）

> 本文详细记录较早的 API15 包与云服务器历史验收。当前 API17 本机交付、安装、原生 PDF、覆盖升级及卸载证据见 [API17 本机交付验收](DELIVERY-API17-2026-11-03.md)，不能用本文 API15 的包名、散列或系统版本覆盖当前结果。

本轮目标是补齐 API15 Sidecar、NSIS 手动安装包和 Windows 安装验收。应用版本仍为 `0.2.8`，工作区改动未提交、未推送、未发布；不能把本地包当成已发布的 `v0.2.8`。

用户已叫停后续打包和远端验收，转为清理本机临时文件及继续开发。当前源码 API17 已新增客户/项目澄清入口、按次生成语言、证据来源跳转/返回原澄清单、按资料分配未归属结果，并完成资料读取、跨客户隔离、增量确认/重试、最新回答和回写等流程修复。保留的本轮 API15 安装包不包含这些后续修改；源码开发回归见 `docs/CLARIFICATION-MVP-ACCEPTANCE-2026-11-03.md`，不能据此认定新安装包已验收。

## 构建环境与修改

- Windows 11，Electron 33.2.1，Python 3.12.13，PyInstaller 6.22.3。
- 文档依赖已安装：`xlrd 2.0.2`、`rapidocr-onnxruntime 1.4.4`、`onnxruntime 1.31.1`、`pypdfium2 5.14.0`。原来的缺少 `xlrd` 卡点已解决。
- 使用独立 Python 3.12 环境，与 CI 的 Python 主次版本一致。系统默认 Anaconda Python 3.13 不适用于本轮 RapidOCR 依赖。
- `build-sidecar.ps1` 收集 OCR 模型与必要动态库，排除 Qt，避免全量收集 ONNX 测试模块时拉入无关 Anaconda 组件；离线 OCR 已用实际打包程序验证。
- `build-installer.ps1` 前端步骤使用 `npm run build`，包含 TypeScript 检查；子 PowerShell 使用 `-NoProfile`。
- 修复安装版“保存 PDF”依赖弹窗被 Electron 拦截的问题，改用独立打印 iframe，只打印对外问题，打印结束后移除框架。

复现构建时先在 Python 3.12 虚拟环境安装 `services/ai/requirements-dev.txt` 与 `pyinstaller`，再执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer.ps1 -Python <Python312虚拟环境>\Scripts\python.exe
```

本地构建使用 `scripts/installer.nsi`，用于手动安装；它不生成 `latest.yml`、`.blockmap` 或 `app-update.yml`。自动更新的官方包仍由现有 GitHub Actions 使用 electron-builder NSIS 构建。未调用发布命令。

## 已有验证证据

| 检查 | 结果 / 证据 |
| --- | --- |
| 后端完整回归 | 67 项通过，`build/installer-regression.log` |
| TypeScript + Vite | 通过，`build/installer-frontend.log` |
| 打包 Sidecar API | `version=0.2.8`，`apiRevision=15`，无密钥时为 `mock` |
| 打包解析器 | DOC、DOCX、PPT、PPTX、XLS、XLSX、EML、PNG、扫描 PDF 全部通过；PNG/PDF 使用真实离线 OCR |
| 打包澄清 API | 本机 HTTP 模拟模型；缺少密钥/模型失败保留问题与回答；证据快照；增量去重；冲突为 must_confirm；取消保留完成批次、重试只处理剩余批次 |
| 业务回写 | 问题归属和回答保存；预览不写需求；确认后写入“待确认”需求并保留澄清来源 |
| 导出 | Word 按钮实际保存 DOCX，内容检查不含内部理由；PDF 按钮实际调用打印并清理 iframe，打印内容不含内部理由 |
| 打包应用重启 | IPC 重启 Sidecar、关闭后重新启动 Electron，问题与回答保留；退出后 Sidecar 端口关闭 |
| 数据隔离 | `--user-data-dir` 指向专用临时目录；SQLite 位于该目录下的 `clienthub-data/clienthub.db`；未使用真实用户数据库或真实 API Key |
| 打包资源 | FFmpeg 和微信引擎文件存在；Sidecar 不包含 `.env` |

详细本地证据位于忽略提交的 `build/`：`packaged-api-smoke.log`、`packaged-api-results.json`、`installed-app-smoke.log`、`installed-app-results.json`、`installed-clarification.png`、`installed-print.html`、`installed-ui-questions.docx`。工作区打包目录曾出现 Chromium `ACCESS_DENIED`；最终安装目录的默认启动通过，`fallback=false`，未使用 `--no-sandbox`，没有修改产品沙箱设置。

PDF 检查验证了应用到打印调用及其内容；Windows 原生“Microsoft Print to PDF”对话框、目标文件保存仍需交互式验收。真实 MaaS、真实微信账号提取和自动更新下载→重启安装均未执行。

## 最终安装包与安装验收

最终包：`release/ClientHub Setup 0.2.8.exe`，387,655,971 字节（约 369.7 MiB）。

SHA-256：`200E0105528F1F4A518041EE96A75341E20D86C7DF1B997096C469DBDC1FC028`。旁边的 `.sha256` 文件可用于校验。

本机最终包以 `/S /D=<测试目录>` 安装到 `C:\Users\111\AppData\Local\Temp\ClientHub-final-smoke-20261103`，退出码 0。安装后的 `app.asar` 和 Sidecar SHA-256 与打包目录一致。最终安装版通过上表功能检查、默认沙箱启动、IPC/整应用重启与退出清理。

最终本机测试安装已通过 `Uninstall.exe /S _?=<安装目录>` 卸载，退出码为 0，程序文件及两处 HKCU 注册表项消失，隔离用户数据库保留。证据：`build/installer-uninstall-results.json`。

## Windows 云服务器验收：隔离流程通过，后续已停止

本机 Hyper-V 查询权限不足、VMware 仅有 Kali/Ubuntu、未找到 Windows Sandbox。用户随后提供 Windows 云服务器，已通过 RDP 连接；远端系统为 Windows Server 2025 Datacenter x64（10.0.26100）。服务器已有官方 `0.2.8`、API7 的安装和业务数据，无运行中的任务。

新包复制到 `C:\ClientHubAcceptance\20261103`，核对 SHA-256 后安装至该目录的 `App` 子目录；安装退出码 0，默认沙箱启动通过（`fallback=false`）。测试使用独立用户数据和本地 HTTP 模拟模型，未使用原有业务数据库或真实模型 Key。

本地已回传的 `build/vm-transfer/install-results.json`、`vm-api-results.json`、`vm-app-results.json` 和 `vm-test.log` 记录：9 种格式解析及离线 OCR、模型失败保留、证据、增量去重/冲突、取消/剩余批次重试、问题归属、回答回写预览/确认、Word 导出、PDF 打印调用、Sidecar/整应用重启、退出后 Sidecar 关闭均通过。原生 PDF 文件保存没有完成，远端测试安装卸载和临时文件清理没有成功完成的证据。

用户明确要求停止远端工作、只清理本地；当前没有本机远程桌面连接进程，本机临时共享盘映射已解除，不再连接服务器。该服务器不是全新 Windows 10/11 客户端；以下清单保留为尚未全部覆盖的发布验收标准，不代表继续执行的授权：

1. 核对安装包 SHA-256；在未安装 Python/Node 的 Windows 标准用户环境安装，检查自选路径、快捷方式、启动和卸载。
2. 通过默认启动入口运行，不加禁用沙箱参数；设置页确认 API15、SQLite 数据目录、FFmpeg 与微信引擎可用。
3. 导入 Office、邮件、PNG 与扫描 PDF；离线 OCR 应能识别文字；无密钥时保留资料并说明原因。
4. 使用本地模拟模型验证选材确认、跨客户资料、证据、取消/剩余批次重试、追加去重/冲突、问题归属、回答及回写预览/确认。
5. 复制问题、Word 导出及原生打印保存 PDF；检查对外内容不含内部证据和模型信息。
6. 重启 Sidecar 和应用，确认资料、问题、回答仍存在；退出后无残留 Sidecar。
7. 官方更新包准备好后，另行验证旧版检查更新→下载进度→重启安装及数据保留；本地自定义安装器不作为该项证据。

真实模型联调需要明确授权，不能以已有 Key 自动调用收费接口。云服务器验收不能代替“全新 Windows 10/11 客户端”的系统覆盖。

## 本机临时文件清理交接

原审计清单曾包含 61 个明确目标，共 5,380,390,577 字节（5.38 GB / 5.011 GiB）。用户最近贴出的脚本输出为只读预览 `Audited local temporary files: 5.01 GiB`；没有证据确认随后执行了 `-Apply`，因此本记录不声称目标已删除，也不推断磁盘可用空间变化。用户可在本机确认预览清单后运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\code\Basu-Custom-Platform\scripts\cleanup-local-acceptance-temp.ps1" -Apply`。该脚本限定本机固定路径，保留最终安装包、SHA-256、主要验收证据、源码、依赖及真实业务数据，不连接或操作远程主机。
