#!/usr/bin/env python3
"""ClientHub AI Sidecar (Sprint 1 Mock).

A dependency-free local HTTP service that provides:
- health check
- imports CRUD (SQLite persisted)
- simulated import processing
- a mock transcript + summary payload for Sprint 1 UI integration

Run:
    python services/ai/main.py --port 8765
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import hashlib
import io
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
import zipfile
import sales
import document_ingest
import audio_pipeline
import notifications
from contextlib import contextmanager
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent


def load_env_file() -> None:
    """Load services/ai/.env without adding a dotenv dependency."""
    configured = os.getenv("CLIENTHUB_ENV_FILE", "").strip()
    if configured:
        env_file = Path(configured)
    else:
        env_file = BASE_DIR / ".env"
        if getattr(sys, "frozen", False):
            env_file = Path(sys.executable).resolve().parent / ".env"
    if not env_file.exists():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file()
DATA_DIR = Path(os.getenv("CLIENTHUB_DATA_DIR", str(BASE_DIR / "data")))
UPLOAD_DIR = DATA_DIR / "uploads"
EXPORT_DIR = DATA_DIR / "wechat-exports"
BACKUP_DIR = DATA_DIR / "backups"
DB_PATH = DATA_DIR / "clienthub.db"
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_LOCK = threading.RLock()

MAAS_BASE_URL = os.getenv("MAAS_BASE_URL", "https://maas.qianwenaiapi.com/compatible-mode/v1").rstrip("/")
MAAS_API_KEY = os.getenv("MAAS_API_KEY", "").strip()
MAAS_ASR_MODEL = os.getenv("MAAS_ASR_MODEL", "qwen3-asr-flash")
MAAS_SUMMARY_MODEL = os.getenv("MAAS_SUMMARY_MODEL", "qwen3.8-flash")
MAAS_VISION_MODEL = os.getenv("MAAS_VISION_MODEL", "qwen3.8-omni-flash")
FFMPEG = os.getenv("FFMPEG_PATH") or shutil.which("ffmpeg")
FFPROBE = os.getenv("FFPROBE_PATH") or shutil.which("ffprobe")

# Import after .env loading so the bundled WeChat engine sees configured paths/port.
import wechat_engine  # noqa: E402  (intentional import after environment loading)

DEFAULT_TRANSCRIPT = {
    "id": "tr-001",
    "title": "通话记录 · 会员小程序",
    "fileName": "2026-10-28_张三_会员小程序_通话录音.m4a",
    "fileSize": "42.8 MB",
    "duration": 1938,
    "importedAt": "10:24",
    "customer": "张三",
    "company": "某某科技有限公司",
    "project": "会员小程序商城",
    "source": "手机通话录音",
    "segments": [
        {"id": "s01", "start": 0, "end": 18, "speaker": "customer", "text": "王总，我们这边想做一个会员小程序，主要给老客户做积分和复购。"},
        {"id": "s02", "start": 18, "end": 26, "speaker": "me", "text": "明白，现在会员数据是在 ERP 里还是 Excel？"},
        {"id": "s03", "start": 26, "end": 41, "speaker": "customer", "text": "在 ERP 里，主要还是想打通，不然两边对不上。"},
        {"id": "s04", "start": 41, "end": 62, "speaker": "customer", "text": "预算大概八到十万，最好十一月底前能上线。"},
        {"id": "s05", "start": 62, "end": 75, "speaker": "me", "text": "双十一前时间比较紧，我建议先上核心的积分和支付，营销玩法二期再加。"},
        {"id": "s06", "start": 75, "end": 90, "speaker": "customer", "text": "可以，先看方案。我们老板张三拍板，我这边运营负责对接。"},
        {"id": "s07", "start": 90, "end": 102, "speaker": "me", "text": "那我周五前把方案和报价发您，下周一电话确认。"},
        {"id": "s08", "start": 102, "end": 118, "speaker": "customer", "text": "行，另外还要能发优惠券，最好能跟企微打通。"},
        {"id": "s09", "start": 118, "end": 138, "speaker": "me", "text": "企微接口可以评估，优惠券放在二期也可以。"},
        {"id": "s10", "start": 138, "end": 156, "speaker": "customer", "text": "我这边最担心的是工期，双十一前如果上不了，效果就差很多。"},
        {"id": "s11", "start": 156, "end": 171, "speaker": "me", "text": "理解，我们先把核心流程排出来，本周五给您一个明确的时间表。"},
        {"id": "s12", "start": 171, "end": 190, "speaker": "customer", "text": "行，另外报价里把会员等级和积分规则也拆开写一下。"},
        {"id": "s13", "start": 190, "end": 205, "speaker": "me", "text": "没问题，我会在方案里单独列出来。"},
    ],
    "summary": {
        "oneLine": "客户要做会员小程序，预算 8–10 万，目标 11 月底上线，本周五前需给出方案和报价。",
        "needs": "会员积分、微信支付、与现有 ERP 打通；担心工期影响双十一。",
        "budget": "8–10 万（客户口头区间） · 待报价",
        "timeline": "11 月底前上线 · 优先级高",
        "decisionMakers": "张三（老板，拍板）；李四（运营，日常对接）",
        "objections": "工期紧；客户在对比其他外包；优惠券和企微接口可能增加范围。",
        "nextActions": "周五前发方案 + 报价；下周一电话确认。",
        "paymentMethod": "",
        "confidence": 0.92,
        "evidenceCount": 6,
    },
}


def now_time() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


@contextmanager
def db():
    """Commit on success and always close the SQLite handle."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
        existing_database = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='imports'").fetchone() is not None
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS imports (
                id TEXT PRIMARY KEY,
                file_name TEXT NOT NULL,
                type TEXT NOT NULL,
                size TEXT NOT NULL,
                customer TEXT NOT NULL,
                project TEXT NOT NULL,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL,
                imported_at TEXT NOT NULL,
                transcript_id TEXT,
                sha256 TEXT UNIQUE
            );
            CREATE TABLE IF NOT EXISTS transcripts (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_size TEXT NOT NULL,
                duration INTEGER NOT NULL,
                imported_at TEXT NOT NULL,
                customer TEXT NOT NULL,
                company TEXT NOT NULL,
                project TEXT NOT NULL,
                source TEXT NOT NULL,
                segments_json TEXT NOT NULL,
                summary_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                file_name TEXT NOT NULL,
                customer TEXT NOT NULL,
                project TEXT NOT NULL,
                imported_at TEXT NOT NULL,
                participants_json TEXT NOT NULL,
                messages_json TEXT NOT NULL,
                analysis_json TEXT NOT NULL,
                status TEXT NOT NULL,
                message_count INTEGER NOT NULL,
                started_at TEXT,
                ended_at TEXT,
                attachments_json TEXT DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS customers (
                name TEXT PRIMARY KEY,
                company TEXT DEFAULT '—',
                position TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                wechat TEXT DEFAULT '',
                email TEXT DEFAULT '',
                tags_json TEXT DEFAULT '[]',
                source_channel TEXT DEFAULT '',
                owner TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                created_at TEXT,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                customer TEXT NOT NULL,
                name TEXT NOT NULL,
                stage TEXT DEFAULT '需求',
                budget TEXT DEFAULT '—',
                target_launch_date TEXT DEFAULT '',
                owner TEXT DEFAULT '',
                description TEXT DEFAULT '',
                created_at TEXT,
                updated_at TEXT,
                UNIQUE(customer, name)
            );
            CREATE TABLE IF NOT EXISTS requirements (
                id TEXT PRIMARY KEY,
                customer TEXT NOT NULL,
                project TEXT DEFAULT '—',
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                priority TEXT DEFAULT 'P1',
                status TEXT DEFAULT '待确认',
                source_type TEXT DEFAULT 'manual',
                source_id TEXT DEFAULT '',
                source_time TEXT DEFAULT '',
                source_quote TEXT DEFAULT '',
                created_at TEXT,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                import_id TEXT,
                entity_id TEXT,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                attempt INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 3,
                error TEXT DEFAULT '',
                payload_json TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT
            );
            CREATE TABLE IF NOT EXISTS corrections (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                field TEXT NOT NULL,
                before_text TEXT NOT NULL,
                after_text TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        conn.executescript(
            """
            CREATE INDEX IF NOT EXISTS idx_imports_status ON imports(status);
            CREATE INDEX IF NOT EXISTS idx_imports_customer_project ON imports(customer, project);
            CREATE INDEX IF NOT EXISTS idx_imports_imported_at ON imports(imported_at);
            CREATE INDEX IF NOT EXISTS idx_chats_status ON chats(status);
            CREATE INDEX IF NOT EXISTS idx_requirements_customer_project ON requirements(customer, project);
            CREATE INDEX IF NOT EXISTS idx_requirements_updated_at ON requirements(updated_at);
            CREATE INDEX IF NOT EXISTS idx_tasks_status_updated_at ON tasks(status, updated_at);
            CREATE INDEX IF NOT EXISTS idx_tasks_import_id ON tasks(import_id);
            CREATE INDEX IF NOT EXISTS idx_corrections_source ON corrections(source_id, created_at);
            """
        )
        migrate_ingest(conn)
        # Seed once so the UI has a realistic starting state.
        sales.migrate(conn)
        notifications.migrate(conn)
        count = conn.execute("SELECT COUNT(*) AS n FROM imports").fetchone()["n"]
        if not existing_database and count == 0:
            seed = [
                ("imp-001", "2026-10-28_张三_会员小程序_通话录音.m4a", "音频", "42.8 MB", "张三", "会员小程序商城", "done", 100, "10:31", "tr-001", "seed-001"),
                ("imp-002", "微信聊天_张三_20261027.txt", "聊天记录", "1.2 MB", "张三", "会员小程序商城", "processing", 60, "10:28", None, "seed-002"),
                ("imp-003", "某某科技_会员小程序_需求说明书.pdf", "PDF", "3.4 MB", "待归档", "—", "inbox", 0, "10:20", None, "seed-003"),
            ]
            conn.executemany(
                "INSERT INTO imports (id,file_name,type,size,customer,project,status,progress,imported_at,transcript_id,sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                seed,
            )
        tcount = conn.execute("SELECT COUNT(*) AS n FROM transcripts").fetchone()["n"]
        if not existing_database and tcount == 0:
            t = DEFAULT_TRANSCRIPT
            conn.execute(
                "INSERT INTO transcripts (id,title,file_name,file_size,duration,imported_at,customer,company,project,source,segments_json,summary_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    t["id"], t["title"], t["fileName"], t["fileSize"], t["duration"], t["importedAt"],
                    t["customer"], t["company"], t["project"], t["source"],
                    json.dumps(t["segments"], ensure_ascii=False), json.dumps(t["summary"], ensure_ascii=False),
                ),
            )


def row_to_import(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "fileName": row["file_name"],
        "type": row["type"],
        "size": row["size"],
        "customer": row["customer"],
        "project": row["project"],
        "status": row["status"],
        "progress": row["progress"],
        "importedAt": row["imported_at"],
        "transcriptId": row["transcript_id"],
        "owner": row["owner"] or "",
    }


class TaskCancelled(Exception):
    """Raised inside a worker when the user cancels a persisted task."""


TASK_ACTIVE = {"queued", "running"}
TASK_TERMINAL = {"succeeded", "failed", "cancelled"}


def task_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def row_to_task(row: sqlite3.Row, *, include_payload: bool = False) -> dict:
    payload = json.loads(row["payload_json"] or "{}")
    task = {
        "id": row["id"],
        "kind": row["kind"],
        "importId": row["import_id"],
        "entityId": row["entity_id"],
        "status": row["status"],
        "progress": int(row["progress"] or 0),
        "attempt": int(row["attempt"] or 0),
        "maxAttempts": int(row["max_attempts"] or 3),
        "error": row["error"] or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "startedAt": row["started_at"],
        "finishedAt": row["finished_at"],
    }
    if include_payload:
        task["payload"] = payload
    return task


def create_task(kind: str, *, import_id: str = "", entity_id: str = "", payload: dict | None = None) -> str:
    task_id = f"task-{uuid.uuid4().hex[:12]}"
    now = task_now()
    with db() as conn:
        conn.execute(
            "INSERT INTO tasks (id,kind,import_id,entity_id,status,progress,attempt,max_attempts,error,payload_json,created_at,updated_at,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (task_id, kind, import_id or None, entity_id or None, "queued", 0, 0, 3, "", json.dumps(payload or {}, ensure_ascii=False), now, now, None, None),
        )
    return task_id


def get_task(task_id: str) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    return row_to_task(row) if row else None


def list_tasks(limit: int = 100) -> list[dict]:
    limit = max(1, min(int(limit or 100), 500))
    with db() as conn:
        rows = conn.execute("SELECT * FROM tasks ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END, updated_at DESC LIMIT ?", (limit,)).fetchall()
    return [row_to_task(row) for row in rows]


def task_status(task_id: str) -> str:
    with db() as conn:
        row = conn.execute("SELECT status FROM tasks WHERE id=?", (task_id,)).fetchone()
    return str(row["status"]) if row else ""


def has_active_replacement(task_id: str) -> bool:
    with db() as conn:
        row = conn.execute("SELECT import_id,entity_id FROM tasks WHERE id=?", (task_id,)).fetchone()
        if row is None:
            return False
        if row["import_id"]:
            return conn.execute(
                "SELECT 1 FROM tasks WHERE id<>? AND import_id=? AND status IN ('queued','running') LIMIT 1",
                (task_id, row["import_id"]),
            ).fetchone() is not None
        if row["entity_id"]:
            return conn.execute(
                "SELECT 1 FROM tasks WHERE id<>? AND entity_id=? AND status IN ('queued','running') LIMIT 1",
                (task_id, row["entity_id"]),
            ).fetchone() is not None
    return False


def ensure_task_active(task_id: str | None) -> None:
    if task_id and task_status(task_id) == "cancelled":
        raise TaskCancelled()


def set_task_running(task_id: str) -> bool:
    now = task_now()
    with db() as conn:
        row = conn.execute("SELECT status FROM tasks WHERE id=?", (task_id,)).fetchone()
        if row is None or row["status"] == "cancelled":
            return False
        conn.execute(
            "UPDATE tasks SET status='running', attempt=attempt+1, updated_at=?, started_at=?, finished_at=NULL WHERE id=?",
            (now, now, task_id),
        )
    return True


def set_task_progress(task_id: str | None, progress: int) -> None:
    if not task_id:
        return
    with db() as conn:
        conn.execute(
            "UPDATE tasks SET progress=?, updated_at=? WHERE id=? AND status='running'",
            (max(0, min(100, int(progress))), task_now(), task_id),
        )


def finish_task(task_id: str | None, status: str, *, progress: int | None = None, error: str = "") -> None:
    if not task_id:
        return
    now = task_now()
    with db() as conn:
        if progress is None:
            conn.execute(
                "UPDATE tasks SET status=?, error=?, updated_at=?, finished_at=? WHERE id=?",
                (status, error[:1000], now, now if status in TASK_TERMINAL else None, task_id),
            )
        else:
            conn.execute(
                "UPDATE tasks SET status=?, progress=?, error=?, updated_at=?, finished_at=? WHERE id=?",
                (status, max(0, min(100, int(progress))), error[:1000], now, now if status in TASK_TERMINAL else None, task_id),
            )


def set_import_status(import_id: str, status: str, progress: int = 0) -> None:
    if not import_id:
        return
    with db() as conn:
        conn.execute("UPDATE imports SET status=?, progress=? WHERE id=?", (status, progress, import_id))


def cancel_task(task_id: str) -> dict | None:
    now = task_now()
    attachment_task = None
    with db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if row is None:
            return None
        if row["status"] in TASK_TERMINAL:
            return row_to_task(row)
        conn.execute("UPDATE tasks SET status='cancelled', error='', updated_at=?, finished_at=? WHERE id=?", (now, now, task_id))
        if row["import_id"]:
            conn.execute("UPDATE imports SET status='cancelled' WHERE id=? AND status IN ('processing','queued')", (row["import_id"],))
        if row["entity_id"] and row["kind"] == "chat_analysis":
            conn.execute("UPDATE chats SET status='cancelled' WHERE id=? AND status='processing'", (row["entity_id"],))
        if row["kind"] == "attachment_voice":
            attachment_task = (json.loads(row["payload_json"] or "{}"), row["entity_id"])
        updated = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if attachment_task:
        payload, source_id = attachment_task
        update_attachment(payload.get("sourceType", "chat"), source_id, payload.get("attachmentId", ""), {"transcriptStatus": "failed", "transcriptError": "转写已取消，可以重试"})
    return row_to_task(updated)


def delete_import(import_id: str) -> dict:
    files_to_remove: list[Path] = []
    with db() as conn:
        row = conn.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
        if row is None:
            raise ValueError("导入记录不存在")
        active_task = conn.execute(
            "SELECT 1 FROM tasks WHERE (import_id=? OR (entity_id=? AND kind='attachment_voice')) AND status IN ('queued','running') LIMIT 1",
            (import_id, row["transcript_id"]),
        ).fetchone()
        if row["status"] == "processing" or active_task:
            raise ValueError("文件仍在处理中，请等待处理完成后再删除")
        transcript_id = str(row["transcript_id"] or "")
        other = conn.execute("SELECT COUNT(*) AS n FROM imports WHERE transcript_id=? AND id<>?", (transcript_id, import_id)).fetchone()["n"] if transcript_id else 0
        deleted_sources = [import_id]
        if transcript_id and (transcript_id.startswith("chat-") or not other):
            deleted_sources.append(transcript_id)
        placeholders = ",".join("?" for _ in deleted_sources)
        conn.execute(f"DELETE FROM todos WHERE source_id IN ({placeholders}) OR requirement_id IN (SELECT id FROM requirements WHERE source_id IN ({placeholders}))",
                     (*deleted_sources, *deleted_sources))
        customer = str(row["customer"] or "")
        chat = None
        if transcript_id.startswith("chat-"):
            chat = conn.execute("SELECT * FROM chats WHERE id=?", (transcript_id,)).fetchone()
            if chat:
                attachments = json.loads(chat["attachments_json"] or "[]")
                for attachment in attachments:
                    if attachment.get("storedName"):
                        files_to_remove.append(UPLOAD_DIR / str(attachment["storedName"]))
                files_to_remove.append(EXPORT_DIR / f"{transcript_id}.json")
                conn.execute("DELETE FROM requirements WHERE source_type='chat' AND source_id=?", (transcript_id,))
                conn.execute("DELETE FROM chats WHERE id=?", (transcript_id,))
        elif transcript_id:
            if not other:
                conn.execute("DELETE FROM requirements WHERE source_id IN (?,?)", (import_id, transcript_id))
                conn.execute("DELETE FROM transcripts WHERE id=?", (transcript_id,))
        # Also remove requirements created directly from this import id.
        conn.execute("DELETE FROM requirements WHERE source_id=?", (import_id,))
        conn.execute("DELETE FROM tasks WHERE import_id=?", (import_id,))
        if transcript_id:
            conn.execute("UPDATE tasks SET status='cancelled',error='来源记录已删除',updated_at=?,finished_at=? WHERE entity_id=? AND status IN ('queued','running')", (task_now(), task_now(), transcript_id))
        conn.execute("DELETE FROM corrections WHERE source_id IN (?,?)", (import_id, transcript_id))
        conn.execute("DELETE FROM imports WHERE id=?", (import_id,))
    files_to_remove.extend(UPLOAD_DIR.glob(f"{import_id}*"))
    for path in files_to_remove:
        try:
            if path.is_file():
                path.unlink()
        except OSError:
            pass
    return {"deleted": import_id, "customer": customer, "chatDeleted": bool(chat)}


def migrate_ingest(conn: sqlite3.Connection) -> None:
    for table in ("chats", "transcripts"):
        columns = {column[1] for column in conn.execute(f"PRAGMA table_info({table})")}
        if "attachments_json" not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN attachments_json TEXT DEFAULT '[]'")
    conn.execute("""CREATE TABLE IF NOT EXISTS corrections (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, field TEXT NOT NULL,
        before_text TEXT NOT NULL, after_text TEXT NOT NULL, created_at TEXT NOT NULL
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_corrections_source ON corrections(source_id, created_at)")


def row_to_transcript(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "fileName": row["file_name"],
        "fileSize": row["file_size"],
        "duration": row["duration"],
        "importedAt": row["imported_at"],
        "customer": row["customer"],
        "company": row["company"],
        "project": row["project"],
        "source": row["source"],
        "segments": json.loads(row["segments_json"]),
        "summary": json.loads(row["summary_json"]),
        "attachments": json.loads(row["attachments_json"] or "[]"),
        "corrections": list_corrections(row["id"]),
    }


def list_corrections(source_id: str) -> list[dict]:
    with db() as conn:
        rows = conn.execute("SELECT field,before_text,after_text,created_at FROM corrections WHERE source_id=? ORDER BY created_at DESC LIMIT 30", (source_id,)).fetchall()
    return [{"field": row["field"], "before": row["before_text"], "after": row["after_text"], "createdAt": row["created_at"]} for row in rows]


def record_correction(conn: sqlite3.Connection, source_id: str, field: str, before: str, after: str) -> None:
    if before != after:
        conn.execute("INSERT INTO corrections VALUES (?,?,?,?,?,?)", (f"fix-{uuid.uuid4().hex[:12]}", source_id, field, before, after, datetime.now().isoformat(timespec="seconds")))


CHAT_TIMESTAMP_RE = re.compile(r"^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$")


def parse_chat_messages(text: str) -> list[dict]:
    """Parse common WeChat-style exports:
    sender line, timestamp line, message lines, blank line.
    Also accepts `sender: message` lines as a fallback.
    """
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    messages: list[dict] = []
    current_sender = ""
    current_time = ""
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        match = CHAT_TIMESTAMP_RE.match(line)
        if match:
            current_time = f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d} {int(match.group(4)):02d}:{match.group(5)}"
            i += 1
            content_lines: list[str] = []
            while i < len(lines):
                nxt = lines[i].strip()
                if not nxt:
                    break
                if CHAT_TIMESTAMP_RE.match(nxt):
                    break
                if i + 1 < len(lines) and CHAT_TIMESTAMP_RE.match(lines[i + 1].strip()) and len(nxt) <= 40:
                    break
                content_lines.append(nxt)
                i += 1
            content = "\n".join(content_lines).strip()
            if current_sender and content:
                messages.append({"sender": current_sender, "sentAt": current_time, "content": content})
            continue
        if i + 1 < len(lines) and CHAT_TIMESTAMP_RE.match(lines[i + 1].strip()):
            current_sender = line
            i += 1
            continue
        named = re.match(r"^([^：:]{1,30})[：:]\s*(.+)$", line)
        if named:
            messages.append({"sender": named.group(1).strip(), "sentAt": current_time, "content": named.group(2).strip()})
            i += 1
            continue
        if messages:
            messages[-1]["content"] = messages[-1]["content"] + "\n" + line
        i += 1
    for index, message in enumerate(messages, start=1):
        message["id"] = f"msg-{index:03d}"
    return messages


def infer_me_name(messages: list[dict]) -> str:
    scores: dict[str, int] = {}
    for message in messages:
        sender = message["sender"]
        content = message["content"]
        score = 0
        if any(word in content for word in ("找我", "联系我", "随时找我", "我这边", "我们提供")):
            score += 3
        if "我" in content:
            score += 1
        scores[sender] = scores.get(sender, 0) + score
    if not scores:
        return ""
    return max(scores, key=scores.get)


def analyze_chat_messages(messages: list[dict], me_name: str) -> dict:
    # Keep the prompt bounded for long WeChat exports: the most recent messages
    # carry the actionable context, while a 5,000-message transcript can exceed
    # the model request budget and make extraction look stuck.
    analysis_messages = messages[-800:] if len(messages) > 800 else messages
    transcript = "\n".join(f"[{m['sentAt']}] {m['sender']}: {m['content']}" for m in analysis_messages)
    if len(transcript) > 18000:
        transcript = transcript[-18000:]
    prompt = f"""你是客户聊天分析助手。请只根据下面的聊天记录输出 JSON，不要输出 Markdown。
已知“我”是：{me_name or '未知'}。请判断每位参与者是“客户”还是“我”。

输出严格 JSON，字段固定：
{{
  "summary": "一段话总结",
  "topic": "聊天主题",
  "project": "聊天中明确提到的客户在跟进项目/事项名称（不是聊天主题；没有明确项目则空字符串）",
  "participants": [{{"name": "", "role": "客户/我", "evidence": ""}}],
  "keyQa": [{{"question": "", "answer": "", "time": "", "evidence": ""}}],
  "requirements": [{{"title": "", "description": "", "status": "待确认", "priority": "P1", "evidence": ""}}],
  "commitments": [{{"content": "", "owner": "", "due": "", "evidence": ""}}],
  "nextActions": [{{"action": "", "owner": "", "due": "", "evidence": ""}}],
  "risks": [{{"content": "聊天中明确提到的风险或异议；没有则空数组", "evidence": "原文"}}],
  "tags": []
}}
要求：
1. 不得编造聊天中没有的信息；没有提到的字段填空字符串或空数组。
2. 每条结论尽量带 evidence（原文）。
3. 如果只是闲聊、没有明确需求，requirements 可以为空数组。
聊天记录：
{transcript}"""
    payload = {
        "model": get_llm_config()["summaryModel"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 2200,
        "response_format": {"type": "json_object"},
    }
    result = maas_request("/chat/completions", payload, timeout=600)
    content = str(result.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content).strip()
    data = json.loads(content)
    for key, default in (
        ("summary", ""), ("topic", ""), ("project", ""), ("participants", []), ("keyQa", []),
        ("requirements", []), ("commitments", []), ("nextActions", []), ("risks", []), ("tags", []),
    ):
        if key not in data or data[key] is None:
            data[key] = default
    for key in ("keyQa", "requirements", "commitments", "nextActions", "risks"):
        if not isinstance(data[key], list):
            raise ValueError("聊天分析结果格式不正确，请重试")
        for item in data[key]:
            if not isinstance(item, dict):
                raise ValueError("聊天分析结果格式不正确，请重试")
            quote = item.get("evidence")
            item["evidenceVerified"] = isinstance(quote, str) and bool(quote.strip()) and quote.strip() in transcript
    checked = [item for key in ("keyQa", "requirements", "commitments", "nextActions", "risks") for item in data[key]]
    data["evidenceCount"] = sum(item["evidenceVerified"] for item in checked)
    data["confidence"] = round(data["evidenceCount"] / len(checked), 2) if checked else 0
    return data


def process_chat_analysis(import_id: str, chat_id: str, task_id: str | None = None) -> None:
    try:
        ensure_task_active(task_id)
        set_task_progress(task_id, 5)
        with db() as conn:
            row = conn.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
        if row is None:
            finish_task(task_id, "failed", error="聊天记录不存在")
            return
        messages = json.loads(row["messages_json"])
        me_name = next((p["name"] for p in json.loads(row["participants_json"]) if p.get("role") == "me"), "")
        ensure_task_active(task_id)
        set_task_progress(task_id, 20)
        analysis = analyze_chat_messages(messages, me_name)
        ensure_task_active(task_id)
        set_task_progress(task_id, 85)
        project_name = str(analysis.get("project") or "").strip() or "—"
        with db() as conn:
            ensure_task_active(task_id)
            chat_update = conn.execute(
                "UPDATE chats SET analysis_json=?, status='done', project=? WHERE id=? AND status='processing'",
                (json.dumps(analysis, ensure_ascii=False), project_name, chat_id),
            )
            if chat_update.rowcount != 1:
                if task_id and task_status(task_id) == "cancelled":
                    raise TaskCancelled()
                raise RuntimeError("聊天记录状态已改变，任务未完成")
            if import_id:
                import_update = conn.execute(
                    "UPDATE imports SET progress=100, status='done', transcript_id=?, project=? WHERE id=? AND status='processing'",
                    (chat_id, project_name, import_id),
                )
                if import_update.rowcount != 1:
                    if task_id and task_status(task_id) == "cancelled":
                        raise TaskCancelled()
                    raise RuntimeError("导入记录状态已改变，任务未完成")
        insert_requirements_from_chat(chat_id, str(row["customer"]), project_name, analysis, source_time=str(row["imported_at"] or ""))
        finish_task(task_id, "succeeded", progress=100)
    except TaskCancelled:
        print(f"[ai-sidecar] chat analysis cancelled {chat_id}", flush=True)
        if task_id and task_status(task_id) == "running":
            return
        if task_id and has_active_replacement(task_id):
            return
        with db() as conn:
            conn.execute("UPDATE chats SET status='cancelled' WHERE id=?", (chat_id,))
            conn.execute("UPDATE imports SET status='cancelled' WHERE id=?", (import_id,))
        finish_task(task_id, "cancelled", progress=0)
    except Exception as exc:
        print(f"[ai-sidecar] chat analysis error {chat_id}: {exc}", flush=True)
        with db() as conn:
            conn.execute("UPDATE chats SET status='failed' WHERE id=?", (chat_id,))
            conn.execute("UPDATE imports SET status='failed' WHERE id=?", (import_id,))
        finish_task(task_id, "failed", progress=0, error=str(exc))


def store_chat_record(
    messages: list[dict],
    participants: list[dict],
    file_name: str,
    customer: str = "",
    project: str = "",
    attachments: list[dict] | None = None,
    source_image_bytes: bytes | None = None,
    source_image_name: str = "",
) -> dict | None:
    if len(messages) < 2:
        return None
    senders = list(dict.fromkeys(m["sender"] for m in messages))
    if len(senders) < 2:
        return None
    role_by_name: dict[str, str] = {}
    for participant in participants:
        name = str(participant.get("name") or "").strip()
        role = str(participant.get("role") or "").strip()
        if not name:
            continue
        if role in ("我", "本人", "自己", "me", "Me", "ME"):
            role_by_name[name] = "me"
        elif role in ("客户", "对方", "customer", "Customer"):
            role_by_name[name] = "customer"
    # Ensure both roles exist. Screenshot models sometimes omit "我".
    for sender in senders:
        if sender in ("我", "本人", "自己") and "me" not in role_by_name.values():
            role_by_name[sender] = "me"
    if "me" not in role_by_name.values():
        role_by_name[infer_me_name(messages)] = "me"
    normalized_participants = []
    for sender in senders:
        role = role_by_name.get(sender)
        if role not in ("me", "customer"):
            role = "customer"
        normalized_participants.append({"name": sender, "role": role})
    # Avoid the same sender being both me and customer.
    me_names = {p["name"] for p in normalized_participants if p["role"] == "me"}
    if not me_names:
        normalized_participants[-1]["role"] = "me"
        me_names = {normalized_participants[-1]["name"]}
    for participant in normalized_participants:
        if participant["role"] == "customer" and participant["name"] in me_names:
            participant["role"] = "me"
    if not any(p["role"] == "customer" for p in normalized_participants):
        # If all participants are me, treat the first non-me candidate as customer.
        for participant in normalized_participants:
            if participant["name"] not in me_names:
                participant["role"] = "customer"
                break

    for index, message in enumerate(messages, start=1):
        message.setdefault("id", f"msg-{index:03d}")
        message.setdefault("sentAt", "")
        message.setdefault("content", "")
    customer_name = customer or next((p["name"] for p in normalized_participants if p["role"] == "customer"), senders[0])
    chat_id = f"chat-{uuid.uuid4().hex[:10]}"
    import_id = f"imp-{uuid.uuid4().hex[:10]}"
    title = f"微信聊天 · {customer_name}"
    started_at = messages[0].get("sentAt") or now_time()
    ended_at = messages[-1].get("sentAt") or started_at

    attachment_index: list[dict] = list(attachments or [])
    if source_image_bytes is not None:
        suffix = Path(source_image_name or "screenshot.png").suffix or ".png"
        stored_name = f"{chat_id}{suffix}"
        (UPLOAD_DIR / stored_name).write_bytes(source_image_bytes)
        attachment_index.insert(0, {
            "id": f"att-{uuid.uuid4().hex[:8]}",
            "kind": "image",
            "name": source_image_name or stored_name,
            "storedName": stored_name,
            "label": "原始截图",
            "messageId": None,
        })
    kind_map = {"图片": "image", "语音": "voice", "文件": "file", "视频": "video", "链接": "link"}
    for message in messages:
        match = re.search(r"\[(图片|语音|文件|视频|链接)\]", message.get("content", ""))
        if match and not any(a.get("messageId") == message.get("id") for a in attachment_index):
            attachment_index.append({
                "id": f"att-{uuid.uuid4().hex[:8]}",
                "kind": kind_map[match.group(1)],
                "name": match.group(1),
                "storedName": None,
                "label": f"消息中的{match.group(1)}",
                "messageId": message.get("id"),
            })

    with db() as conn:
        conn.execute(
            "INSERT INTO imports (id,file_name,type,size,customer,project,status,progress,imported_at,transcript_id,sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (import_id, file_name, "聊天记录", f"{len(messages)} 条", customer_name, project or "—", "processing", 20, now_time(), chat_id, None),
        )
        conn.execute(
            "INSERT INTO chats (id,title,file_name,customer,project,imported_at,participants_json,messages_json,analysis_json,status,message_count,started_at,ended_at,attachments_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                chat_id, title, file_name, customer_name, project or "—", now_time(),
                json.dumps(normalized_participants, ensure_ascii=False), json.dumps(messages, ensure_ascii=False),
                "{}", "processing", len(messages), started_at, ended_at,
                json.dumps(attachment_index, ensure_ascii=False),
            ),
        )
    task_id = create_task("chat_analysis", import_id=import_id, entity_id=chat_id, payload={"importId": import_id, "chatId": chat_id})
    start_task(task_id, process_chat_analysis, import_id, chat_id)
    return {"importId": import_id, "chatId": chat_id, "taskId": task_id, "messageCount": len(messages), "participants": normalized_participants}


def create_chat_record(text: str, file_name: str, customer: str = "", project: str = "", me_name: str = "") -> dict | None:
    messages = parse_chat_messages(text)
    if len(messages) < 2:
        return None
    senders = list(dict.fromkeys(m["sender"] for m in messages))
    if len(senders) < 2:
        return None
    inferred_me = me_name or infer_me_name(messages)
    participants = [{"name": sender, "role": "me" if sender == inferred_me else "customer"} for sender in senders]
    return store_chat_record(messages, participants, file_name, customer, project)


def extract_chat_screenshot(image_bytes: bytes, mime_type: str, file_name: str, customer: str = "", project: str = "") -> dict | None:
    data_uri = f"data:{mime_type or 'image/png'};base64,{base64.b64encode(image_bytes).decode()}"
    prompt = f"""请把这张微信聊天截图解析为 JSON，不要输出 Markdown。
规则：
1. 右侧绿色气泡是“我”，左侧灰色气泡是“对方/客户”；客户昵称优先从截图顶部联系人名称读取{('（提示：' + customer + '）') if customer else ''}，没有名称时用“老师”。
2. 合并同一个气泡内被换行拆开的文字。
3. 保留每条消息前的发送人和时间；时间如果只出现一次就用于后续消息，直到出现新时间。
4. 忽略“撤回了一条消息”“查看更多消息”等系统提示；图片消息记为“[图片]”，链接消息保留文字。
输出格式：
{{"participants":[{{"name":"","role":"客户"}}],"messages":[{{"sender":"","time":"","content":""}}],"summary":""}}"""
    payload = {
        "model": get_llm_config()["visionModel"],
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": data_uri}},
            {"type": "text", "text": prompt},
        ]}],
        "temperature": 0.1,
        "max_tokens": 5000,
        "response_format": {"type": "json_object"},
    }
    result = maas_request("/chat/completions", payload, timeout=600)
    content = str(result.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content).strip()
    data = json.loads(content)
    messages = data.get("messages") or []
    for index, message in enumerate(messages, start=1):
        message.setdefault("id", f"msg-{index:03d}")
        message.setdefault("sentAt", "")
        message.setdefault("content", "")
        # Model output uses time; our storage uses sentAt.
        if not message.get("sentAt") and message.get("time"):
            message["sentAt"] = message.pop("time")
        else:
            message.pop("time", None)
    participants = data.get("participants") or []
    stored = store_chat_record(
        messages,
        participants,
        file_name,
        customer,
        project,
        source_image_bytes=image_bytes,
        source_image_name=file_name,
    )
    if stored:
        stored["visionSummary"] = str(data.get("summary") or "")
    return stored


def row_to_chat(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "fileName": row["file_name"],
        "customer": row["customer"],
        "project": row["project"],
        "importedAt": row["imported_at"],
        "participants": json.loads(row["participants_json"]),
        "messages": json.loads(row["messages_json"]),
        "analysis": json.loads(row["analysis_json"]),
        "attachments": json.loads(row["attachments_json"] or "[]") if "attachments_json" in row.keys() else [],
        "corrections": list_corrections(row["id"]),
        "status": row["status"],
        "messageCount": row["message_count"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
    }


def _customer_default_company(name: str) -> str:
    return "某某科技有限公司" if name == "张三" else "—"


def _customer_row(row: sqlite3.Row, *, record_count: int = 0, last_at: str = "", project: str = "—") -> dict:
    return {
        "name": row["name"],
        "company": row["company"] or "—",
        "position": row["position"] or "",
        "phone": row["phone"] or "",
        "wechat": row["wechat"] or "",
        "email": row["email"] or "",
        "tags": json.loads(row["tags_json"] or "[]"),
        "sourceChannel": row["source_channel"] or "",
        "owner": row["owner"] or "",
        "notes": row["notes"] or "",
        "recordCount": int(record_count),
        "lastAt": last_at,
        "project": project,
    }


def _ensure_customer(conn: sqlite3.Connection, name: str, *, company: str = "", owner: str = "王总") -> None:
    if not name or name == "待归档":
        return
    existing = conn.execute("SELECT name FROM customers WHERE name=?", (name,)).fetchone()
    if existing:
        return
    now = datetime.now().isoformat(timespec="seconds")
    conn.execute(
        "INSERT INTO customers (name,company,position,phone,wechat,email,tags_json,source_channel,owner,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (name, company or _customer_default_company(name), "", "", "", "", "[]", "", owner, "", now, now),
    )


def dashboard_summary() -> dict:
    with db() as conn:
        _sync_projects_from_records(conn)
        stats = {
            "imports": conn.execute("SELECT COUNT(*) AS n FROM imports").fetchone()["n"],
            "customers": conn.execute("SELECT COUNT(*) AS n FROM customers").fetchone()["n"],
            "projects": conn.execute("SELECT COUNT(*) AS n FROM projects").fetchone()["n"],
            "requirements": conn.execute("SELECT COUNT(*) AS n FROM requirements").fetchone()["n"],
            "inbox": conn.execute("SELECT COUNT(*) AS n FROM imports WHERE status='inbox' OR customer IN ('','待归档','待确认')").fetchone()["n"],
            "processing": conn.execute("SELECT COUNT(*) AS n FROM imports WHERE status='processing'").fetchone()["n"],
        }
        recent_imports = conn.execute("SELECT * FROM imports ORDER BY imported_at DESC, rowid DESC LIMIT 6").fetchall()
        recent_requirements = conn.execute(
            "SELECT * FROM requirements ORDER BY updated_at DESC, rowid DESC LIMIT 6"
        ).fetchall()
        stage_rows = conn.execute(
            "SELECT stage, COUNT(*) AS n FROM projects GROUP BY stage ORDER BY CASE stage WHEN '需求' THEN 0 WHEN '报价' THEN 1 WHEN '方案' THEN 2 WHEN '签约' THEN 3 WHEN '交付' THEN 4 ELSE 5 END"
        ).fetchall()
        product_metrics = sales.metrics(conn, days=7)
    return {
        "stats": {key: int(value or 0) for key, value in stats.items()},
        "recentImports": [row_to_import(row) for row in recent_imports],
        "recentRequirements": [
            {
                "id": row["id"],
                "customer": row["customer"],
                "project": row["project"] or "—",
                "title": row["title"],
                "priority": row["priority"] or "P1",
                "status": row["status"] or "待确认",
                "sourceType": row["source_type"] or "manual",
                "updatedAt": row["updated_at"] or "",
            }
            for row in recent_requirements
        ],
        "stageCounts": [{"stage": row["stage"] or "需求", "count": int(row["n"] or 0)} for row in stage_rows],
        "metrics": product_metrics,
    }


def list_customers() -> list[dict]:
    with db() as conn:
        profiles = {row["name"]: row for row in conn.execute("SELECT * FROM customers").fetchall()}
        stats = {
            row["customer"]: row
            for row in conn.execute(
                "SELECT customer, COUNT(*) AS record_count, MAX(imported_at) AS last_at FROM imports WHERE customer NOT IN ('待归档','') GROUP BY customer"
            ).fetchall()
        }
        names = set(profiles) | set(stats)
        result = []
        for name in names:
            profile = profiles.get(name)
            if profile is None:
                now = datetime.now().isoformat(timespec="seconds")
                conn.execute(
                    "INSERT INTO customers (name,company,position,phone,wechat,email,tags_json,source_channel,owner,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (name, _customer_default_company(name), "", "", "", "", "[]", "", "王总", "", now, now),
                )
                profile = conn.execute("SELECT * FROM customers WHERE name=?", (name,)).fetchone()
            stat = stats.get(name)
            project = "—"
            last_at = str(stat["last_at"]) if stat and stat["last_at"] else ""
            if stat:
                latest = conn.execute(
                    "SELECT project FROM imports WHERE customer=? ORDER BY imported_at DESC, rowid DESC LIMIT 1",
                    (name,),
                ).fetchone()
                project = str(latest["project"] if latest and latest["project"] else "—")
            result.append(_customer_row(profile, record_count=int(stat["record_count"]) if stat else 0, last_at=last_at, project=project))
    result.sort(key=lambda item: (-item["recordCount"], item["name"]))
    return result


def get_customer(name: str) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM customers WHERE name=?", (name,)).fetchone()
        if row is None:
            return None
        stat = conn.execute("SELECT COUNT(*) AS n, MAX(imported_at) AS last_at FROM imports WHERE customer=?", (name,)).fetchone()
        latest = conn.execute("SELECT project FROM imports WHERE customer=? ORDER BY imported_at DESC, rowid DESC LIMIT 1", (name,)).fetchone()
        return _customer_row(row, record_count=int(stat["n"] or 0), last_at=str(stat["last_at"] or ""), project=str(latest["project"] if latest and latest["project"] else "—"))


def update_customer(name: str, data: dict) -> dict | None:
    with db() as conn:
        existing = conn.execute("SELECT * FROM customers WHERE name=?", (name,)).fetchone()
        if existing is None:
            _ensure_customer(conn, name)
            existing = conn.execute("SELECT * FROM customers WHERE name=?", (name,)).fetchone()
        new_name = str(data.get("name") or name).strip()
        if not new_name:
            raise ValueError("客户姓名不能为空")
        if new_name != name:
            conflict = conn.execute("SELECT name FROM customers WHERE name=?", (new_name,)).fetchone()
            if conflict:
                raise ValueError("目标客户姓名已存在")
            conn.execute("UPDATE imports SET customer=? WHERE customer=?", (new_name, name))
            conn.execute("UPDATE chats SET customer=? WHERE customer=?", (new_name, name))
            conn.execute("UPDATE transcripts SET customer=? WHERE customer=?", (new_name, name))
            conn.execute("UPDATE requirements SET customer=? WHERE customer=?", (new_name, name))
            conn.execute("UPDATE projects SET customer=? WHERE customer=?", (new_name, name))
            conn.execute("UPDATE todos SET customer=? WHERE customer=?", (new_name, name))
            conn.execute("UPDATE customer_match_audits SET suggested_customer=? WHERE suggested_customer=?", (new_name, name))
            conn.execute("UPDATE customer_match_audits SET confirmed_customer=? WHERE confirmed_customer=?", (new_name, name))
            conn.execute("UPDATE customers SET name=? WHERE name=?", (new_name, name))
            name = new_name
        fields = {
            "company": data.get("company", existing["company"]),
            "position": data.get("position", existing["position"]),
            "phone": data.get("phone", existing["phone"]),
            "wechat": data.get("wechat", existing["wechat"]),
            "email": data.get("email", existing["email"]),
            "source_channel": data.get("sourceChannel", existing["source_channel"]),
            "owner": data.get("owner", existing["owner"]),
            "notes": data.get("notes", existing["notes"]),
        }
        tags = data.get("tags")
        tags_json = json.dumps(tags, ensure_ascii=False) if isinstance(tags, list) else (existing["tags_json"] or "[]")
        now = datetime.now().isoformat(timespec="seconds")
        conn.execute(
            "UPDATE customers SET company=?, position=?, phone=?, wechat=?, email=?, tags_json=?, source_channel=?, owner=?, notes=?, updated_at=? WHERE name=?",
            (
                str(fields["company"] or "—"), str(fields["position"] or ""), str(fields["phone"] or ""),
                str(fields["wechat"] or ""), str(fields["email"] or ""), tags_json,
                str(fields["source_channel"] or ""), str(fields["owner"] or ""), str(fields["notes"] or ""), now, name,
            ),
        )
        row = conn.execute("SELECT * FROM customers WHERE name=?", (name,)).fetchone()
    return get_customer(row["name"]) if row else None


def merge_customers(source: str, target: str) -> dict:
    source = source.strip()
    target = target.strip()
    if not source or not target or source == target:
        raise ValueError("源客户和目标客户不能相同")
    with db() as conn:
        source_row = conn.execute("SELECT * FROM customers WHERE name=?", (source,)).fetchone()
        target_row = conn.execute("SELECT * FROM customers WHERE name=?", (target,)).fetchone()
        if source_row is None:
            raise ValueError("源客户不存在")
        if target_row is None:
            _ensure_customer(conn, target, owner="王总")
            target_row = conn.execute("SELECT * FROM customers WHERE name=?", (target,)).fetchone()
        conn.execute("UPDATE imports SET customer=? WHERE customer=?", (target, source))
        conn.execute("UPDATE chats SET customer=? WHERE customer=?", (target, source))
        conn.execute("UPDATE transcripts SET customer=? WHERE customer=?", (target, source))
        conn.execute("UPDATE requirements SET customer=? WHERE customer=?", (target, source))
        conn.execute("UPDATE customer_match_audits SET suggested_customer=? WHERE suggested_customer=?", (target, source))
        conn.execute("UPDATE customer_match_audits SET confirmed_customer=? WHERE confirmed_customer=?", (target, source))
        for project in conn.execute("SELECT * FROM projects WHERE customer=?", (source,)).fetchall():
            conflict = conn.execute("SELECT id FROM projects WHERE customer=? AND name=?", (target, project["name"])).fetchone()
            if conflict:
                conn.execute("DELETE FROM projects WHERE id=?", (project["id"],))
            else:
                conn.execute("UPDATE projects SET customer=? WHERE id=?", (target, project["id"]))
        conn.execute("UPDATE todos SET customer=? WHERE customer=?", (target, source))
        # Fill target profile gaps from source, preserving explicit target values.
        for column in ("company", "position", "phone", "wechat", "email", "source_channel", "owner", "notes"):
            current = str(target_row[column] or "").strip()
            incoming = str(source_row[column] or "").strip()
            if (not current or current == "—") and incoming:
                conn.execute(f"UPDATE customers SET {column}=? WHERE name=?", (incoming, target))
        source_tags = json.loads(source_row["tags_json"] or "[]")
        target_tags = json.loads(target_row["tags_json"] or "[]")
        merged_tags = list(dict.fromkeys([*target_tags, *source_tags]))
        conn.execute("UPDATE customers SET tags_json=? WHERE name=?", (json.dumps(merged_tags, ensure_ascii=False), target))
        conn.execute("DELETE FROM customers WHERE name=?", (source,))
    return get_customer(target) or {"name": target}


def delete_customer(name: str) -> dict:
    with db() as conn:
        row = conn.execute("SELECT name FROM customers WHERE name=?", (name,)).fetchone()
        if row is None:
            raise ValueError("客户不存在")
        import_count = conn.execute("SELECT COUNT(*) AS n FROM imports WHERE customer=?", (name,)).fetchone()["n"]
        project_count = conn.execute("SELECT COUNT(*) AS n FROM projects WHERE customer=?", (name,)).fetchone()["n"]
        conn.execute("UPDATE tasks SET status='cancelled',error='客户已删除',updated_at=?,finished_at=? WHERE (import_id IN (SELECT id FROM imports WHERE customer=?) OR entity_id IN (SELECT id FROM chats WHERE customer=? UNION SELECT id FROM transcripts WHERE customer=?)) AND status IN ('queued','running')", (task_now(), task_now(), name, name, name))
        conn.execute("DELETE FROM customer_match_audits WHERE import_id IN (SELECT id FROM imports WHERE customer=?)", (name,))
        conn.execute("DELETE FROM imports WHERE customer=?", (name,))
        conn.execute("DELETE FROM corrections WHERE source_id IN (SELECT id FROM chats WHERE customer=?) OR source_id IN (SELECT id FROM transcripts WHERE customer=?)", (name, name))
        conn.execute("DELETE FROM chats WHERE customer=?", (name,))
        conn.execute("DELETE FROM transcripts WHERE customer=?", (name,))
        conn.execute("DELETE FROM requirements WHERE customer=?", (name,))
        conn.execute("DELETE FROM todos WHERE customer=?", (name,))
        conn.execute("DELETE FROM projects WHERE customer=?", (name,))
        conn.execute("DELETE FROM customers WHERE name=?", (name,))
    return {"deleted": name, "records": int(import_count), "projects": int(project_count)}


def _project_defaults(customer: str, name: str, owner: str = "王总") -> dict:
    defaults = {
        "stage": "需求",
        "budget": "—",
        "target_launch_date": "",
        "owner": owner or "王总",
        "description": "",
    }
    if customer == "张三" and name == "会员小程序商城":
        defaults.update({"budget": "8–10 万", "target_launch_date": "2026-11-30", "owner": "王总"})
    return defaults


def _ensure_project(conn: sqlite3.Connection, customer: str, name: str, owner: str = "王总") -> sqlite3.Row | None:
    name = str(name or "").strip()
    if not name or name == "—":
        return None
    row = conn.execute("SELECT * FROM projects WHERE customer=? AND name=?", (customer, name)).fetchone()
    if row is not None:
        return row
    now = datetime.now().isoformat(timespec="seconds")
    project_id = f"proj-{uuid.uuid4().hex[:10]}"
    defaults = _project_defaults(customer, name, owner)
    conn.execute(
        "INSERT INTO projects (id,customer,name,stage,budget,target_launch_date,owner,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (project_id, customer, name, defaults["stage"], defaults["budget"], defaults["target_launch_date"], defaults["owner"], defaults["description"], now, now),
    )
    return conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()


def _sync_projects_from_records(conn: sqlite3.Connection) -> None:
    """Materialize projects mentioned by imports/chats into the projects table.

    The customer 360 page derives project cards from imports, while the
    standalone project page reads the projects table. Without this sync a
    project created by an import/chat could appear under a customer but not in
    the project list until the customer detail page was opened.
    """
    rows = conn.execute(
        """
        SELECT customer, project, MAX(owner) AS owner FROM (
            SELECT i.customer AS customer, i.project AS project, c.owner AS owner
            FROM imports i LEFT JOIN customers c ON c.name = i.customer
            WHERE i.project IS NOT NULL AND i.project NOT IN ('', '—')
            UNION ALL
            SELECT ch.customer AS customer, ch.project AS project, c.owner AS owner
            FROM chats ch LEFT JOIN customers c ON c.name = ch.customer
            WHERE ch.project IS NOT NULL AND ch.project NOT IN ('', '—')
        )
        GROUP BY customer, project
        """
    ).fetchall()
    for row in rows:
        _ensure_project(conn, str(row["customer"]), str(row["project"]), str(row["owner"] or "王总"))


def _project_record(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "customer": row["customer"],
        "name": row["name"],
        "stage": row["stage"] or "需求",
        "budget": row["budget"] or "—",
        "targetLaunchDate": row["target_launch_date"] or "",
        "owner": row["owner"] or "",
        "description": row["description"] or "",
        "updatedAt": row["updated_at"] or "",
    }


def list_projects(customer: str) -> list[dict]:
    with db() as conn:
        _sync_projects_from_records(conn)
        rows = conn.execute("SELECT * FROM projects WHERE customer=? ORDER BY updated_at DESC, name ASC", (customer,)).fetchall()
        result = []
        for row in rows:
            records = conn.execute(
                "SELECT id,file_name,type,project,imported_at,status,transcript_id FROM imports WHERE customer=? AND project=? ORDER BY imported_at DESC, rowid DESC",
                (customer, row["name"]),
            ).fetchall()
            last_at = max((str(item["imported_at"] or "") for item in records), default="")
            counts = {"calls": 0, "chats": 0, "files": 0}
            record_items = []
            for item in records:
                kind = "chat" if item["type"] == "聊天记录" else "audio" if item["type"] == "音频" else "file"
                counts["calls" if kind == "audio" else "chats" if kind == "chat" else "files"] += 1
                record_items.append({
                    "id": item["id"],
                    "fileName": item["file_name"],
                    "type": item["type"],
                    "kind": kind,
                    "importedAt": item["imported_at"],
                    "status": item["status"],
                    "transcriptId": item["transcript_id"],
                })
            requirement_count = conn.execute(
                "SELECT COUNT(*) AS n FROM requirements WHERE customer=? AND project=?",
                (customer, row["name"]),
            ).fetchone()["n"]
            project = _project_record(row)
            project.update({"lastAt": last_at, "counts": counts, "records": record_items, "requirementCount": int(requirement_count or 0)})
            result.append(project)
    result.sort(key=lambda item: item["lastAt"] or "", reverse=True)
    return result


def list_all_projects() -> list[dict]:
    with db() as conn:
        _sync_projects_from_records(conn)
        rows = conn.execute(
            "SELECT p.*, c.company AS customer_company FROM projects p LEFT JOIN customers c ON c.name=p.customer ORDER BY p.updated_at DESC, p.name ASC"
        ).fetchall()
        result = []
        for row in rows:
            stats = conn.execute(
                "SELECT COUNT(*) AS n, MAX(imported_at) AS last_at FROM imports WHERE customer=? AND project=?",
                (row["customer"], row["name"]),
            ).fetchone()
            requirement_count = conn.execute(
                "SELECT COUNT(*) AS n FROM requirements WHERE customer=? AND project=?",
                (row["customer"], row["name"]),
            ).fetchone()["n"]
            project = _project_record(row)
            project.update({
                "customerCompany": row["customer_company"] or "—",
                "lastAt": str(stats["last_at"] or ""),
                "recordCount": int(stats["n"] or 0),
                "requirementCount": int(requirement_count or 0),
            })
            result.append(project)
    result.sort(key=lambda item: item["lastAt"] or "", reverse=True)
    return result


def create_project(customer: str, data: dict) -> dict | None:
    with db() as conn:
        _ensure_customer(conn, customer)
        name = str(data.get("name") or "").strip()
        if not name:
            raise ValueError("项目名称不能为空")
        existing = conn.execute("SELECT * FROM projects WHERE customer=? AND name=?", (customer, name)).fetchone()
        if existing:
            updated = conn.execute("SELECT * FROM projects WHERE id=?", (existing["id"],)).fetchone()
            return _project_record(updated)
        now = datetime.now().isoformat(timespec="seconds")
        project_id = f"proj-{uuid.uuid4().hex[:10]}"
        conn.execute(
            "INSERT INTO projects (id,customer,name,stage,budget,target_launch_date,owner,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (project_id, customer, name, str(data.get("stage") or "需求"), str(data.get("budget") or "—"), str(data.get("targetLaunchDate") or ""), str(data.get("owner") or "王总"), str(data.get("description") or ""), now, now),
        )
        row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    return _project_record(row)


def update_project(project_id: str, data: dict) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if row is None:
            return None
        new_name = str(data.get("name") or row["name"]).strip()
        if not new_name:
            raise ValueError("项目名称不能为空")
        if new_name != row["name"]:
            conflict = conn.execute("SELECT id FROM projects WHERE customer=? AND name=? AND id<>?", (row["customer"], new_name, project_id)).fetchone()
            if conflict:
                raise ValueError("该项目名称已存在")
            conn.execute("UPDATE imports SET project=? WHERE customer=? AND project=?", (new_name, row["customer"], row["name"]))
            conn.execute("UPDATE chats SET project=? WHERE customer=? AND project=?", (new_name, row["customer"], row["name"]))
            conn.execute("UPDATE transcripts SET project=? WHERE customer=? AND project=?", (new_name, row["customer"], row["name"]))
            conn.execute("UPDATE requirements SET project=? WHERE customer=? AND project=?", (new_name, row["customer"], row["name"]))
            conn.execute("UPDATE todos SET project=? WHERE customer=? AND project=?", (new_name, row["customer"], row["name"]))
        now = datetime.now().isoformat(timespec="seconds")
        target_launch = data.get("targetLaunchDate", row["target_launch_date"])
        description = data.get("description", row["description"])
        conn.execute(
            "UPDATE projects SET name=?, stage=?, budget=?, target_launch_date=?, owner=?, description=?, updated_at=? WHERE id=?",
            (
                new_name,
                str(data.get("stage") or row["stage"] or "需求"),
                str(data.get("budget") or row["budget"] or "—"),
                str(target_launch or ""),
                str(data.get("owner") or row["owner"] or ""),
                str(description or ""),
                now,
                project_id,
            ),
        )
        updated = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    return _project_record(updated)


def delete_project(project_id: str) -> dict:
    with db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if row is None:
            raise ValueError("项目不存在")
        conn.execute("UPDATE imports SET project='—' WHERE customer=? AND project=?", (row["customer"], row["name"]))
        conn.execute("UPDATE chats SET project='—' WHERE customer=? AND project=?", (row["customer"], row["name"]))
        conn.execute("UPDATE transcripts SET project='—' WHERE customer=? AND project=?", (row["customer"], row["name"]))
        conn.execute("UPDATE requirements SET project='—' WHERE customer=? AND project=?", (row["customer"], row["name"]))
        conn.execute("UPDATE todos SET project='—' WHERE customer=? AND project=?", (row["customer"], row["name"]))
        conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
    return {"deleted": project_id}


_REQUIREMENT_PRIORITIES = ("P0", "P1", "P2")
_REQUIREMENT_STATUSES = ("待确认", "已确认", "已报价", "已实现")


def _normalize_priority(value: Any) -> str:
    text = str(value or "").strip().upper()
    return text if text in _REQUIREMENT_PRIORITIES else "P1"


def _normalize_status(value: Any) -> str:
    text = str(value or "").strip()
    return text if text in _REQUIREMENT_STATUSES else "待确认"


def _requirement_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "customer": row["customer"],
        "project": row["project"] or "—",
        "title": row["title"],
        "description": row["description"] or "",
        "priority": row["priority"] or "P1",
        "status": row["status"] or "待确认",
        "sourceType": row["source_type"] or "manual",
        "sourceId": row["source_id"] or "",
        "sourceTime": row["source_time"] or "",
        "sourceQuote": row["source_quote"] or "",
        "owner": row["owner"] or "",
        "dueDate": row["due_date"] or "",
        "createdAt": row["created_at"] or "",
        "updatedAt": row["updated_at"] or "",
    }


def _add_requirement(
    conn: sqlite3.Connection,
    *,
    customer: str,
    project: str,
    title: str,
    description: str = "",
    priority: str = "P1",
    status: str = "待确认",
    source_type: str = "manual",
    source_id: str = "",
    source_time: str = "",
    source_quote: str = "",
    owner: str = "",
    due_date: str = "",
) -> sqlite3.Row | None:
    title = str(title or "").strip()
    if not title:
        return None
    existing = conn.execute(
        "SELECT * FROM requirements WHERE customer=? AND project=? AND title=?",
        (customer, project or "—", title),
    ).fetchone()
    if existing:
        return existing
    now = datetime.now().isoformat(timespec="seconds")
    requirement_id = f"req-{uuid.uuid4().hex[:10]}"
    conn.execute(
        "INSERT INTO requirements (id,customer,project,title,description,priority,status,source_type,source_id,source_time,source_quote,created_at,updated_at,owner,due_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            requirement_id, customer, project or "—", title, description or "",
            _normalize_priority(priority), _normalize_status(status),
            source_type or "manual", source_id or "", source_time or "", source_quote or "", now, now, owner, sales.due_date(due_date),
        ),
    )
    return conn.execute("SELECT * FROM requirements WHERE id=?", (requirement_id,)).fetchone()


def insert_requirements_from_audio(import_id: str, customer: str, project: str, summary: dict, source_time: str = "", source_type: str = "audio") -> None:
    needs = str(summary.get("needs") or "").strip()
    evidence = summary.get("evidence") if isinstance(summary.get("evidence"), dict) else {}
    if not needs or needs in ("未提及", "—", "无") or not str(evidence.get("needs") or "").strip() or float(summary.get("confidence") or 0) < 0.6:
        return
    titles = [part.strip() for part in re.split(r"[；;。、，,]", needs) if len(part.strip()) >= 2][:8]
    if not titles:
        return
    with db() as conn:
        for title in titles:
            _add_requirement(
                conn,
                customer=customer,
                project=project or "—",
                title=title,
                description=f"来自{'通话摘要' if source_type == 'audio' else '邮件' if source_type == 'email' else '文件'}：{needs}",
                priority="P1",
                status="待确认",
                source_type=source_type,
                source_id=import_id,
                source_time=source_time,
                source_quote=needs,
            )


def insert_requirements_from_chat(chat_id: str, customer: str, project: str, analysis: dict, source_time: str = "") -> None:
    items = analysis.get("requirements") or []
    if not isinstance(items, list):
        return
    with db() as conn:
        for item in items:
            if not isinstance(item, dict):
                continue
            if item.get("evidenceVerified") is not True:
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            _add_requirement(
                conn,
                customer=customer,
                project=project or "—",
                title=title,
                description=str(item.get("description") or ""),
                priority=item.get("priority") or "P1",
                status=item.get("status") or "待确认",
                source_type="chat",
                source_id=chat_id,
                source_time=item.get("time") or source_time,
                source_quote=str(item.get("evidence") or ""),
            )


def list_requirements(customer: str, project: str = "") -> list[dict]:
    with db() as conn:
        if project:
            rows = conn.execute(
                "SELECT * FROM requirements WHERE customer=? AND project=? ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, updated_at DESC",
                (customer, project),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM requirements WHERE customer=? ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, updated_at DESC",
                (customer,),
            ).fetchall()
    return [_requirement_row(row) for row in rows]


def create_requirement(customer: str, data: dict) -> dict | None:
    with db() as conn:
        _ensure_customer(conn, customer)
        _ensure_project(conn, customer, str(data.get("project") or "—"))
        row = _add_requirement(
            conn,
            customer=customer,
            project=str(data.get("project") or "—"),
            title=str(data.get("title") or ""),
            description=str(data.get("description") or ""),
            priority=data.get("priority") or "P1",
            status=data.get("status") or "待确认",
            source_type=str(data.get("sourceType") or "manual"),
            source_id=str(data.get("sourceId") or ""),
            source_time=str(data.get("sourceTime") or datetime.now().strftime("%Y-%m-%d %H:%M")),
            source_quote=str(data.get("sourceQuote") or ""),
            owner=str(data.get("owner") or ""),
            due_date=str(data.get("dueDate") or ""),
        )
    return _requirement_row(row) if row else None


def update_requirement(requirement_id: str, data: dict) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM requirements WHERE id=?", (requirement_id,)).fetchone()
        if row is None:
            return None
        title = str(data.get("title", row["title"]) or "").strip()
        if not title:
            raise ValueError("需求标题不能为空")
        project = str(data.get("project", row["project"]) or "—")
        _ensure_project(conn, row["customer"], project)
        conn.execute(
            "UPDATE requirements SET project=?, title=?, description=?, priority=?, status=?, source_time=?, source_quote=?, owner=?, due_date=?, updated_at=? WHERE id=?",
            (
                project, title, str(data.get("description", row["description"]) or ""),
                _normalize_priority(data.get("priority", row["priority"])),
                _normalize_status(data.get("status", row["status"])),
                str(data.get("sourceTime", row["source_time"]) or ""),
                str(data.get("sourceQuote", row["source_quote"]) or ""),
                str(data.get("owner", row["owner"]) or ""),
                sales.due_date(data.get("dueDate", row["due_date"])),
                datetime.now().isoformat(timespec="seconds"), requirement_id,
            ),
        )
        updated = conn.execute("SELECT * FROM requirements WHERE id=?", (requirement_id,)).fetchone()
        conn.execute("UPDATE todos SET project=?,owner=CASE WHEN ? AND ?<>'' THEN ? ELSE owner END,due_date=CASE WHEN ? AND ?<>'' THEN ? ELSE due_date END WHERE requirement_id=?",
                     (project, updated["owner"] != row["owner"], updated["owner"], updated["owner"],
                      updated["due_date"] != row["due_date"], updated["due_date"], updated["due_date"], requirement_id))
    return _requirement_row(updated)


def delete_requirement(requirement_id: str) -> dict:
    with db() as conn:
        row = conn.execute("SELECT * FROM requirements WHERE id=?", (requirement_id,)).fetchone()
        if row is None:
            raise ValueError("需求不存在")
        conn.execute("DELETE FROM requirements WHERE id=?", (requirement_id,))
        conn.execute("UPDATE todos SET requirement_id='' WHERE requirement_id=?", (requirement_id,))
    return {"deleted": requirement_id}


def merge_requirements(target_id: str, source_ids: list[str]) -> dict | None:
    with db() as conn:
        target = conn.execute("SELECT * FROM requirements WHERE id=?", (target_id,)).fetchone()
        if target is None:
            return None
        sources = [
            conn.execute("SELECT * FROM requirements WHERE id=?", (source_id,)).fetchone()
            for source_id in source_ids if source_id != target_id
        ]
        sources = [row for row in sources if row is not None]
        if any(row["customer"] != target["customer"] or row["project"] != target["project"] for row in sources):
            raise ValueError("只能合并同一客户、同一项目的需求")
        descriptions = list(dict.fromkeys([str(target["description"] or ""), *[str(row["description"] or "") for row in sources]]))
        quotes = list(dict.fromkeys([str(target["source_quote"] or ""), *[str(row["source_quote"] or "") for row in sources]]))
        priorities = [str(target["priority"] or "P1"), *[str(row["priority"] or "P1") for row in sources]]
        best_priority = min(priorities, key=lambda item: _REQUIREMENT_PRIORITIES.index(item) if item in _REQUIREMENT_PRIORITIES else 9)
        conn.execute(
            "UPDATE requirements SET description=?, priority=?, source_quote=?, updated_at=? WHERE id=?",
            ("\n\n".join([item for item in descriptions if item]), best_priority, "\n\n".join([item for item in quotes if item]), datetime.now().isoformat(timespec="seconds"), target_id),
        )
        for source in sources:
            conn.execute("UPDATE todos SET requirement_id=? WHERE requirement_id=?", (target_id, source["id"]))
            conn.execute("DELETE FROM requirements WHERE id=?", (source["id"],))
        updated = conn.execute("SELECT * FROM requirements WHERE id=?", (target_id,)).fetchone()
    return _requirement_row(updated)


def backfill_requirements() -> None:
    """Populate requirements for records created before the requirement table existed."""
    with db() as conn:
        if conn.execute("SELECT COUNT(*) AS n FROM requirements").fetchone()["n"] > 0:
            return
        transcripts = conn.execute("SELECT * FROM transcripts").fetchall()
        chats = conn.execute("SELECT * FROM chats WHERE status='done'").fetchall()
    for transcript in transcripts:
        try:
            summary = json.loads(transcript["summary_json"] or "{}")
            insert_requirements_from_audio(
                transcript["id"],
                str(transcript["customer"]),
                str(transcript["project"] or "—"),
                summary,
                source_time=str(transcript["imported_at"] or ""),
            )
        except Exception:
            pass
    for chat in chats:
        try:
            insert_requirements_from_chat(
                chat["id"],
                str(chat["customer"]),
                str(chat["project"] or "—"),
                json.loads(chat["analysis_json"] or "{}"),
                source_time=str(chat["imported_at"] or ""),
            )
        except Exception:
            pass


def customer_timeline(customer_name: str) -> dict:
    with db() as conn:
        imports = conn.execute(
            "SELECT * FROM imports WHERE customer=? ORDER BY imported_at DESC, rowid DESC",
            (customer_name,),
        ).fetchall()
        entries = []
        for row in imports:
            entry = {
                "id": row["id"],
                "fileName": row["file_name"],
                "type": row["type"],
                "project": row["project"],
                "importedAt": row["imported_at"],
                "status": row["status"],
                "transcriptId": row["transcript_id"],
                "kind": "file",
                "title": row["file_name"],
                "summary": "",
                "messageCount": 0,
                "duration": 0,
                "attachments": [],
            }
            if row["type"] == "聊天记录":
                entry["kind"] = "chat"
                if str(row["transcript_id"] or "").startswith("chat-"):
                    chat = conn.execute("SELECT * FROM chats WHERE id=?", (row["transcript_id"],)).fetchone()
                    if chat:
                        analysis = json.loads(chat["analysis_json"] or "{}")
                        entry.update({
                            "title": chat["title"],
                            "summary": analysis.get("summary", ""),
                            "messageCount": chat["message_count"],
                            "attachments": json.loads(chat["attachments_json"] or "[]"),
                        })
                else:
                    entry["title"] = f"微信聊天 · {customer_name}"
                    entry["summary"] = "聊天记录已归档"
            elif row["transcript_id"]:
                transcript = conn.execute("SELECT * FROM transcripts WHERE id=?", (row["transcript_id"],)).fetchone()
                if transcript:
                    summary = json.loads(transcript["summary_json"] or "{}")
                    entry.update({
                        "kind": "audio",
                        "title": transcript["title"],
                        "summary": summary.get("oneLine", ""),
                        "duration": transcript["duration"],
                    })
            entries.append(entry)
    return {"customer": customer_name, "records": entries}


def update_chat_participants(chat_id: str, participants: list[dict]) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
        if row is None:
            return None
        existing = json.loads(row["participants_json"])
        allowed_names = {p["name"] for p in existing}
        normalized = []
        for item in participants:
            if not isinstance(item, dict):
                return None
            name = str(item.get("name") or "").strip()
            role = str(item.get("role") or "").strip()
            if name not in allowed_names or role not in ("me", "customer"):
                continue
            normalized.append({"name": name, "role": role})
        if len(normalized) != len(existing) or {p["name"] for p in normalized} != allowed_names or not any(p["role"] == "me" for p in normalized) or not any(p["role"] == "customer" for p in normalized):
            return None
        analysis = json.loads(row["analysis_json"] or "{}")
        role_map = {p["name"]: ("我" if p["role"] == "me" else "客户") for p in normalized}
        if isinstance(analysis.get("participants"), list):
            for participant in analysis["participants"]:
                if participant.get("name") in role_map:
                    participant["role"] = role_map[participant["name"]]
        customer_name = row["customer"] if len(normalized) > 2 and row["customer"] in {p["name"] for p in normalized if p["role"] == "customer"} else next((p["name"] for p in normalized if p["role"] == "customer"), row["customer"])
        _ensure_customer(conn, customer_name)
        if customer_name != row["customer"]:
            _ensure_project(conn, customer_name, row["project"])
            for table in ("requirements", "todos"):
                linked = "source_id=? OR source_id IN (SELECT id FROM imports WHERE transcript_id=?)"
                for project in conn.execute(f"SELECT DISTINCT project FROM {table} WHERE {linked}", (chat_id, chat_id)).fetchall():
                    _ensure_project(conn, customer_name, project["project"])
                conn.execute(f"UPDATE {table} SET customer=? WHERE {linked}", (customer_name, chat_id, chat_id))
        conn.execute(
            "UPDATE chats SET participants_json=?, analysis_json=?, customer=? WHERE id=?",
            (json.dumps(normalized, ensure_ascii=False), json.dumps(analysis, ensure_ascii=False), customer_name, chat_id),
        )
        record_correction(conn, chat_id, "participants", json.dumps(existing, ensure_ascii=False), json.dumps(normalized, ensure_ascii=False))
        conn.execute("UPDATE imports SET customer=? WHERE transcript_id=?", (customer_name, chat_id))
        updated = conn.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
    return row_to_chat(updated)


def _secure_key_path() -> Path:
    return DATA_DIR / "llm-api-key.dpapi"


def _dpapi_protect(value: str) -> bytes:
    if os.name != "nt":
        raise RuntimeError("Windows DPAPI is unavailable")

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

    raw = value.encode("utf-8")
    source = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
    data_in = Blob(len(raw), ctypes.cast(source, ctypes.POINTER(ctypes.c_ubyte)))
    data_out = Blob()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    if not crypt32.CryptProtectData(ctypes.byref(data_in), None, None, None, None, 0, ctypes.byref(data_out)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(data_out.pbData, data_out.cbData)
    finally:
        kernel32.LocalFree(data_out.pbData)


def _dpapi_unprotect(value: bytes) -> str:
    if os.name != "nt":
        raise RuntimeError("Windows DPAPI is unavailable")

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

    source = (ctypes.c_ubyte * len(value)).from_buffer_copy(value)
    data_in = Blob(len(value), ctypes.cast(source, ctypes.POINTER(ctypes.c_ubyte)))
    data_out = Blob()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    if not crypt32.CryptUnprotectData(ctypes.byref(data_in), None, None, None, None, 0, ctypes.byref(data_out)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(data_out.pbData, data_out.cbData).decode("utf-8")
    finally:
        kernel32.LocalFree(data_out.pbData)


def _read_secure_api_key() -> str:
    path = _secure_key_path()
    if os.name != "nt" or not path.exists():
        return ""
    try:
        return _dpapi_unprotect(path.read_bytes()).strip()
    except Exception:
        return ""


def _write_secure_api_key(value: str) -> bool:
    if os.name != "nt":
        return False
    path = _secure_key_path()
    path.write_bytes(_dpapi_protect(value))
    return True


def _delete_plaintext_api_key() -> None:
    with db() as conn:
        conn.execute("DELETE FROM settings WHERE key='llm.api_key'")


def _delete_secure_api_key() -> None:
    try:
        _secure_key_path().unlink(missing_ok=True)
    except OSError:
        pass


def _llm_setting_rows() -> dict[str, str]:
    with db() as conn:
        return {
            str(row["key"]): str(row["value"] or "")
            for row in conn.execute("SELECT key,value FROM settings WHERE key LIKE 'llm.%'").fetchall()
        }


def get_llm_config() -> dict:
    rows = _llm_setting_rows()
    plaintext_key = rows.get("llm.api_key", "").strip()
    secure_key = _read_secure_api_key()
    if plaintext_key and os.name == "nt":
        try:
            _write_secure_api_key(plaintext_key)
            _delete_plaintext_api_key()
            secure_key = plaintext_key
        except Exception:
            # Keep compatibility if DPAPI is unavailable in a restricted host.
            secure_key = plaintext_key

    def pick(key: str, default: str) -> str:
        value = rows.get(key, "").strip()
        return value or default

    return {
        "baseUrl": pick("llm.base_url", MAAS_BASE_URL).rstrip("/"),
        "apiKey": secure_key or plaintext_key or MAAS_API_KEY,
        "asrModel": pick("llm.asr_model", MAAS_ASR_MODEL),
        "summaryModel": pick("llm.summary_model", MAAS_SUMMARY_MODEL),
        "visionModel": pick("llm.vision_model", MAAS_VISION_MODEL),
    }


def _mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return key[:2] + "****" + key[-2:]
    return key[:4] + "****" + key[-4:]


def save_llm_config(data: dict) -> dict:
    updates = {
        "llm.base_url": str(data.get("baseUrl") or MAAS_BASE_URL).strip().rstrip("/"),
        "llm.api_key": str(data.get("apiKey") or "").strip(),
        "llm.asr_model": str(data.get("asrModel") or MAAS_ASR_MODEL).strip(),
        "llm.summary_model": str(data.get("summaryModel") or MAAS_SUMMARY_MODEL).strip(),
        "llm.vision_model": str(data.get("visionModel") or MAAS_VISION_MODEL).strip(),
    }
    # Do not wipe an existing key when the UI leaves the password field blank.
    if not updates["llm.api_key"]:
        updates.pop("llm.api_key")
    api_key = updates.pop("llm.api_key", "")
    with db() as conn:
        for key, value in updates.items():
            conn.execute(
                "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
    if data.get("clearApiKey") is True:
        _delete_secure_api_key()
        _delete_plaintext_api_key()
    elif api_key:
        if not _write_secure_api_key(api_key):
            with db() as conn:
                conn.execute(
                    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    ("llm.api_key", api_key),
                )
        else:
            _delete_plaintext_api_key()
    return get_llm_config()


APP_SETTING_DEFAULTS = {
    "defaultProject": "",
    "defaultOwner": "王总",
    "autoMatch": True,
    "autoProcess": True,
    "autoUpdate": True,
    "updateIntervalHours": 3,
    "systemNotifications": True,
    "quietStart": "22:00",
    "quietEnd": "08:00",
}


PROFILE_DEFAULTS = {"name": "王总", "role": "产品负责人", "company": "", "phone": "", "email": ""}


def get_profile() -> dict:
    with db() as conn:
        rows = conn.execute("SELECT key,value FROM settings WHERE key LIKE 'profile.%'").fetchall()
    saved = {row["key"].removeprefix("profile."): row["value"] for row in rows}
    return {key: saved.get(key, value) for key, value in PROFILE_DEFAULTS.items()}


def save_profile(data: dict) -> dict:
    updates = {}
    for key in PROFILE_DEFAULTS:
        if key not in data:
            continue
        if not isinstance(data[key], str) or len(data[key]) > 120:
            raise ValueError("个人信息须为 120 字以内的文本")
        value = data[key].strip()
        if key == "name" and not value:
            raise ValueError("姓名不能为空")
        updates[f"profile.{key}"] = value
    with db() as conn:
        conn.executemany("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", updates.items())
    return get_profile()


def get_app_settings() -> dict:
    with db() as conn:
        rows = {
            str(row["key"]): str(row["value"] or "")
            for row in conn.execute("SELECT key,value FROM settings WHERE key LIKE 'app.%'").fetchall()
        }
    result = dict(APP_SETTING_DEFAULTS)
    for key in result:
        if f"app.{key}" not in rows:
            continue
        raw = rows[f"app.{key}"]
        if key in ("autoMatch", "autoProcess", "autoUpdate", "systemNotifications"):
            result[key] = raw.lower() == "true"
        elif key == "updateIntervalHours":
            try:
                result[key] = max(1, int(raw))
            except ValueError:
                pass
        else:
            result[key] = raw
    return result


def save_app_settings(data: dict) -> dict:
    updates = {}
    for key in APP_SETTING_DEFAULTS:
        if key not in data:
            continue
        value = data[key]
        if key in ("quietStart", "quietEnd"):
            if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
                raise ValueError("免打扰时间须使用 HH:MM 格式")
            updates[f"app.{key}"] = value
        elif key in ("autoMatch", "autoProcess", "autoUpdate", "systemNotifications"):
            if not isinstance(value, bool):
                raise ValueError("开关设置须为布尔值")
            updates[f"app.{key}"] = "true" if value else "false"
        elif key == "updateIntervalHours":
            try:
                updates[f"app.{key}"] = str(max(1, int(value)))
            except (TypeError, ValueError):
                pass
        else:
            updates[f"app.{key}"] = str(value or "")
    with db() as conn:
        for key, value in updates.items():
            conn.execute(
                "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
    return get_app_settings()


def get_diagnostics() -> dict:
    config = get_llm_config()
    try:
        database_size = DB_PATH.stat().st_size
    except OSError:
        database_size = 0
    try:
        wechat_backend = str(wechat_engine._find_backend() or "")
    except Exception:
        wechat_backend = os.getenv("WECHAT_DATA_ANALYSIS_BACKEND", "").strip()
    ffmpeg_path = FFMPEG or ""
    return {
        "status": "ok",
        "service": "clienthub-ai-sidecar",
        "host": "127.0.0.1",
        "port": 8765,
        "version": os.getenv("CLIENTHUB_APP_VERSION", "0.2.7"),
        "apiRevision": 5,
        "mode": "maas" if config["apiKey"] else "mock",
        "dataDir": str(DATA_DIR),
        "databaseSize": database_size,
        "backups": len(list(BACKUP_DIR.glob("clienthub-backup-*.zip"))),
        "apiKeyStorage": "Windows DPAPI" if os.name == "nt" else "本地配置回退",
        "ffmpeg": {"available": bool(ffmpeg_path and Path(ffmpeg_path).exists()), "path": ffmpeg_path},
        "wechatEngine": {"available": bool(wechat_backend and Path(wechat_backend).exists()), "path": wechat_backend},
    }


def _llm_request(method: str, url: str, *, api_key: str = "", payload: dict | None = None, timeout: int = 60) -> tuple[int, str]:
    """Send one request and always read the body before the response is closed.

    urllib closes the response when the ``with`` block exits, so returning the
    response object from inside the block makes the caller read an empty body.
    Read the raw text here instead and return it together with the HTTP status.
    """
    headers = {"Accept": "application/json", "User-Agent": "ClientHub/0.2.4"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status = int(getattr(response, "status", 200) or 200)
            return status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return int(exc.code), exc.read().decode("utf-8", "replace")


def _parse_llm_models(raw: str) -> list[str]:
    body = json.loads(raw)
    if isinstance(body, dict):
        items = body.get("data") or body.get("models") or []
    elif isinstance(body, list):
        items = body
    else:
        items = []
    models: list[str] = []
    for item in items:
        if isinstance(item, dict):
            model_id = str(item.get("id") or item.get("model") or item.get("name") or "").strip()
        elif isinstance(item, str):
            model_id = item.strip()
        else:
            model_id = ""
        if model_id:
            models.append(model_id)
    return list(dict.fromkeys(models))


def _llm_target(data: dict | None) -> tuple[str, str]:
    config = get_llm_config()
    base_url = config["baseUrl"]
    api_key = config["apiKey"]
    if isinstance(data, dict):
        base_url = str(data.get("baseUrl") or base_url).strip().rstrip("/")
        api_key = str(data.get("apiKey") or api_key).strip()
    return base_url, api_key


def list_llm_models(data: dict | None = None) -> dict:
    base_url, api_key = _llm_target(data)
    if not base_url:
        return {"status": "error", "error": "请先填写 Base URL", "models": []}
    url = f"{base_url}/models"
    try:
        status, raw = _llm_request("GET", url, api_key=api_key, timeout=30)
    except Exception as exc:
        return {"status": "error", "error": f"无法连接模型接口：{exc}", "models": []}
    if status >= 400:
        return {"status": "error", "error": f"HTTP {status}: {raw[:300]}", "models": []}
    if not raw.strip():
        return {
            "status": "error",
            "error": f"模型接口返回空响应（HTTP {status}）。请确认 Base URL 是否正确，例如以 /compatible-mode/v1 结尾。",
            "models": [],
        }
    try:
        models = _parse_llm_models(raw)
    except json.JSONDecodeError:
        return {"status": "error", "error": f"模型接口返回的不是 JSON（HTTP {status}）：{raw[:200]}", "models": []}
    if not models:
        return {"status": "error", "error": f"模型接口返回成功但未包含模型列表（HTTP {status}）：{raw[:200]}", "models": []}
    return {"status": "ok", "count": len(models), "models": models}


def test_llm_config(data: dict | None = None) -> dict:
    base_url, api_key = _llm_target(data)
    if not base_url:
        return {"status": "error", "error": "请填写聚合大模型 Base URL"}
    if not api_key:
        return {"status": "error", "error": "请填写聚合大模型 API Key"}
    config = get_llm_config()
    model = str((data or {}).get("summaryModel") or config["summaryModel"]).strip()
    if not model:
        return {"status": "error", "error": "请先填写文本/总结模型名称"}
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 8,
        "temperature": 0,
    }
    try:
        status, raw = _llm_request(
            "POST", base_url + "/chat/completions", api_key=api_key, payload=payload, timeout=60
        )
    except Exception as exc:
        return {"status": "error", "error": f"无法连接对话接口：{exc}", "models": []}

    if status >= 400:
        return {"status": "error", "error": f"HTTP {status}: {raw[:500]}", "models": []}

    if not raw.strip():
        # Some aggregators occasionally return an empty 200 for chat/completions
        # while /models is healthy. Fall back to the model list so "测试连接"
        # still gives a usable result instead of a JSONDecodeError.
        try:
            models_status, models_raw = _llm_request("GET", f"{base_url}/models", api_key=api_key, timeout=30)
            models = _parse_llm_models(models_raw) if models_status < 400 and models_raw.strip() else []
        except Exception:
            models = []
        if models:
            return {
                "status": "ok",
                "count": len(models),
                "models": models,
                "message": f"连接成功（对话接口返回空响应，模型列表可用，共 {len(models)} 个模型）",
            }
        return {"status": "error", "error": "对话接口返回空响应（HTTP 200），请检查 Base URL 与模型名称", "models": []}

    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        return {"status": "error", "error": f"对话接口返回的不是 JSON（HTTP {status}）：{raw[:300]}", "models": []}

    if isinstance(body, dict) and body.get("choices"):
        return {"status": "ok", "count": 1, "models": [model], "message": "连接成功"}
    error = body.get("error") if isinstance(body, dict) else None
    if error:
        message = error.get("message") if isinstance(error, dict) else str(error)
        return {"status": "error", "error": f"模型接口报错：{message}", "models": []}
    return {"status": "error", "error": f"模型返回异常：{str(body)[:300]}", "models": []}


def maas_request(path: str, payload: dict, timeout: int = 600, config: dict | None = None) -> dict:
    config = config or get_llm_config()
    if not config["apiKey"]:
        raise RuntimeError("聚合大模型 API Key 未配置，请到设置页配置")
    req = urllib.request.Request(
        config["baseUrl"] + path,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {config['apiKey']}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"MAAS HTTP {exc.code}: {body[:500]}") from exc


def transcribe_audio(audio_bytes: bytes, mime_type: str, config: dict | None = None) -> str:
    """Call qwen3-asr-flash for one short audio chunk."""
    data_uri = f"data:{mime_type or 'audio/mpeg'};base64,{base64.b64encode(audio_bytes).decode()}"
    config = config or get_llm_config()
    payload = {
        "model": config["asrModel"],
        "messages": [{"role": "user", "content": [{"type": "input_audio", "input_audio": {"data": data_uri}}]}],
        "stream": False,
        "asr_options": {"language": "zh", "enable_itn": False},
    }
    result = maas_request("/chat/completions", payload, timeout=600, config=config)
    choices = result.get("choices") or []
    if not choices:
        raise RuntimeError(f"ASR returned no choices: {result}")
    return str(choices[0].get("message", {}).get("content") or "").strip()


def transcribe_audio_file(path: Path, mime_type: str = "audio/mpeg", progress_cb=None,
                          task_id: str | None = None, chunks_out: list | None = None) -> str:
    config = get_llm_config()
    chunks = audio_pipeline.transcribe(
        path, ffmpeg=FFMPEG, cache_dir=DATA_DIR / "asr-cache",
        cache_key=config["baseUrl"] + "|" + config["asrModel"],
        recognize=lambda data: transcribe_audio(data, "audio/mpeg", config),
        check_active=lambda: ensure_task_active(task_id), progress=progress_cb,
    )
    if chunks_out is not None:
        chunks_out.extend(chunks)
    return "\n".join(chunk["text"] for chunk in chunks)


def summarize_transcript(transcript: str) -> dict:
    prompt = f"""你是客户沟通纪要助手。请只根据下面的通话转写输出 JSON，不要输出 Markdown。
要求：
1. 不得编造转写中没有的信息；没有提到的字段填“未提及”。
2. 输出严格 JSON，字段固定。
3. 每个非空字段在 evidence 中提供一句转写原文；不要猜测可信概率。
4. 字段格式：
{{
  "oneLine": "",
  "needs": "",
  "budget": "",
  "timeline": "",
  "decisionMakers": "",
  "objections": "",
  "nextActions": "",
  "paymentMethod": "",
  "evidence": {{"needs": "原文", "budget": "原文", "timeline": "原文", "decisionMakers": "原文", "objections": "原文", "nextActions": "原文", "paymentMethod": "原文"}}
}}
转写：
        {transcript if len(transcript) <= 12000 else transcript[:6000] + "\n[中间内容略]" + transcript[-6000:]}"""
    payload = {
        "model": get_llm_config()["summaryModel"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 2200,
        "response_format": {"type": "json_object"},
    }
    result = maas_request("/chat/completions", payload, timeout=600)
    content = str(result.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content).strip()
    data = json.loads(content)
    defaults = {
        "oneLine": "未提及", "needs": "未提及", "budget": "未提及", "timeline": "未提及",
        "decisionMakers": "未提及", "objections": "未提及", "nextActions": "未提及", "paymentMethod": "未提及",
    }
    if not isinstance(data, dict) or any(key in data and not isinstance(data[key], str) for key in defaults):
        raise ValueError("摘要结果格式不正确，请重试")
    for key, value in defaults.items():
        if not data.get(key):
            data[key] = value
    evidence = data.get("evidence") if isinstance(data.get("evidence"), dict) else {}
    checked = [key for key in defaults if key != "oneLine" and data[key] != "未提及"]
    verified = {key: quote for key in checked if isinstance((quote := evidence.get(key)), str) and quote.strip() and quote.strip() in transcript}
    data["evidence"] = verified
    data["evidenceCount"] = len(verified)
    data["confidence"] = round(len(verified) / len(checked), 2) if checked else 0
    return data


def process_document(import_id: str, path: Path, task_id: str | None = None) -> None:
    try:
        ensure_task_active(task_id)
        set_task_progress(task_id, 15)
        text, attachments = document_ingest.extract(path, check_active=lambda: ensure_task_active(task_id),
            progress=lambda done, total: set_task_progress(task_id, 15 + int(35 * done / max(1, total))))
        if not text.strip():
            raise ValueError("文档未提取到可读内容")
        ensure_task_active(task_id)
        set_task_progress(task_id, 55)
        summary = summarize_transcript(text) if get_llm_config()["apiKey"] else {
            "oneLine": "已提取原文，配置模型后可生成摘要", "needs": "未提及", "budget": "未提及", "timeline": "未提及",
            "decisionMakers": "未提及", "objections": "未提及", "nextActions": "未提及", "paymentMethod": "未提及",
            "confidence": 0, "evidenceCount": 0, "evidence": {},
        }
        ensure_task_active(task_id)
        with db() as conn:
            row = conn.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
            if row is None:
                return
            transcript_id = f"tr-{import_id}"
            segments = [{"id": f"p{index + 1}", "start": index, "end": index + 1, "speaker": "unknown", "text": text[index * 2000:(index + 1) * 2000]} for index in range((len(text) + 1999) // 2000)]
            source_kind = "image" if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"} else "file"
            saved_attachments = [{"id": f"{import_id}-source", "name": row["file_name"], "kind": source_kind, "storedName": path.name, "label": "原始文件"}]
            for index, (name, content) in enumerate(attachments):
                stored_name = f"{import_id}-attachment-{index}{Path(name).suffix.lower()[:12]}"
                (UPLOAD_DIR / stored_name).write_bytes(content)
                mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
                kind = "voice" if mime.startswith("audio/") else "image" if mime.startswith("image/") else "video" if mime.startswith("video/") else "file"
                saved_attachments.append({"id": f"{import_id}-attachment-{index}", "name": name, "kind": kind, "storedName": stored_name})
            conn.execute("INSERT OR REPLACE INTO transcripts (id,title,file_name,file_size,duration,imported_at,customer,company,project,source,segments_json,summary_json,attachments_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                         (transcript_id, row["file_name"], row["file_name"], row["size"], 0, row["imported_at"], row["customer"], "—", row["project"], "邮件" if path.suffix.lower() == ".eml" else "文件", json.dumps(segments, ensure_ascii=False), json.dumps(summary, ensure_ascii=False), json.dumps(saved_attachments, ensure_ascii=False)))
            if conn.execute("UPDATE imports SET progress=100,status='done',transcript_id=? WHERE id=? AND status='processing'", (transcript_id, import_id)).rowcount != 1:
                raise TaskCancelled()
        if summary["confidence"] >= 0.6 and summary.get("evidence", {}).get("needs"):
            source_type = "email" if path.suffix.lower() == ".eml" else "file"
            insert_requirements_from_audio(import_id, str(row["customer"]), str(row["project"]), summary, source_time=str(row["imported_at"]), source_type=source_type)
        finish_task(task_id, "succeeded", progress=100)
    except TaskCancelled:
        finish_task(task_id, "cancelled", progress=0)
    except Exception as exc:
        set_import_status(import_id, "failed", 0)
        finish_task(task_id, "failed", progress=0, error=str(exc))


def update_attachment(source_type: str, source_id: str, attachment_id: str, values: dict) -> None:
    table = "chats" if source_type == "chat" else "transcripts"
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(f"SELECT attachments_json FROM {table} WHERE id=?", (source_id,)).fetchone()
        if row is None:
            return
        attachments = json.loads(row["attachments_json"] or "[]")
        for attachment in attachments:
            if attachment.get("id") == attachment_id:
                attachment.update(values)
        conn.execute(f"UPDATE {table} SET attachments_json=? WHERE id=?", (json.dumps(attachments, ensure_ascii=False), source_id))


def transcribe_saved_voice(source_type: str, source_id: str, attachment_id: str, stored_name: str, task_id: str | None = None) -> None:
    try:
        ensure_task_active(task_id)
        update_attachment(source_type, source_id, attachment_id, {"transcriptStatus": "processing", "transcriptError": ""})
        path = (UPLOAD_DIR / Path(stored_name).name).resolve()
        if path.parent != UPLOAD_DIR.resolve() or not path.is_file() or path.stat().st_size > 25 * 1024 * 1024:
            raise ValueError("本地语音文件不存在或超过 25 MB")
        text = transcribe_audio_file(path, mimetypes.guess_type(path.name)[0] or "audio/amr",
            lambda done, total: set_task_progress(task_id, int(90 * done / max(1, total))), task_id=task_id)
        if not text.strip():
            raise ValueError("语音未识别出可读文字，请检查音频后重试")
        ensure_task_active(task_id)
        update_attachment(source_type, source_id, attachment_id, {"transcript": text, "transcriptStatus": "done", "transcriptError": ""})
        finish_task(task_id, "succeeded", progress=100)
    except TaskCancelled:
        update_attachment(source_type, source_id, attachment_id, {"transcriptStatus": "failed", "transcriptError": "转写已取消，可以重试"})
        finish_task(task_id, "cancelled", progress=0)
    except Exception as exc:
        update_attachment(source_type, source_id, attachment_id, {"transcriptStatus": "failed", "transcriptError": str(exc)[:1000]})
        finish_task(task_id, "failed", progress=0, error=str(exc))


def probe_duration(path: Path) -> float:
    if FFPROBE:
        try:
            out = subprocess.run(
                [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
                capture_output=True, text=True, timeout=30,
            )
            return float(out.stdout.strip() or 0)
        except Exception:
            pass
    # ffprobe is optional in the lightweight build; ffmpeg prints the same
    # duration on stderr during input probing.
    if FFMPEG:
        try:
            proc = subprocess.run([FFMPEG, "-i", str(path)], capture_output=True, text=True, timeout=30)
            match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", proc.stderr or "")
            if match:
                hours, minutes, seconds = int(match.group(1)), int(match.group(2)), float(match.group(3))
                return hours * 3600 + minutes * 60 + seconds
        except Exception:
            pass
    return 0.0


def split_transcript(text: str, duration: float) -> list[dict]:
    parts = [p.strip() for p in re.split(r"(?<=[。！？!?；;])", text) if p.strip()]
    if not parts:
        parts = [text.strip()] if text.strip() else ["（未识别到语音内容）"]
    total_chars = sum(max(1, len(p)) for p in parts)
    segments = []
    cursor = 0.0
    for index, part in enumerate(parts):
        span = duration * (max(1, len(part)) / total_chars) if duration else 4.0
        start = round(cursor * 1000)
        cursor += span
        end = round(cursor * 1000)
        segments.append({
            "id": f"s{index + 1:02d}",
            "start": round(start / 1000, 2),
            "end": round(end / 1000, 2),
            "speaker": "unknown",
            "text": part,
        })
    return segments


def process_import_real(import_id: str, audio_path: Path, mime_type: str, task_id: str | None = None) -> None:
    """Real Sprint 1 pipeline: ffmpeg -> Qwen ASR -> Qwen structured summary."""
    try:
        def progress(value: int) -> None:
            ensure_task_active(task_id)
            with db() as conn:
                conn.execute("UPDATE imports SET progress=? WHERE id=? AND status='processing'", (value, import_id))
            set_task_progress(task_id, value)

        progress(10)
        progress(25)

        def chunk_progress(index: int, total: int) -> None:
            progress(25 + int(25 * index / max(1, total)))

        ensure_task_active(task_id)
        chunks = []
        transcript_text = transcribe_audio_file(audio_path, mime_type, chunk_progress, task_id, chunks)
        ensure_task_active(task_id)
        if not transcript_text:
            raise RuntimeError("ASR returned empty text")
        progress(55)
        summary = summarize_transcript(transcript_text)
        ensure_task_active(task_id)
        progress(80)
        duration = probe_duration(audio_path) or (chunks[-1]["end"] if chunks else 0.0)
        segments = []
        for chunk in chunks:
            for segment in split_transcript(chunk["text"], chunk["end"] - chunk["start"]):
                segment.update(id=f"s{len(segments) + 1:04d}",
                    start=round(min(segment["start"] + chunk["start"], chunk["end"]), 2),
                    end=round(min(segment["end"] + chunk["start"], chunk["end"]), 2))
                segments.append(segment)
        with db() as conn:
            row = conn.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
            if row is None:
                return
            ensure_task_active(task_id)
            transcript_id = f"tr-{import_id}"
            conn.execute(
                "INSERT OR REPLACE INTO transcripts (id,title,file_name,file_size,duration,imported_at,customer,company,project,source,segments_json,summary_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    transcript_id,
                    f"通话记录 · {row['customer']}",
                    row["file_name"],
                    row["size"],
                    int(duration),
                    row["imported_at"],
                    row["customer"],
                    "—",
                    row["project"],
                    "录音文件",
                    json.dumps(segments, ensure_ascii=False),
                    json.dumps(summary, ensure_ascii=False),
                ),
            )
            import_update = conn.execute(
                "UPDATE imports SET progress=100, status='done', transcript_id=? WHERE id=? AND status='processing'",
                (transcript_id, import_id),
            )
            if import_update.rowcount != 1:
                if task_id and task_status(task_id) == "cancelled":
                    raise TaskCancelled()
                raise RuntimeError("导入记录状态已改变，任务未完成")
        if summary["confidence"] >= 0.6 and summary.get("evidence", {}).get("needs"):
            insert_requirements_from_audio(import_id, str(row["customer"]), str(row["project"] or "—"), summary, source_time=str(row["imported_at"] or ""))
        finish_task(task_id, "succeeded", progress=100)
    except TaskCancelled:
        print(f"[ai-sidecar] real pipeline cancelled {import_id}", flush=True)
        if task_id and task_status(task_id) == "running":
            return
        if task_id and has_active_replacement(task_id):
            return
        set_import_status(import_id, "cancelled", 0)
        finish_task(task_id, "cancelled", progress=0)
    except Exception as exc:
        print(f"[ai-sidecar] real pipeline error {import_id}: {exc}", flush=True)
        set_import_status(import_id, "failed", 0)
        finish_task(task_id, "failed", progress=0, error=str(exc))


def process_import(import_id: str, task_id: str | None = None) -> None:
    """Simulate the Sprint 1 pipeline: upload -> transcode -> transcribe -> summarize."""
    try:
        for progress in (20, 40, 60, 80):
            ensure_task_active(task_id)
            time.sleep(0.55)
            with db() as conn:
                conn.execute("UPDATE imports SET progress=? WHERE id=? AND status='processing'", (progress, import_id))
            set_task_progress(task_id, progress)
        ensure_task_active(task_id)
        time.sleep(0.55)
        with db() as conn:
            row = conn.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
            if row is None:
                return
            ensure_task_active(task_id)
            transcript_id = row["transcript_id"]
            if transcript_id is None and row["type"] in ("音频", "视频"):
                transcript_id = "tr-001"
            import_update = conn.execute(
                "UPDATE imports SET progress=100, status='done', transcript_id=? WHERE id=? AND status='processing'",
                (transcript_id, import_id),
            )
            if import_update.rowcount != 1:
                if task_id and task_status(task_id) == "cancelled":
                    raise TaskCancelled()
                raise RuntimeError("导入记录状态已改变，任务未完成")
        finish_task(task_id, "succeeded", progress=100)
    except TaskCancelled:
        print(f"[ai-sidecar] process cancelled {import_id}", flush=True)
        if task_id and task_status(task_id) == "running":
            return
        if task_id and has_active_replacement(task_id):
            return
        set_import_status(import_id, "cancelled", 0)
        finish_task(task_id, "cancelled", progress=0)
    except Exception as exc:  # pragma: no cover - defensive for local prototype
        print(f"[ai-sidecar] process error {import_id}: {exc}", flush=True)
        set_import_status(import_id, "failed", 0)
        finish_task(task_id, "failed", progress=0, error=str(exc))


def _run_task(task_id: str, runner, *args) -> None:
    if not set_task_running(task_id):
        return
    try:
        runner(*args, task_id=task_id)
    except TaskCancelled:
        finish_task(task_id, "cancelled", progress=0)
    except Exception as exc:  # pragma: no cover - last-resort worker guard
        print(f"[ai-sidecar] task error {task_id}: {exc}", flush=True)
        task = get_task(task_id)
        if task and task.get("importId"):
            set_import_status(str(task["importId"]), "failed", 0)
        finish_task(task_id, "failed", progress=0, error=str(exc))


def start_task(task_id: str, runner, *args) -> None:
    threading.Thread(target=_run_task, args=(task_id, runner, *args), daemon=True).start()


def launch_task(task: dict) -> bool:
    payload = task.get("payload") or {}
    kind = task.get("kind")
    import_id = str(task.get("importId") or payload.get("importId") or "")
    if kind == "attachment_voice":
        start_task(str(task["id"]), transcribe_saved_voice, payload["sourceType"], payload["sourceId"], payload["attachmentId"], payload["storedName"])
        return True
    if kind == "chat_analysis":
        chat_id = str(task.get("entityId") or payload.get("chatId") or "")
        if not import_id or not chat_id:
            finish_task(str(task["id"]), "failed", error="任务缺少聊天记录标识")
            return False
        start_task(str(task["id"]), process_chat_analysis, import_id, chat_id)
        return True
    if kind == "import_real":
        path = Path(str(payload.get("path") or ""))
        if not path.exists():
            set_import_status(import_id, "failed", 0)
            finish_task(str(task["id"]), "failed", error="原始音频文件不存在，无法恢复")
            return False
        start_task(str(task["id"]), process_import_real, import_id, path, str(payload.get("mimeType") or "audio/mpeg"))
        return True
    if kind == "import_document":
        path = Path(str(payload.get("path") or ""))
        if not path.is_file():
            set_import_status(import_id, "failed", 0)
            finish_task(str(task["id"]), "failed", error="原始文档不存在，无法恢复")
            return False
        start_task(str(task["id"]), process_document, import_id, path)
        return True
    if kind == "import":
        if not import_id:
            finish_task(str(task["id"]), "failed", error="任务缺少导入记录标识")
            return False
        start_task(str(task["id"]), process_import, import_id)
        return True
    finish_task(str(task["id"]), "failed", error=f"不支持的任务类型：{kind}")
    return False


def retry_task(task_id: str) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if row is None:
            return None
        if row["status"] in TASK_ACTIVE:
            return row_to_task(row)
        if row["status"] == "succeeded":
            return row_to_task(row)
        payload = json.loads(row["payload_json"] or "{}")
        new_task_id = f"task-{uuid.uuid4().hex[:12]}"
        now = task_now()
        conn.execute(
            "INSERT INTO tasks (id,kind,import_id,entity_id,status,progress,attempt,max_attempts,error,payload_json,created_at,updated_at,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                new_task_id,
                row["kind"],
                row["import_id"],
                row["entity_id"],
                "queued",
                0,
                0,
                int(row["max_attempts"] or 3),
                "",
                json.dumps(payload, ensure_ascii=False),
                now,
                now,
                None,
                None,
            ),
        )
        if row["import_id"]:
            conn.execute("UPDATE imports SET status='processing', progress=0 WHERE id=?", (row["import_id"],))
        if row["entity_id"] and row["kind"] == "chat_analysis":
            conn.execute("UPDATE chats SET status='processing' WHERE id=?", (row["entity_id"],))
        updated = conn.execute("SELECT * FROM tasks WHERE id=?", (new_task_id,)).fetchone()
    launch_task(row_to_task(updated, include_payload=True))
    return row_to_task(updated)


def create_backup_archive() -> tuple[bytes, str]:
    """Create a portable local backup without exporting the API key."""
    with BACKUP_LOCK:
        # Migrate legacy plaintext keys before copying the database.
        get_llm_config()
        temp_fd, temp_name = tempfile.mkstemp(prefix="clienthub-backup-", suffix=".db", dir=str(DATA_DIR))
        os.close(temp_fd)
        temp_db = Path(temp_name)
        try:
            source = connect()
            destination = sqlite3.connect(temp_db)
            try:
                source.backup(destination)
                # The archive is portable data only; API keys stay in local secure storage.
                destination.execute("DELETE FROM settings WHERE key='llm.api_key'")
                destination.commit()
            finally:
                source.close()
                destination.close()

            created_at = datetime.now().strftime("%Y%m%d-%H%M%S")
            filename = f"clienthub-backup-{created_at}.zip"
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(
                    "manifest.json",
                    json.dumps({
                        "format": "clienthub-backup",
                        "version": 1,
                        "createdAt": datetime.now().isoformat(timespec="seconds"),
                        "secretsExcluded": True,
                    }, ensure_ascii=False, indent=2),
                )
                archive.write(temp_db, "clienthub.db")
                for root_name, root in (("uploads", UPLOAD_DIR), ("wechat-exports", EXPORT_DIR)):
                    if not root.exists():
                        continue
                    for path in root.rglob("*"):
                        if path.is_file():
                            archive.write(path, str(Path(root_name) / path.relative_to(root)))
            payload = buffer.getvalue()
            (BACKUP_DIR / filename).write_bytes(payload)
            return payload, filename
        finally:
            temp_db.unlink(missing_ok=True)


def restore_backup_archive(payload: bytes) -> dict:
    if len(payload) > 600 * 1024 * 1024:
        raise ValueError("备份文件超过 600 MB，无法恢复")
    with BACKUP_LOCK:
        with db() as conn:
            active = conn.execute("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued','running')").fetchone()["n"]
        if active:
            raise ValueError("仍有任务正在处理，请等待或取消后再恢复备份")

        restore_root = Path(tempfile.mkdtemp(prefix="clienthub-restore-", dir=str(DATA_DIR)))
        try:
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                total_size = sum(info.file_size for info in archive.infolist())
                if total_size > 1_000 * 1024 * 1024:
                    raise ValueError("备份解压后超过 1 GB，已拒绝恢复")
                for info in archive.infolist():
                    name = Path(info.filename)
                    if name.is_absolute() or ".." in name.parts or name.parts[0] not in {"manifest.json", "clienthub.db", "uploads", "wechat-exports"}:
                        raise ValueError("备份包含非法路径")
                archive.extractall(restore_root)

            manifest_path = restore_root / "manifest.json"
            database_path = restore_root / "clienthub.db"
            if not manifest_path.exists() or not database_path.exists():
                raise ValueError("备份缺少必要文件")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("format") != "clienthub-backup" or int(manifest.get("version", 0)) != 1:
                raise ValueError("不支持的备份格式")
            check = sqlite3.connect(database_path)
            try:
                check.execute("SELECT 1 FROM imports LIMIT 1").fetchone()
            finally:
                check.close()

            # Keep an automatic rollback point before replacing live data.
            create_backup_archive()
            source = sqlite3.connect(database_path)
            target = connect()
            try:
                source.backup(target)
                sales.migrate(target)
                migrate_ingest(target)
                notifications.migrate(target)
                target.commit()
            finally:
                source.close()
                target.close()

            for root_name, live_root in (("uploads", UPLOAD_DIR), ("wechat-exports", EXPORT_DIR)):
                incoming = restore_root / root_name
                if live_root.exists():
                    shutil.rmtree(live_root)
                if incoming.exists():
                    os.replace(incoming, live_root)
                live_root.mkdir(parents=True, exist_ok=True)
            return {"status": "ok", "createdAt": manifest.get("createdAt"), "secretsExcluded": True}
        finally:
            shutil.rmtree(restore_root, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "ClientHubAI/0.1"

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, payload: dict | list, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # The browser can close a polling connection before the response
            # is written; this is normal and must not surface as a server error.
            pass

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        query = parse_qs(parsed_url.query)

        def q(name: str, default: str = "") -> str:
            values = query.get(name) or []
            return str(values[0]) if values else default

        if path == "/api/notifications":
            settings = get_app_settings()
            with db() as conn:
                result = notifications.listing(conn, settings)
            self._json(result)
            return
        if path == "/api/search":
            with db() as conn:
                result = sales.search(conn, q("q"))
            self._json(result)
            return
        if path == "/api/todos":
            with db() as conn:
                result = sales.list_todos(conn, q("customer"))
            self._json(result)
            return
        if path == "/api/profile":
            self._json(get_profile())
            return
        if path.startswith("/api/customers/") and path.endswith("/followup"):
            customer = unquote(path.split("/")[-2])
            with db() as conn:
                result = sales.followup(conn, customer)
            self._json(result)
            return
        if path == "/api/wechat/status":
            self._json(wechat_engine.status())
            return
        if path == "/api/wechat/prepare/status":
            self._json(wechat_engine.prepare_status())
            return
        if path == "/api/wechat/import/status":
            self._json(wechat_engine.import_status())
            return
        if path == "/api/wechat/sessions":
            try:
                data = wechat_engine.list_sessions(q("account"), int(q("limit", "400") or 400))
                self._json(data)
            except Exception as exc:
                self._json({"status": "error", "error": str(exc)}, 502)
            return
        if path == "/api/wechat/messages":
            try:
                account = q("account")
                username = q("username")
                if not username:
                    self._json({"error": "username_required"}, 400)
                    return
                start_date = q("startDate")
                end_date = q("endDate")
                types = [x for x in q("types").split(",") if x]
                start_ts = int(datetime.strptime(start_date, "%Y-%m-%d").timestamp()) if start_date else None
                end_ts = int(datetime.strptime(end_date + " 23:59:59", "%Y-%m-%d %H:%M:%S").timestamp()) if end_date else None
                raw = wechat_engine.fetch_messages(account, username, start_ts=start_ts)
                messages, _ = wechat_engine.normalize_messages(
                    raw, account=account, username=username,
                    start_ts=start_ts, end_ts=end_ts, render_types=types,
                )
                preview = messages[:80]
                self._json({"status": "success", "total": len(messages), "messages": preview})
            except Exception as exc:
                self._json({"status": "error", "error": str(exc)}, 502)
            return
        if path == "/api/tasks":
            self._json(list_tasks(int(q("limit", "100") or 100)))
            return
        if path.startswith("/api/tasks/"):
            task_id = unquote(path.split("/")[-1])
            task = get_task(task_id)
            if task is None:
                self._json({"error": "task_not_found"}, 404)
            else:
                self._json(task)
            return
        if path == "/api/backups":
            backups = []
            for backup in sorted(BACKUP_DIR.glob("clienthub-backup-*.zip"), key=lambda item: item.stat().st_mtime, reverse=True)[:20]:
                try:
                    stat = backup.stat()
                    backups.append({"name": backup.name, "size": stat.st_size, "createdAt": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds")})
                except OSError:
                    continue
            self._json(backups)
            return
        if path == "/api/backup/export":
            try:
                archive, filename = create_backup_archive()
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.send_header("Content-Length", str(len(archive)))
                self._cors()
                self.end_headers()
                self.wfile.write(archive)
            except Exception as exc:
                self._json({"error": str(exc)}, 500)
            return
        if path == "/api/settings/llm":
            config = get_llm_config()
            self._json({
                "baseUrl": config["baseUrl"],
                "asrModel": config["asrModel"],
                "summaryModel": config["summaryModel"],
                "visionModel": config["visionModel"],
                "apiKeyMasked": _mask_key(config["apiKey"]),
                "hasKey": bool(config["apiKey"]),
            })
            return
        if path == "/api/settings/llm/models":
            self._json(list_llm_models())
            return
        if path == "/api/settings/app":
            self._json(get_app_settings())
            return
        if path == "/api/projects":
            self._json(list_all_projects())
            return
        if path == "/api/dashboard":
            self._json(dashboard_summary())
            return
        if path == "/api/metrics":
            try:
                days = max(1, min(int(q("days", "7") or 7), 90))
            except ValueError:
                self._json({"error": "days_invalid"}, 400)
                return
            with db() as conn:
                self._json(sales.metrics(conn, days=days))
            return
        if path == "/api/health":
            config = get_llm_config()
            self._json({
                "status": "ok",
                "service": "clienthub-ai-sidecar",
                "mode": "maas" if config["apiKey"] else "mock",
                "asrModel": config["asrModel"],
                "summaryModel": config["summaryModel"],
                "visionModel": config["visionModel"],
                "version": os.getenv("CLIENTHUB_APP_VERSION", "0.2.7"),
                "apiRevision": 5,
            })
            return
        if path == "/api/diagnostics":
            self._json(get_diagnostics())
            return
        if path == "/api/imports":
            with db() as conn:
                rows = conn.execute("SELECT * FROM imports ORDER BY imported_at DESC, rowid DESC").fetchall()
            self._json([row_to_import(r) for r in rows])
            return
        if path.startswith("/api/transcripts/"):
            transcript_id = path.split("/")[-1]
            with db() as conn:
                row = conn.execute("SELECT * FROM transcripts WHERE id=?", (transcript_id,)).fetchone()
            if row is None:
                self._json({"error": "transcript_not_found"}, 404)
            else:
                self._json(row_to_transcript(row))
            return
        if path.startswith("/api/chats/"):
            chat_id = path.split("/")[-1]
            with db() as conn:
                row = conn.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
            if row is None:
                self._json({"error": "chat_not_found"}, 404)
            else:
                self._json(row_to_chat(row))
            return
        if path == "/api/customers":
            self._json(list_customers())
            return
        if path.startswith("/api/customers/") and path.endswith("/timeline"):
            parts = [part for part in path.split("/") if part]
            customer_name = unquote(parts[-2]) if len(parts) >= 2 else ""
            self._json(customer_timeline(customer_name))
            return
        if path.startswith("/api/customers/") and path.endswith("/projects"):
            parts = [part for part in path.split("/") if part]
            customer_name = unquote(parts[-2]) if len(parts) >= 2 else ""
            self._json(list_projects(customer_name))
            return
        if path.startswith("/api/customers/") and path.endswith("/requirements"):
            parts = [part for part in path.split("/") if part]
            customer_name = unquote(parts[-2]) if len(parts) >= 2 else ""
            project = q("project")
            self._json(list_requirements(customer_name, project))
            return
        if path.startswith("/api/customers/") and not path.endswith("/timeline") and not path.endswith("/projects") and not path.endswith("/requirements"):
            customer_name = unquote(path.split("/")[-1])
            customer = get_customer(customer_name)
            if customer is None:
                self._json({"error": "customer_not_found"}, 404)
            else:
                self._json(customer)
            return
        if path.startswith("/api/files/") and path.endswith("/preview"):
            name = Path(unquote(path.split("/")[-2])).name
            file_path = (UPLOAD_DIR / name).resolve()
            if file_path.parent != UPLOAD_DIR.resolve() or not file_path.is_file():
                self._json({"error": "file_not_found"}, 404)
                return
            try:
                if file_path.stat().st_size > 25 * 1024 * 1024:
                    raise ValueError("附件超过 25 MB，请下载后打开")
                if file_path.suffix.lower() in (".txt", ".csv"):
                    text = file_path.read_bytes()[:document_ingest.MAX_TEXT].decode("utf-8-sig", errors="replace")
                else:
                    text, _ = document_ingest.extract(file_path)
                self._json({"text": text})
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return
        if path.startswith("/api/files/"):
            name = Path(unquote(path.split("/")[-1])).name
            file_path = UPLOAD_DIR / name
            if not file_path.exists() or not file_path.is_file():
                self._json({"error": "file_not_found"}, 404)
                return
            body = file_path.read_bytes()
            mime_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            if q("download") == "1" or mime_type in ("text/html", "image/svg+xml", "application/xhtml+xml"):
                self.send_header("Content-Disposition", "attachment")
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            return
        self._json({"error": "not_found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if int(self.headers.get("Content-Length", "0") or "0") > 135 * 1024 * 1024:
            self._json({"error": "request_too_large", "message": "请求超过 135 MB，请分批或压缩后重试"}, 413)
            return
        data = self._read_json()

        if path == "/api/notifications":
            try:
                with db() as conn:
                    notifications.refresh(conn)
                    notifications.mark(conn, data)
                self._json({"status": "ok"})
            except ValueError as exc:
                self._json({"error": str(exc)}, 400)
            return
        if path == "/api/profile":
            try:
                self._json(save_profile(data))
            except ValueError as exc:
                self._json({"error": str(exc)}, 400)
            return
        if path.startswith("/api/transcripts/") and path.endswith("/regenerate-summary"):
            transcript_id = unquote(path.split("/")[3])
            if not get_llm_config()["apiKey"]:
                self._json({"error": "请先在设置中配置模型 API Key"}, 400)
                return
            with db() as conn:
                row = conn.execute("SELECT segments_json FROM transcripts WHERE id=?", (transcript_id,)).fetchone()
            if row is None:
                self._json({"error": "transcript_not_found"}, 404)
                return
            original_segments = str(row["segments_json"])
            transcript = "\n".join(str(item.get("text") or "") for item in json.loads(original_segments))
            try:
                summary = summarize_transcript(transcript)
            except Exception as exc:
                self._json({"error": f"摘要生成失败：{exc}"}, 502)
                return
            with db() as conn:
                changed = conn.execute("UPDATE transcripts SET summary_json=? WHERE id=? AND segments_json=?", (json.dumps(summary, ensure_ascii=False), transcript_id, original_segments)).rowcount
                result = conn.execute("SELECT * FROM transcripts WHERE id=?", (transcript_id,)).fetchone()
            if not changed:
                self._json({"error": "转写原文已更新，请重试生成摘要"}, 409)
                return
            self._json(row_to_transcript(result))
            return
        if (path.startswith("/api/chats/") or path.startswith("/api/transcripts/")) and path.endswith("/attachments/transcribe"):
            source_id = unquote(path.split("/")[3])
            source_type = "chat" if path.startswith("/api/chats/") else "transcript"
            table = "chats" if source_type == "chat" else "transcripts"
            attachment_id = str(data.get("attachmentId") or "")
            with db() as conn:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (source_id,)).fetchone()
                attachments = json.loads(row["attachments_json"] or "[]") if row else []
                attachment = next((item for item in attachments if item.get("id") == attachment_id), None)
                if not attachment or attachment.get("kind") != "voice" or not attachment.get("storedName"):
                    self._json({"error": "本地语音附件不存在"}, 400)
                    return
                active = conn.execute("SELECT id FROM tasks WHERE kind='attachment_voice' AND entity_id=? AND json_extract(payload_json,'$.attachmentId')=? AND status IN ('queued','running')", (source_id, attachment_id)).fetchone()
                if active or attachment.get("transcriptStatus") == "done":
                    self._json({"status": "processing" if active else "done"}, 202 if active else 200)
                    return
                task_id = f"task-{uuid.uuid4().hex[:12]}"
                payload = {"sourceType": source_type, "sourceId": source_id, "attachmentId": attachment_id, "storedName": attachment["storedName"]}
                now = task_now()
                conn.execute("INSERT INTO tasks(id,kind,entity_id,status,payload_json,created_at,updated_at) VALUES (?, 'attachment_voice', ?, 'queued', ?, ?, ?)", (task_id, source_id, json.dumps(payload), now, now))
                attachment.update({"transcriptStatus": "processing", "transcriptError": ""})
                conn.execute(f"UPDATE {table} SET attachments_json=? WHERE id=?", (json.dumps(attachments, ensure_ascii=False), source_id))
            start_task(task_id, transcribe_saved_voice, source_type, source_id, attachment_id, str(attachment["storedName"]))
            self._json({"status": "started", "taskId": task_id, "attachmentId": attachment_id}, 202)
            return
        if path in ("/api/todos", "/api/imports/archive"):
            try:
                with db() as conn:
                    result = sales.save_todo(conn, data) if path == "/api/todos" else sales.archive_imports(conn, data)
                self._json(result, 201 if path == "/api/todos" else 200)
            except (ValueError, sqlite3.IntegrityError) as exc:
                self._json({"error": str(exc)}, 400)
            return
        if path.startswith("/api/tasks/") and path.endswith("/retry"):
            task_id = unquote(path.split("/")[-2])
            task = retry_task(task_id)
            if task is None:
                self._json({"error": "task_not_found"}, 404)
            else:
                self._json(task)
            return

        if path == "/api/backup/restore":
            encoded = str(data.get("archiveBase64") or "").strip()
            if not encoded:
                self._json({"error": "archiveBase64_required"}, 400)
                return
            try:
                archive = base64.b64decode(encoded, validate=True)
                self._json(restore_backup_archive(archive))
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return

        if path == "/api/settings/llm":
            try:
                saved = save_llm_config(data)
                self._json({
                    "baseUrl": saved["baseUrl"],
                    "asrModel": saved["asrModel"],
                    "summaryModel": saved["summaryModel"],
                    "visionModel": saved["visionModel"],
                    "apiKeyMasked": _mask_key(saved["apiKey"]),
                    "hasKey": bool(saved["apiKey"]),
                })
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return

        if path == "/api/settings/llm/test":
            self._json(test_llm_config(data))
            return

        if path == "/api/settings/llm/models":
            self._json(list_llm_models(data))
            return

        if path == "/api/settings/app":
            try:
                self._json(save_app_settings(data))
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return

        if path.startswith("/api/chats/") and path.endswith("/reanalyze"):
            chat_id = path.split("/")[-2]
            with db() as conn:
                chat = conn.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
                import_row = conn.execute("SELECT * FROM imports WHERE transcript_id=? ORDER BY rowid DESC LIMIT 1", (chat_id,)).fetchone()
            if chat is None:
                self._json({"error": "chat_not_found"}, 404)
                return
            with db() as conn:
                conn.execute("UPDATE chats SET status='processing' WHERE id=?", (chat_id,))
                if import_row:
                    conn.execute("UPDATE imports SET status='processing', progress=5 WHERE id=?", (import_row["id"],))
            import_id = import_row["id"] if import_row else ""
            task_id = create_task("chat_analysis", import_id=import_id, entity_id=chat_id, payload={"importId": import_id, "chatId": chat_id})
            start_task(task_id, process_chat_analysis, import_id, chat_id)
            self._json({"status": "started", "chatId": chat_id, "taskId": task_id})
            return

        if path.startswith("/api/customers/") and path.endswith("/projects"):
            parts = [part for part in path.split("/") if part]
            customer_name = unquote(parts[-2]) if len(parts) >= 2 else ""
            try:
                project = create_project(customer_name, data)
                self._json(project, 201)
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return

        if path.startswith("/api/customers/") and path.endswith("/requirements"):
            parts = [part for part in path.split("/") if part]
            customer_name = unquote(parts[-2]) if len(parts) >= 2 else ""
            try:
                requirement = create_requirement(customer_name, data)
                self._json(requirement, 201)
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return

        if path == "/api/requirements/merge":
            try:
                target_id = str(data.get("targetId") or "")
                source_ids = [str(item) for item in (data.get("sourceIds") or []) if str(item)]
                self._json(merge_requirements(target_id, source_ids))
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return

        if path == "/api/customers":
            name = str(data.get("name") or "").strip()
            if not name:
                self._json({"error": "name_required"}, 400)
                return
            try:
                customer = update_customer(name, data)
                self._json(customer, 201)
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return

        if path == "/api/customers/merge":
            try:
                self._json(merge_customers(str(data.get("source") or ""), str(data.get("target") or "")))
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return

        if path == "/api/imports":
            file_name = str(data.get("fileName") or "").strip()
            if not file_name:
                self._json({"error": "fileName_required"}, 400)
                return
            audio_b64 = str(data.get("audioBase64") or data.get("contentBase64") or "").strip()
            audio_bytes: bytes | None = None
            if audio_b64:
                try:
                    audio_bytes = base64.b64decode(audio_b64, validate=True)
                except Exception:
                    self._json({"error": "invalid_audio_base64"}, 400)
                    return
                if len(audio_bytes) > 100 * 1024 * 1024:
                    self._json({"error": "file_too_large"}, 413)
                    return
            file_suffix = Path(file_name).suffix.lower()
            document_file = file_suffix in document_ingest.SUPPORTED
            if document_file and audio_bytes is None:
                self._json({"error": "file_content_required"}, 400)
                return
            if audio_bytes is not None:
                digest = hashlib.sha256(audio_bytes).hexdigest()
            else:
                digest = hashlib.sha256(f"{file_name}|{data.get('size','')}|{data.get('kind','')}".encode("utf-8")).hexdigest()
            app_settings = get_app_settings()
            import_customer = str(data.get("customer") or "待归档") if app_settings["autoMatch"] else "待归档"
            import_project = str(data.get("project") or app_settings["defaultProject"] or "—")
            with db() as conn:
                existing = conn.execute("SELECT * FROM imports WHERE sha256=?", (digest,)).fetchone()
                if existing:
                    payload = row_to_import(existing)
                    payload["duplicate"] = True
                    self._json(payload)
                    return
                import_id = f"imp-{uuid.uuid4().hex[:10]}"
                record_type = str(data.get("type") or "文件")
                suffix = Path(file_name).suffix.lower() or ".bin"
                saved_path: Path | None = None
                if audio_bytes is not None:
                    saved_path = UPLOAD_DIR / f"{import_id}{suffix}"
                    saved_path.write_bytes(audio_bytes)
                conn.execute(
                    "INSERT INTO imports (id,file_name,type,size,customer,project,status,progress,imported_at,transcript_id,sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        import_id,
                        file_name,
                        record_type,
                        str(data.get("size") or "—"),
                        import_customer,
                        import_project,
                        "processing",
                        0,
                        now_time(),
                        None,
                        digest,
                    ),
                )
            mime_type = str(data.get("mimeType") or "audio/mpeg")
            task_kind = "import_document" if document_file else "import_real" if saved_path is not None else "import"
            task_id = create_task(
                task_kind,
                import_id=import_id,
                payload={"importId": import_id, "path": str(saved_path) if saved_path is not None else "", "mimeType": mime_type},
            )
            if document_file and saved_path is not None:
                start_task(task_id, process_document, import_id, saved_path)
            elif saved_path is not None:
                start_task(task_id, process_import_real, import_id, saved_path, mime_type)
            else:
                start_task(task_id, process_import, import_id)
            self._json({"id": import_id, "status": "processing", "taskId": task_id}, 201)
            return

        if path == "/api/asr":
            audio_b64 = str(data.get("audioBase64") or "").strip()
            if not audio_b64:
                self._json({"error": "audioBase64_required"}, 400)
                return
            tmp_path: Path | None = None
            try:
                audio = base64.b64decode(audio_b64, validate=True)
                suffix = Path(str(data.get("fileName") or "audio.mp3")).suffix or ".mp3"
                tmp_path = DATA_DIR / "tmp" / f"asr-{uuid.uuid4().hex}{suffix}"
                tmp_path.parent.mkdir(parents=True, exist_ok=True)
                tmp_path.write_bytes(audio)
                text = transcribe_audio_file(tmp_path, str(data.get("mimeType") or "audio/mpeg"))
                self._json({"text": text, "model": get_llm_config()["asrModel"]})
            except Exception as exc:
                self._json({"error": str(exc)}, 502)
            finally:
                if tmp_path is not None:
                    tmp_path.unlink(missing_ok=True)
            return

        if path == "/api/summarize":
            transcript = str(data.get("transcript") or "").strip()
            if not transcript:
                self._json({"error": "transcript_required"}, 400)
                return
            try:
                self._json({"summary": summarize_transcript(transcript), "model": get_llm_config()["summaryModel"]})
            except Exception as exc:
                self._json({"error": str(exc)}, 502)
            return

        if path == "/api/wechat/prepare":
            try:
                self._json(wechat_engine.start_prepare(), 202)
            except Exception as exc:
                self._json({"status": "failed", "error": str(exc)}, 400)
            return

        if path == "/api/wechat/import":
            try:
                job = wechat_engine.start_import(
                    account=str(data.get("account") or ""),
                    username=str(data.get("username") or ""),
                    start_date=str(data.get("startDate") or ""),
                    end_date=str(data.get("endDate") or ""),
                    render_types=[str(item) for item in (data.get("types") or []) if str(item)],
                    customer=str(data.get("customer") or ""),
                    project=str(data.get("project") or ""),
                )
                self._json(job, 202)
            except Exception as exc:
                self._json({"status": "failed", "error": str(exc)}, 400)
            return

        if path == "/api/imports/chat-screenshot":
            image_b64 = str(data.get("imageBase64") or "").strip()
            if not image_b64:
                self._json({"error": "imageBase64_required"}, 400)
                return
            try:
                image = base64.b64decode(image_b64, validate=True)
                stored = extract_chat_screenshot(
                    image,
                    str(data.get("mimeType") or "image/png"),
                    str(data.get("fileName") or f"聊天截图_{datetime.now().strftime('%Y-%m-%d')}.png"),
                    str(data.get("customer") or ""),
                    str(data.get("project") or ""),
                )
                if stored is None:
                    self._json({"error": "screenshot_not_recognized"}, 400)
                    return
                self._json({"id": stored["importId"], "status": "processing", "chatId": stored["chatId"], "messageCount": stored["messageCount"]}, 201)
            except Exception as exc:
                self._json({"error": str(exc)}, 502)
            return

        if path == "/api/imports/chat":
            text = str(data.get("text") or "").strip()
            if not text:
                self._json({"error": "text_required"}, 400)
                return
            chat = create_chat_record(
                text,
                str(data.get("fileName") or f"微信聊天_{datetime.now().strftime('%Y-%m-%d')}.txt"),
                str(data.get("customer") or ""),
                str(data.get("project") or ""),
                str(data.get("meName") or ""),
            )
            if chat is None:
                self._json({"error": "not_a_recognized_chat"}, 400)
                return
            self._json({"id": chat["importId"], "status": "processing", "chatId": chat["chatId"], "messageCount": chat["messageCount"]}, 201)
            return

        if path == "/api/imports/paste":
            text = str(data.get("text") or "").strip()
            if not text:
                self._json({"error": "text_required"}, 400)
                return
            chat = create_chat_record(
                text,
                f"粘贴文本_{datetime.now().strftime('%Y-%m-%d')}.txt",
                str(data.get("customer") or ""),
                str(data.get("project") or ""),
                str(data.get("meName") or ""),
            )
            if chat is not None:
                self._json({"id": chat["importId"], "status": "processing", "chatId": chat["chatId"], "messageCount": chat["messageCount"]}, 201)
                return
            self._json({"error": "not_a_recognized_chat"}, 400)
            return

        self._json({"error": "not_found"}, 404)

    def do_PATCH(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        data = self._read_json()
        parts = [part for part in path.split("/") if part]
        if len(parts) == 4 and parts[:2] == ["api", "transcripts"] and parts[3] == "summary":
            summary = data.get("summary")
            fields = ("oneLine", "needs", "budget", "timeline", "decisionMakers", "objections", "nextActions", "paymentMethod")
            if not isinstance(summary, dict) or any(not isinstance(summary.get(key, ""), str) for key in fields):
                self._json({"error": "invalid_summary"}, 400)
                return
            with db() as conn:
                row = conn.execute("SELECT * FROM transcripts WHERE id=?", (parts[2],)).fetchone()
                if row:
                    previous = json.loads(row["summary_json"])
                    merged = {**previous, **{key: summary[key] for key in fields if key in summary}}
                    changed = [key for key in fields if key in summary and summary[key] != previous.get(key)]
                    if changed:
                        merged.pop("evidence", None)
                        merged["confidence"] = 0
                        merged["evidenceCount"] = 0
                    conn.execute("UPDATE transcripts SET summary_json=? WHERE id=?", (json.dumps(merged, ensure_ascii=False), parts[2]))
                    for key in fields:
                        if key in summary:
                            record_correction(conn, parts[2], key, str(previous.get(key, "")), summary[key])
                    row = conn.execute("SELECT * FROM transcripts WHERE id=?", (parts[2],)).fetchone()
            self._json(row_to_transcript(row) if row else {"error": "transcript_not_found"}, 200 if row else 404)
            return
        if len(parts) == 4 and parts[:2] == ["api", "transcripts"] and parts[3] == "segments":
            changes = data.get("segments")
            if not isinstance(changes, list) or len(changes) > 5000:
                self._json({"error": "invalid_segments"}, 400)
                return
            with db() as conn:
                row = conn.execute("SELECT * FROM transcripts WHERE id=?", (parts[2],)).fetchone()
                if row:
                    segments = json.loads(row["segments_json"])
                    by_id = {item["id"]: item for item in segments}
                    if len({change.get("id") for change in changes if isinstance(change, dict)}) != len(changes) or any(not isinstance(change, dict) or not isinstance(change.get("id"), str) or change["id"] not in by_id or change.get("speaker") not in ("me", "customer", "unknown") or not isinstance(change.get("text"), str) or not change["text"].strip() or len(change["text"]) > 10000 for change in changes):
                        self._json({"error": "invalid_segments"}, 400)
                        return
                    text_changed = any(change["text"] != by_id[change["id"]]["text"] for change in changes)
                    for change in changes:
                        original = by_id[change["id"]]
                        for field in ("speaker", "text"):
                            record_correction(conn, parts[2], f"{original['id']}.{field}", str(original[field]), str(change[field]))
                            original[field] = change[field]
                    conn.execute("UPDATE transcripts SET segments_json=? WHERE id=?", (json.dumps(segments, ensure_ascii=False), parts[2]))
                    if text_changed:
                        summary = json.loads(row["summary_json"])
                        summary.pop("evidence", None)
                        summary["confidence"] = 0
                        summary["evidenceCount"] = 0
                        conn.execute("UPDATE transcripts SET summary_json=? WHERE id=?", (json.dumps(summary, ensure_ascii=False), parts[2]))
                    row = conn.execute("SELECT * FROM transcripts WHERE id=?", (parts[2],)).fetchone()
            self._json(row_to_transcript(row) if row else {"error": "transcript_not_found"}, 200 if row else 404)
            return
        if len(parts) == 3 and parts[:2] == ["api", "todos"]:
            try:
                with db() as conn:
                    result = sales.save_todo(conn, data, parts[2])
                self._json(result if result else {"error": "todo_not_found"}, 200 if result else 404)
            except (ValueError, sqlite3.IntegrityError) as exc:
                self._json({"error": str(exc)}, 400)
            return
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "chats" and parts[3] == "participants":
            chat_id = parts[2]
            participants = data.get("participants")
            if not isinstance(participants, list):
                self._json({"error": "participants_required"}, 400)
                return
            updated = update_chat_participants(chat_id, participants)
            if updated is None:
                self._json({"error": "invalid_participants"}, 400)
            else:
                self._json(updated)
            return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "customers":
            customer_name = unquote(parts[2])
            try:
                updated = update_customer(customer_name, data)
                if updated is None:
                    self._json({"error": "customer_not_found"}, 404)
                else:
                    self._json(updated)
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "projects":
            try:
                updated = update_project(parts[2], data)
                if updated is None:
                    self._json({"error": "project_not_found"}, 404)
                else:
                    self._json(updated)
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "requirements":
            try:
                updated = update_requirement(parts[2], data)
                if updated is None:
                    self._json({"error": "requirement_not_found"}, 404)
                else:
                    self._json(updated)
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return
        self._json({"error": "not_found"}, 404)

    def do_DELETE(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        parts = [part for part in path.split("/") if part]
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "tasks":
            task = cancel_task(unquote(parts[2]))
            if task is None:
                self._json({"error": "task_not_found"}, 404)
            else:
                self._json(task)
            return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "customers":
            try:
                self._json(delete_customer(unquote(parts[2])))
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "imports":
            try:
                self._json(delete_import(parts[2]))
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "projects":
            try:
                self._json(delete_project(parts[2]))
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "requirements":
            try:
                self._json(delete_requirement(parts[2]))
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return
        self._json({"error": "not_found"}, 404)

    def log_message(self, fmt: str, *args) -> None:  # keep output concise
        print(f"[ai-sidecar] {self.address_string()} {fmt % args}", flush=True)


def _is_process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return False
    try:
        exit_code = ctypes.c_ulong()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
            return False
        return exit_code.value == 259  # STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def _watch_parent(parent_pid: int) -> None:
    """Exit the sidecar if the Electron/Node parent disappears.

    This is the last line of defence against orphaned Python processes when
    the desktop app is closed or killed without running its quit handlers.
    """
    while True:
        time.sleep(2.0)
        if not _is_process_alive(parent_pid):
            print("[ai-sidecar] parent process exited, shutting down", flush=True)
            os._exit(0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--parent-pid", type=int, default=0)
    args = parser.parse_args()
    if args.parent_pid:
        threading.Thread(target=_watch_parent, args=(args.parent_pid,), daemon=True).start()
    init_db()
    backfill_requirements()
    # Resume queued/running tasks after a process crash.
    with db() as conn:
        conn.execute("UPDATE tasks SET status='queued', error='上次进程中断，任务已恢复', updated_at=? WHERE status='running'", (task_now(),))
        task_rows = conn.execute("SELECT * FROM tasks WHERE status='queued' ORDER BY created_at").fetchall()
        pending = conn.execute("SELECT id,type,transcript_id FROM imports WHERE status='processing'").fetchall()
    task_import_ids = {str(row["import_id"] or "") for row in task_rows}
    for row in task_rows:
        launch_task(row_to_task(row, include_payload=True))
    # Backfill tasks for records created by older versions before the queue existed.
    for row in pending:
        import_id = str(row["id"])
        if import_id in task_import_ids:
            continue
        if row["type"] == "聊天记录" and str(row["transcript_id"] or "").startswith("chat-"):
            task_id = create_task("chat_analysis", import_id=import_id, entity_id=str(row["transcript_id"]), payload={"importId": import_id, "chatId": str(row["transcript_id"])})
            start_task(task_id, process_chat_analysis, import_id, str(row["transcript_id"]))
        else:
            task_id = create_task("import", import_id=import_id, payload={"importId": import_id})
            start_task(task_id, process_import, import_id)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[ai-sidecar] listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
