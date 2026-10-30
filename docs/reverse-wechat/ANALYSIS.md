# WeChatDataAnalysis 逆向与集成笔记

目标：`D:\wechatExpore\WeChatDataAnalysis`（Electron 2.10.0，Windows）

## 1. 应用结构

- `resources/app.asar`：Electron 主进程，`src/main.cjs` 负责窗口、设置、输出目录和后端进程生命周期。
- `resources/backend/wechat-backend.exe`：PyInstaller 打包的 Python 3.11 FastAPI 后端，监听本机 HTTP。
- `resources/backend/native/`：WCDB/微信数据库读取所需的 native core（`wechatdb_client.dll`、`wechatdb_broker.exe`、`wechatdb_native_build.json`）。
- `resources/ui/`：Nuxt 构建的前端静态资源。

后端启动时使用的关键环境变量：

```text
WECHAT_TOOL_HOST=127.0.0.1
WECHAT_TOOL_PORT=10392
WECHAT_TOOL_DATA_DIR=%APPDATA%\wechat-data-analysis-desktop
WECHAT_TOOL_OUTPUT_DIR=%APPDATA%\wechat-data-analysis-desktop\output
PYTHONIOENCODING=utf-8
```

## 2. 数据库解密核心

来源模块：`src/wechat_decrypt_tool/wechat_decrypt.py`

微信 4.x 使用 SQLCipher/WCDB 页面格式：

| 参数 | 值 |
|---|---|
| page size | 4096 |
| key size | 32 字节（64 位 hex） |
| salt | 16 字节，page 1 前 16 字节 |
| IV | 16 字节 |
| HMAC | 64 字节 |
| KDF | PBKDF2-SHA512，256000 轮 |
| 加密 | AES-256-CBC |
| 完整性 | HMAC-SHA512 |

关键函数：

- `_derive_sqlcipher_enc_key(key_material, salt)`：PBKDF2-SHA512 → AES key。
- `_derive_mac_key(enc_key, salt)`：PBKDF2-SHA512（salt XOR 0x3A）→ HMAC key。
- `_compute_page_hmac(mac_key, page, page_num)`：页数据 + 页号 little-endian → HMAC-SHA512。
- `_decrypt_page(enc_key, page, page_num)`：取页尾 IV，AES-256-CBC 解密，保留页尾预留区。
- `WeChatDatabaseDecryptor.decrypt_database()`：逐页 HMAC 校验、逐页解密、WAL 合并、SQLite 诊断、原子替换输出。

WAL 处理由 `sqlite_wal.merge_wal_snapshot()` 完成；解密后的数据库会关闭 WAL 模式，避免导出库旁边继续生成 `-wal/-shm`。

## 3. 微信数据表结构

解密输出目录示例：

```text
%APPDATA%\wechat-data-analysis-desktop\output\databases\<account>\
  session.db
  contact.db
  message_0.db ... message_4.db
  message_resource.db
  media_0.db
  ...
```

### 会话

`session.db`：

- `SessionTable`：`username`, `summary`, `last_timestamp`, `sort_timestamp`, `last_msg_type`, `last_msg_sender` 等。
- `Name2Id`：消息发送者 rowid → username 的映射。

### 联系人

`contact.db`：

- `contact`：`username`, `local_type`, `remark`, `nick_name`, `alias` 等。
- `chat_room` / `chatroom_member`：群聊信息。

### 消息

`message_*.db`：

- 每个会话一张消息表，表名 `Msg_<md5(username)>`（大小写不敏感；群聊同样规则）。
- 表字段：`local_id`, `server_id`, `local_type`, `real_sender_id`, `create_time`, `message_content`, `compress_content`, `packed_info_data` 等。
- `local_type` 映射（节选）：
  - `1` 文本
  - `3` 图片
  - `34` 语音
  - `43`/`62` 视频
  - `47` 动画表情
  - `48` 位置
  - `49` 应用消息（文件/链接/小程序/引用等，需解析 XML）
  - `50` 通话
  - `10000` 系统消息
  - `25769803825` 文件
- 消息内容可能以明文、hex、base64 或 zstd frame（`28 B5 2F FD`）保存；`chat_helpers._decode_message_content()` 负责解码。

## 4. 原有导出接口

`routers/chat_export.py`：

- `POST /api/chat/exports`：创建导出任务。
- `GET /api/chat/exports/targets`：会话目标预览。
- `GET /api/chat/exports/{id}` / `/download`：任务状态和 ZIP 下载。
- 请求字段支持 `format`（json/txt/html/excel）、`scope`（selected/all/...）、`usernames`、`start_time`、`end_time`、`message_types`、`media_kinds`。
- 消息类型：`text,image,emoji,video,voice,chatHistory,file,link,transfer,redPacket,location,system,quote,voip`。

## 5. ClientHub 集成方式

新增 `services/ai/wechat_engine.py`：

1. 自动发现或通过 `WECHAT_DATA_ANALYSIS_BACKEND` 指定 `wechat-backend.exe`。
2. 在 10393 端口启动独立后端（不影响原应用默认 10392）。
3. 通过本机 HTTP 调用：
   - `GET /api/chat/accounts`
   - `GET /api/chat/sessions`
   - `GET /api/chat/messages`
4. 将选定会话的消息按日期、`renderType` 过滤后转换为 ClientHub 的 `ChatMessage`。
5. 写入 `services/ai/data/wechat-exports/<chatId>.json`，并调用 `store_chat_record()` 创建正常聊天记录。
6. 后续复用聊天分析、客户匹配、客户 360 时间线。

新增 Sidecar 接口：

```text
GET  /api/wechat/status
GET  /api/wechat/sessions
GET  /api/wechat/messages
POST /api/wechat/prepare          # 更新/解密微信库，异步任务
GET  /api/wechat/prepare/status   # 检测/密钥/解密/缓存进度
POST /api/wechat/import           # 提取会话，异步任务
GET  /api/wechat/import/status    # 读取/筛选/建记录/AI 解析进度
```

解密进度桥接原后端 `/api/decrypt_stream` 的 SSE 事件；提取进度在 ClientHub
内部按“读取会话→读取消息→筛选→创建记录→AI 解析”分阶段更新。

## 6. 验证记录

- 检测到微信账号：`wxid_hx87nglstbm222`（梧桐）。
- 读取微信会话：400 个。
- 测试导入：`李昀卓`，2026-10-23 日期范围，100 条文本消息。
- 结果：聊天记录创建成功，AI 摘要、问答、需求/承诺和客户 360 时间线均正常。
- 原始聊天截图 OCR 导入：老师 13 条、钟思成 31 条，已通过。

## 7. 限制

- 原版 `wechat-backend.exe` 和 `native/` 已复制到 ClientHub 的 `services/wechat-engine/`，不再要求用户安装 WeChatDataAnalysis；生产打包时把该目录作为 extraResources 带入安装包。
- 微信图片/语音/视频/文件目前以附件索引 + 原始媒体 URL 形式记录；离线复制全部媒体仍可继续扩展。
- 群聊的发送者显示名依赖原后端解析；群成员昵称映射可后续增强。
- 密钥只由原后端读取，ClientHub 不打印、不记录、不返回数据库密钥。
