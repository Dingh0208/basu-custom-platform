"""Managed bridge to the local WeChatDataAnalysis backend.

The original app ships a FastAPI backend that already implements WeChat 4.x
SQLCipher decryption, key storage, session listing and message decoding.  This
module launches that backend on a dedicated loopback port and gives the
ClientHub sidecar a small, typed API over it.
"""

from __future__ import annotations

import atexit
import json
import os
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any


def _find_backend() -> Path | None:
    candidates = []
    # Packaged one-file sidecar lives in <app>/resources/ai-sidecar/; the
    # engine sits in the sibling <app>/resources/wechat-engine/ directory.
    # __file__ points into PyInstaller's temp extraction dir in one-file
    # builds, so use sys.executable instead of __file__ for this path.
    exe_root = Path(sys.executable).resolve().parent.parent
    candidates.append(exe_root / "wechat-engine" / "wechat-backend.exe")
    configured = os.getenv("WECHAT_DATA_ANALYSIS_BACKEND", "").strip()
    if configured:
        candidates.append(Path(configured))
    # Dev tree layout: services/ai/wechat_engine.py -> services/wechat-engine.
    candidates.append(Path(__file__).resolve().parents[1] / "wechat-engine" / "wechat-backend.exe")
    appdata = os.getenv("APPDATA", "")
    candidates.extend(
        [
            Path(appdata) / "wechat-data-analysis-desktop" / "backend" / "wechat-backend.exe" if appdata else None,
            # Development fallback for this machine, kept last.
            Path(r"D:\wechatExpore\WeChatDataAnalysis\resources\backend\wechat-backend.exe"),
        ]
    )
    for candidate in candidates:
        if candidate and candidate.exists():
            return candidate
    return None


def _data_dir() -> Path:
    configured = os.getenv("WECHAT_DATA_ANALYSIS_DATA_DIR", "").strip()
    if configured:
        return Path(configured)
    appdata = os.getenv("APPDATA", "")
    return Path(appdata) / "wechat-data-analysis-desktop" if appdata else Path.cwd() / "wechat-data"


def _output_dir() -> Path:
    return Path(os.getenv("WECHAT_DATA_ANALYSIS_OUTPUT_DIR", str(_data_dir() / "output")))


_BACKEND_PORT = int(os.getenv("WECHAT_DATA_ANALYSIS_PORT", "10393"))
_BACKEND_URL = f"http://127.0.0.1:{_BACKEND_PORT}"
_process: subprocess.Popen | None = None
_log_handle = None
_job_lock = threading.Lock()
_prepare_job: dict[str, Any] = {"status": "idle", "progress": 0, "message": "尚未更新微信库"}
_import_job: dict[str, Any] = {"status": "idle", "progress": 0, "message": "尚未提取"}


def _health() -> dict | None:
    try:
        with urllib.request.urlopen(f"{_BACKEND_URL}/api/health", timeout=2) as response:
            data = json.loads(response.read().decode("utf-8"))
        return data if data.get("status") == "healthy" else None
    except Exception:
        return None


def _spawn() -> None:
    global _process, _log_handle
    if _process is not None and _process.poll() is None:
        return
    backend = _find_backend()
    if backend is None:
        raise RuntimeError(
            "未找到内置微信引擎 services/wechat-engine/wechat-backend.exe。请确认安装包包含 wechat-engine 目录。"
        )
    data_dir = _data_dir()
    output_dir = _output_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    log_path = data_dir / "clienthub-wechat-engine.log"
    _log_handle = open(log_path, "a", encoding="utf-8", buffering=1)
    env = {
        **os.environ,
        "WECHAT_TOOL_HOST": "127.0.0.1",
        "WECHAT_TOOL_PORT": str(_BACKEND_PORT),
        "WECHAT_TOOL_DATA_DIR": str(data_dir),
        "WECHAT_TOOL_OUTPUT_DIR": str(output_dir),
        "PYTHONIOENCODING": "utf-8",
    }
    _process = subprocess.Popen(
        [str(backend)],
        cwd=str(backend.parent),
        env=env,
        stdout=_log_handle,
        stderr=subprocess.STDOUT,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def ensure_engine(timeout_seconds: float = 35.0) -> dict:
    if _health():
        return {"available": True, "port": _BACKEND_PORT, "started": False, "backend": str(_find_backend() or "")}
    _spawn()
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if _health():
            return {"available": True, "port": _BACKEND_PORT, "started": True, "backend": str(_find_backend() or "")}
        if _process is not None and _process.poll() is not None:
            raise RuntimeError(f"微信解析引擎启动失败，退出码 {_process.returncode}。请查看 {_data_dir() / 'clienthub-wechat-engine.log'}")
        time.sleep(0.5)
    raise RuntimeError("微信解析引擎启动超时，请确认微信已登录、客户端未占用数据库，且安装包包含 wechat-engine。")


def _get(path: str, params: dict[str, Any] | None = None, timeout: int = 60) -> dict:
    ensure_engine()
    query = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v not in (None, "")})
    url = f"{_BACKEND_URL}{path}" + (f"?{query}" if query else "")
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _post(path: str, payload: dict, timeout: int = 600) -> dict:
    ensure_engine()
    request = urllib.request.Request(
        f"{_BACKEND_URL}{path}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def status() -> dict:
    try:
        ensure_engine()
        accounts = _get("/api/chat/accounts", timeout=15)
        infos = accounts.get("accountInfos", [])
        job = prepare_status()
        return {
            "available": True,
            "port": _BACKEND_PORT,
            "accounts": accounts.get("accounts", []),
            "defaultAccount": accounts.get("default_account"),
            "accountInfos": infos,
            "prepared": any(bool(info.get("hasDecryptedDbs")) for info in infos) or job.get("status") == "done",
            "prepareJob": job,
        }
    except Exception as exc:
        return {"available": False, "error": str(exc), "prepared": False, "prepareJob": prepare_status()}


def _update_job(job: dict, **changes: Any) -> None:
    with _job_lock:
        job.update(changes)


def prepare_status() -> dict:
    with _job_lock:
        return dict(_prepare_job)


def start_prepare() -> dict:
    with _job_lock:
        if _prepare_job.get("status") == "running":
            return dict(_prepare_job)
        _prepare_job.update({
            "status": "running",
            "phase": "detect",
            "progress": 3,
            "message": "正在检测微信数据目录…",
            "startedAt": datetime.now().isoformat(timespec="seconds"),
            "error": "",
            "account": "",
            "current": 0,
            "total": 0,
            "currentFile": "",
        })
    threading.Thread(target=_prepare_worker, daemon=True).start()
    return prepare_status()


def _prepare_worker() -> None:
    try:
        _update_job(_prepare_job, phase="detect", progress=6, message="正在检测微信数据目录（首次可能需要约 1 分钟）…")
        detection = _get("/api/wechat-detection", timeout=60)
        data = detection.get("data") or detection
        accounts = data.get("accounts") or []
        target = next((item for item in accounts if item.get("data_dir") and item.get("databases")), None)
        if target is None:
            raise RuntimeError("未检测到可用的微信数据目录，请确认微信已登录并退出微信后重试")
        data_dir = Path(str(target.get("data_dir")))
        db_storage = data_dir / "db_storage"
        account_name = str(target.get("account_name") or data_dir.name)
        _update_job(_prepare_job, account=account_name, phase="key", progress=15, message="正在读取本地微信数据库密钥…")

        saved = _get("/api/keys", {"db_storage_path": str(db_storage)}, timeout=60)
        key_info = saved.get("keys") or {}
        db_key = str(key_info.get("db_key") or "").strip()
        if not db_key:
            _update_job(_prepare_job, phase="key", progress=22, message="未找到已保存密钥，正在从微信进程获取…")
            key_result = _get("/api/get_keys", {"db_storage_path": str(db_storage)}, timeout=240)
            key_payload = key_result.get("keys") or key_result.get("data") or key_result
            if isinstance(key_payload, dict):
                db_key = str(key_payload.get("db_key") or key_result.get("db_key") or "").strip()
        if not db_key:
            raise RuntimeError("无法获取微信数据库密钥，请确认微信已登录并保持运行，或先在 WeChatDataAnalysis 中完成密钥获取")

        _update_job(_prepare_job, phase="decrypt", progress=25, message=f"开始解密 {account_name} 的微信数据库…")
        _stream_decrypt(db_key, db_storage)
        _update_job(_prepare_job, status="done", phase="done", progress=100, message="微信库更新完成，可以开始提取")
    except Exception as exc:
        _update_job(_prepare_job, status="failed", phase="error", message=f"更新失败：{exc}", error=str(exc))


def _stream_decrypt(db_key: str, db_storage: Path) -> None:
    query = urllib.parse.urlencode({"key": db_key, "db_storage_path": str(db_storage)})
    url = f"{_BACKEND_URL}/api/decrypt_stream?{query}"
    with urllib.request.urlopen(url, timeout=900) as response:
        for raw in response:
            line = raw.decode("utf-8", "ignore").strip()
            if not line.startswith("data:"):
                continue
            try:
                event = json.loads(line[5:].strip())
            except Exception:
                continue
            event_type = str(event.get("type") or "")
            if event_type == "scanning":
                _update_job(_prepare_job, phase="scan", progress=8, message="正在扫描数据库文件…")
            elif event_type == "phase":
                _update_job(_prepare_job, phase="lock", progress=max(10, int(_prepare_job.get("progress") or 0)), message=str(event.get("message") or "正在准备解密…"))
            elif event_type == "start":
                total = int(event.get("total") or 0)
                _update_job(_prepare_job, total=total, current=0, progress=12, message=f"开始解密 {total} 个数据库…")
            elif event_type == "progress":
                total = int(event.get("total") or 0)
                current = int(event.get("current") or 0)
                progress = 12 + int(83 * current / max(1, total))
                _update_job(_prepare_job, current=current, total=total, progress=min(95, progress), currentFile=str(event.get("current_file") or ""), message=str(event.get("message") or "解密中…"))
            elif event_type == "complete":
                _update_job(_prepare_job, progress=100, message=str(event.get("message") or "解密完成"))
            elif event_type == "error":
                raise RuntimeError(str(event.get("message") or "解密失败"))


def list_accounts() -> dict:
    return _get("/api/chat/accounts", timeout=30)


def list_sessions(account: str = "", limit: int = 400) -> dict:
    return _get("/api/chat/sessions", {"account": account or None, "limit": limit, "preview": "latest"}, timeout=45)


def _messages_page(account: str, username: str, limit: int, offset: int, order: str = "asc") -> dict:
    return _get(
        "/api/chat/messages",
        {"account": account or None, "username": username, "limit": limit, "offset": offset, "order": order},
        timeout=90,
    )


def fetch_messages(account: str, username: str, max_messages: int = 5000, start_ts: int | None = None) -> list[dict]:
    """Fetch messages, newest-first when a lower date bound exists.

    The original backend has no start/end query parameters; fetching newest
    first lets us stop as soon as a page crosses the requested start date
    instead of materializing an entire multi-thousand-message history.
    """
    messages: list[dict] = []
    offset = 0
    page_size = 500
    order = "desc" if start_ts else "asc"
    crossed_start = False
    while len(messages) < max_messages:
        data = _messages_page(account, username, page_size, offset, order)
        batch = data.get("messages") or []
        messages.extend(batch)
        if start_ts and batch:
            oldest = min(int(item.get("createTime") or 0) for item in batch)
            if oldest < start_ts:
                crossed_start = True
        if not batch or not data.get("hasMore") or len(batch) < page_size or crossed_start:
            break
        offset += len(batch)
    if order == "desc":
        messages = list(reversed(messages))
    return messages[:max_messages]


_RENDER_LABELS = {
    "text": "文本",
    "image": "图片",
    "emoji": "动画表情",
    "video": "视频",
    "voice": "语音",
    "file": "文件",
    "link": "链接",
    "chatHistory": "聊天记录",
    "quote": "引用",
    "system": "系统消息",
    "transfer": "转账",
    "redPacket": "红包",
    "location": "位置",
    "voip": "通话",
}


def _render_kind(render_type: str) -> str:
    if render_type in ("image", "emoji"):
        return "image"
    if render_type == "voice":
        return "voice"
    if render_type == "video":
        return "video"
    if render_type == "file":
        return "file"
    if render_type == "link":
        return "link"
    return "file"


def _message_content(item: dict) -> str:
    render_type = str(item.get("renderType") or "text")
    content = str(item.get("content") or "").strip()
    if content:
        return content
    title = str(item.get("title") or "").strip()
    if title:
        return title
    return f"[{_RENDER_LABELS.get(render_type, '消息')}]"


def normalize_messages(
    items: list[dict],
    *,
    account: str,
    username: str,
    start_ts: int | None = None,
    end_ts: int | None = None,
    render_types: list[str] | None = None,
) -> tuple[list[dict], list[dict]]:
    selected = set(render_types or [])
    messages: list[dict] = []
    attachments: list[dict] = []
    for index, item in enumerate(items, start=1):
        create_time = int(item.get("createTime") or 0)
        if start_ts and create_time < start_ts:
            continue
        if end_ts and create_time > end_ts:
            continue
        render_type = str(item.get("renderType") or "text")
        if selected and render_type not in selected:
            continue
        sent_at = datetime.fromtimestamp(create_time).strftime("%Y-%m-%d %H:%M") if create_time else ""
        sender = str(item.get("senderDisplayName") or item.get("senderUsername") or ("我" if item.get("isSent") else "对方"))
        message_id = f"wx-{item.get('localId') or index}"
        content = _message_content(item)
        messages.append({
            "id": message_id,
            "sender": sender,
            "sentAt": sent_at,
            "content": content,
            "renderType": render_type,
        })
        kind = _render_kind(render_type)
        if render_type in ("image", "emoji", "voice", "video", "file"):
            external_url = (
                item.get("imageUrl")
                or item.get("videoUrl")
                or item.get("videoThumbUrl")
                or item.get("thumbUrl")
                or ""
            )
            attachments.append({
                "id": f"wx-att-{item.get('localId') or index}",
                "kind": kind,
                "name": str(item.get("title") or content or _RENDER_LABELS.get(render_type, "附件")),
                "storedName": None,
                "label": _RENDER_LABELS.get(render_type, "附件"),
                "messageId": message_id,
                "externalUrl": external_url or None,
                "renderType": render_type,
            })
    return messages, attachments


def _account_self_name(account: str) -> str:
    try:
        accounts = list_accounts()
        for info in accounts.get("accountInfos", []):
            if info.get("account") == account and info.get("selfDisplayName"):
                return str(info["selfDisplayName"])
    except Exception:
        pass
    return "我"


def import_conversation(
    *,
    account: str,
    username: str,
    start_date: str = "",
    end_date: str = "",
    render_types: list[str] | None = None,
    customer: str = "",
    project: str = "",
    progress_cb=None,
) -> dict:
    """Fetch one conversation and feed it into ClientHub's normal chat pipeline."""
    import sys

    main_module = sys.modules.get("__main__")
    if main_module is None or not hasattr(main_module, "store_chat_record"):
        import main as main_module  # type: ignore[no-redef]
    store_chat_record = main_module.store_chat_record
    export_dir = main_module.EXPORT_DIR

    def progress(value: int, message: str) -> None:
        if progress_cb:
            progress_cb(value, message)

    progress(5, "正在读取微信会话信息…")
    sessions = list_sessions(account, 1000).get("sessions", [])
    session = next((item for item in sessions if item.get("username") == username or item.get("id") == username), None)
    if session is None:
        raise ValueError("找不到指定的微信会话")
    session_name = str(session.get("name") or session.get("username") or username)
    start_ts = int(datetime.strptime(start_date, "%Y-%m-%d").timestamp()) if start_date else None
    end_ts = int(datetime.strptime(end_date + " 23:59:59", "%Y-%m-%d %H:%M:%S").timestamp()) if end_date else None
    progress(15, "正在读取聊天消息…")
    raw = fetch_messages(account, username, start_ts=start_ts)
    progress(40, "正在按日期和记录类型筛选…")
    messages, attachments = normalize_messages(
        raw,
        account=account,
        username=username,
        start_ts=start_ts,
        end_ts=end_ts,
        render_types=render_types,
    )
    if not messages:
        raise ValueError("当前日期范围/记录类型下没有可导出的消息")
    self_name = _account_self_name(account)
    participants = [
        {"name": self_name, "role": "me"},
        {"name": session_name, "role": "customer"},
    ]
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    safe_name = "".join(ch for ch in session_name if ch not in r'\/:*?"<>|').strip() or "微信会话"
    file_name = f"微信聊天_{safe_name}_{stamp}.json"
    progress(55, "正在创建聊天记录…")
    stored = store_chat_record(
        messages,
        participants,
        file_name,
        customer or session_name,
        project or "—",
        attachments=attachments,
    )
    if stored is None:
        raise ValueError("没有足够消息，无法创建聊天记录")
    payload = {
        "source": "WeChatDataAnalysis",
        "account": account,
        "sessionUsername": username,
        "sessionName": session_name,
        "exportedAt": datetime.now().isoformat(timespec="seconds"),
        "startDate": start_date,
        "endDate": end_date,
        "renderTypes": render_types or [],
        "messageCount": len(messages),
        "messages": messages,
        "attachments": attachments,
    }
    export_dir.mkdir(parents=True, exist_ok=True)
    export_path = export_dir / f"{stored['chatId']}.json"
    export_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        **stored,
        "sessionName": session_name,
        "filePath": str(export_path),
        "fileLabel": file_name,
    }


def import_status() -> dict:
    with _job_lock:
        return dict(_import_job)


def start_import(
    *,
    account: str,
    username: str,
    start_date: str = "",
    end_date: str = "",
    render_types: list[str] | None = None,
    customer: str = "",
    project: str = "",
) -> dict:
    with _job_lock:
        if _import_job.get("status") == "running":
            return dict(_import_job)
        job_id = f"wximport-{uuid.uuid4().hex[:10]}"
        _import_job.update({
            "jobId": job_id,
            "status": "running",
            "progress": 2,
            "message": "正在连接微信聊天库…",
            "chatId": "",
            "importId": "",
            "sessionName": "",
            "messageCount": 0,
            "startedAt": datetime.now().isoformat(timespec="seconds"),
            "error": "",
        })
    threading.Thread(
        target=_import_worker,
        args=(account, username, start_date, end_date, render_types or [], customer, project),
        daemon=True,
    ).start()
    return import_status()


def _import_worker(account: str, username: str, start_date: str, end_date: str, render_types: list[str], customer: str, project: str) -> None:
    try:
        def progress(value: int, message: str) -> None:
            _update_job(_import_job, progress=max(2, min(99, value)), message=message)

        result = import_conversation(
            account=account,
            username=username,
            start_date=start_date,
            end_date=end_date,
            render_types=render_types,
            customer=customer,
            project=project,
            progress_cb=progress,
        )
        _update_job(
            _import_job,
            progress=68,
            message="聊天记录已创建，正在生成 AI 对话解析…",
            chatId=result["chatId"],
            importId=result["importId"],
            sessionName=result.get("sessionName", ""),
            messageCount=result.get("messageCount", 0),
        )
        # Wait for the normal chat-analysis background thread to finish.
        import sys
        main_module = sys.modules.get("__main__")
        deadline = time.time() + 240
        while time.time() < deadline:
            status = "processing"
            try:
                if main_module is not None and hasattr(main_module, "db"):
                    with main_module.db() as conn:
                        row = conn.execute("SELECT status FROM chats WHERE id=?", (result["chatId"],)).fetchone()
                        status = str(row["status"] if row else "processing")
            except Exception:
                status = "processing"
            if status == "done":
                _update_job(_import_job, status="done", progress=100, message="提取完成，聊天记录和 AI 解析已生成")
                return
            if status == "failed":
                _update_job(_import_job, status="failed", progress=90, message="聊天记录已创建，但 AI 解析失败", error="chat_analysis_failed")
                return
            _update_job(_import_job, progress=min(96, 68 + int((time.time() - (deadline - 240)) / 6)))
            time.sleep(1)
        _update_job(_import_job, status="done", progress=100, message="聊天记录已创建，AI 解析将在后台继续")
    except Exception as exc:
        _update_job(_import_job, status="failed", progress=0, message=f"提取失败：{exc}", error=str(exc))


@atexit.register
def _cleanup() -> None:
    global _process, _log_handle
    if _process is not None and _process.poll() is None:
        try:
            _process.terminate()
        except Exception:
            pass
    if _log_handle is not None:
        try:
            _log_handle.close()
        except Exception:
            pass
