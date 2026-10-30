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
import hashlib
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
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
DB_PATH = DATA_DIR / "clienthub.db"
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

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
    return datetime.now().strftime("%H:%M")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
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
            """
        )
        # Lightweight migration for databases created before attachment indexing.
        try:
            conn.execute("ALTER TABLE chats ADD COLUMN attachments_json TEXT DEFAULT '[]'")
        except sqlite3.OperationalError:
            pass
        # Seed once so the UI has a realistic starting state.
        count = conn.execute("SELECT COUNT(*) AS n FROM imports").fetchone()["n"]
        if count == 0:
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
        if tcount == 0:
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
    }


def delete_import(import_id: str) -> dict:
    files_to_remove: list[Path] = []
    with db() as conn:
        row = conn.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
        if row is None:
            raise ValueError("导入记录不存在")
        if row["status"] == "processing":
            raise ValueError("文件仍在处理中，请等待处理完成后再删除")
        transcript_id = str(row["transcript_id"] or "")
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
            other = conn.execute("SELECT COUNT(*) AS n FROM imports WHERE transcript_id=? AND id<>?", (transcript_id, import_id)).fetchone()["n"]
            if not other:
                conn.execute("DELETE FROM requirements WHERE source_type='audio' AND source_id IN (?,?)", (import_id, transcript_id))
                conn.execute("DELETE FROM transcripts WHERE id=?", (transcript_id,))
        # Also remove requirements created directly from this import id.
        conn.execute("DELETE FROM requirements WHERE source_id=?", (import_id,))
        conn.execute("DELETE FROM imports WHERE id=?", (import_id,))
    files_to_remove.extend(UPLOAD_DIR.glob(f"{import_id}*"))
    for path in files_to_remove:
        try:
            if path.is_file():
                path.unlink()
        except OSError:
            pass
    return {"deleted": import_id, "customer": customer, "chatDeleted": bool(chat)}


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
    }


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
        ("requirements", []), ("commitments", []), ("nextActions", []), ("tags", []),
    ):
        if key not in data or data[key] is None:
            data[key] = default
    return data


def process_chat_analysis(import_id: str, chat_id: str) -> None:
    try:
        with db() as conn:
            row = conn.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
        if row is None:
            return
        messages = json.loads(row["messages_json"])
        me_name = next((p["name"] for p in json.loads(row["participants_json"]) if p.get("role") == "me"), "")
        analysis = analyze_chat_messages(messages, me_name)
        project_name = str(analysis.get("project") or "").strip() or "—"
        with db() as conn:
            conn.execute(
                "UPDATE chats SET analysis_json=?, status='done', project=? WHERE id=?",
                (json.dumps(analysis, ensure_ascii=False), project_name, chat_id),
            )
            conn.execute(
                "UPDATE imports SET progress=100, status='done', transcript_id=?, project=? WHERE id=?",
                (chat_id, project_name, import_id),
            )
        insert_requirements_from_chat(chat_id, str(row["customer"]), project_name, analysis, source_time=str(row["imported_at"] or ""))
    except Exception as exc:
        print(f"[ai-sidecar] chat analysis error {chat_id}: {exc}", flush=True)
        with db() as conn:
            conn.execute("UPDATE chats SET status='failed' WHERE id=?", (chat_id,))
            conn.execute("UPDATE imports SET status='failed' WHERE id=?", (import_id,))


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
    threading.Thread(target=process_chat_analysis, args=(import_id, chat_id), daemon=True).start()
    return {"importId": import_id, "chatId": chat_id, "messageCount": len(messages), "participants": normalized_participants}


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
        stats = {
            "imports": conn.execute("SELECT COUNT(*) AS n FROM imports").fetchone()["n"],
            "customers": conn.execute("SELECT COUNT(*) AS n FROM customers").fetchone()["n"],
            "projects": conn.execute("SELECT COUNT(*) AS n FROM projects").fetchone()["n"],
            "requirements": conn.execute("SELECT COUNT(*) AS n FROM requirements").fetchone()["n"],
            "inbox": conn.execute("SELECT COUNT(*) AS n FROM imports WHERE status='inbox'").fetchone()["n"],
            "processing": conn.execute("SELECT COUNT(*) AS n FROM imports WHERE status='processing'").fetchone()["n"],
        }
        recent_imports = conn.execute("SELECT * FROM imports ORDER BY imported_at DESC, rowid DESC LIMIT 6").fetchall()
        recent_requirements = conn.execute(
            "SELECT * FROM requirements ORDER BY updated_at DESC, rowid DESC LIMIT 6"
        ).fetchall()
        stage_rows = conn.execute(
            "SELECT stage, COUNT(*) AS n FROM projects GROUP BY stage ORDER BY CASE stage WHEN '需求' THEN 0 WHEN '报价' THEN 1 WHEN '方案' THEN 2 WHEN '签约' THEN 3 WHEN '交付' THEN 4 ELSE 5 END"
        ).fetchall()
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
        conn.execute("DELETE FROM imports WHERE customer=?", (name,))
        conn.execute("DELETE FROM chats WHERE customer=?", (name,))
        conn.execute("DELETE FROM transcripts WHERE customer=?", (name,))
        conn.execute("DELETE FROM requirements WHERE customer=?", (name,))
        conn.execute("DELETE FROM customers WHERE name=?", (name,))
    return {"deleted": name, "records": int(import_count)}


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
        _ensure_customer(conn, customer)
        customer_row = conn.execute("SELECT * FROM customers WHERE name=?", (customer,)).fetchone()
        owner = str(customer_row["owner"] if customer_row else "王总")
        names = [
            str(row["project"])
            for row in conn.execute(
                "SELECT DISTINCT project FROM imports WHERE customer=? AND project NOT IN ('', '—')",
                (customer,),
            ).fetchall()
            if row["project"]
        ]
        for name in names:
            _ensure_project(conn, customer, name, owner)
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
        "INSERT INTO requirements (id,customer,project,title,description,priority,status,source_type,source_id,source_time,source_quote,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            requirement_id, customer, project or "—", title, description or "",
            _normalize_priority(priority), _normalize_status(status),
            source_type or "manual", source_id or "", source_time or "", source_quote or "", now, now,
        ),
    )
    return conn.execute("SELECT * FROM requirements WHERE id=?", (requirement_id,)).fetchone()


def insert_requirements_from_audio(import_id: str, customer: str, project: str, summary: dict, source_time: str = "") -> None:
    needs = str(summary.get("needs") or "").strip()
    if not needs or needs in ("未提及", "—", "无"):
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
                description=f"来自通话摘要：{needs}",
                priority="P1",
                status="待确认",
                source_type="audio",
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
        conn.execute(
            "UPDATE requirements SET project=?, title=?, description=?, priority=?, status=?, source_time=?, source_quote=?, updated_at=? WHERE id=?",
            (
                project, title, str(data.get("description", row["description"]) or ""),
                _normalize_priority(data.get("priority", row["priority"])),
                _normalize_status(data.get("status", row["status"])),
                str(data.get("sourceTime", row["source_time"]) or ""),
                str(data.get("sourceQuote", row["source_quote"]) or ""),
                datetime.now().isoformat(timespec="seconds"), requirement_id,
            ),
        )
        updated = conn.execute("SELECT * FROM requirements WHERE id=?", (requirement_id,)).fetchone()
    return _requirement_row(updated)


def delete_requirement(requirement_id: str) -> dict:
    with db() as conn:
        row = conn.execute("SELECT * FROM requirements WHERE id=?", (requirement_id,)).fetchone()
        if row is None:
            raise ValueError("需求不存在")
        conn.execute("DELETE FROM requirements WHERE id=?", (requirement_id,))
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
        descriptions = list(dict.fromkeys([str(target["description"] or ""), *[str(row["description"] or "") for row in sources]]))
        quotes = list(dict.fromkeys([str(target["source_quote"] or ""), *[str(row["source_quote"] or "") for row in sources]]))
        priorities = [str(target["priority"] or "P1"), *[str(row["priority"] or "P1") for row in sources]]
        best_priority = min(priorities, key=lambda item: _REQUIREMENT_PRIORITIES.index(item) if item in _REQUIREMENT_PRIORITIES else 9)
        conn.execute(
            "UPDATE requirements SET description=?, priority=?, source_quote=?, updated_at=? WHERE id=?",
            ("\n\n".join([item for item in descriptions if item]), best_priority, "\n\n".join([item for item in quotes if item]), datetime.now().isoformat(timespec="seconds"), target_id),
        )
        for source in sources:
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
            name = str(item.get("name") or "").strip()
            role = str(item.get("role") or "").strip()
            if name not in allowed_names or role not in ("me", "customer"):
                continue
            normalized.append({"name": name, "role": role})
        if len(normalized) != len(existing) or not any(p["role"] == "me" for p in normalized) or not any(p["role"] == "customer" for p in normalized):
            return None
        analysis = json.loads(row["analysis_json"] or "{}")
        role_map = {p["name"]: ("我" if p["role"] == "me" else "客户") for p in normalized}
        if isinstance(analysis.get("participants"), list):
            for participant in analysis["participants"]:
                if participant.get("name") in role_map:
                    participant["role"] = role_map[participant["name"]]
        customer_name = next((p["name"] for p in normalized if p["role"] == "customer"), row["customer"])
        conn.execute(
            "UPDATE chats SET participants_json=?, analysis_json=?, customer=? WHERE id=?",
            (json.dumps(normalized, ensure_ascii=False), json.dumps(analysis, ensure_ascii=False), customer_name, chat_id),
        )
        conn.execute("UPDATE imports SET customer=? WHERE transcript_id=?", (customer_name, chat_id))
        updated = conn.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
    return row_to_chat(updated)


def _llm_setting_rows() -> dict[str, str]:
    with db() as conn:
        return {
            str(row["key"]): str(row["value"] or "")
            for row in conn.execute("SELECT key,value FROM settings WHERE key LIKE 'llm.%'").fetchall()
        }


def get_llm_config() -> dict:
    rows = _llm_setting_rows()

    def pick(key: str, default: str) -> str:
        value = rows.get(key, "").strip()
        return value or default

    return {
        "baseUrl": pick("llm.base_url", MAAS_BASE_URL).rstrip("/"),
        "apiKey": pick("llm.api_key", MAAS_API_KEY),
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
    with db() as conn:
        for key, value in updates.items():
            conn.execute(
                "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
    return get_llm_config()


APP_SETTING_DEFAULTS = {
    "defaultProject": "",
    "defaultOwner": "王总",
    "autoMatch": True,
    "autoProcess": True,
    "updateIntervalHours": 3,
}


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
        if key in ("autoMatch", "autoProcess"):
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
        if key in ("autoMatch", "autoProcess"):
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


def _llm_open(method: str, url: str, *, api_key: str = "", timeout: int = 30):
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    req = urllib.request.Request(url, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response


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
    try:
        response = _llm_open("GET", f"{base_url}/models", api_key=api_key, timeout=30)
        raw = response.read().decode("utf-8", "replace")
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            return {"status": "error", "error": f"模型接口返回的不是 JSON（HTTP {response.status}）：{raw[:160]}", "models": []}
        models = [str(item.get("id") or "") for item in (body.get("data") or []) if str(item.get("id") or "")]
        models = [m for m in models if m]
        return {"status": "ok", "count": len(models), "models": models}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        return {"status": "error", "error": f"HTTP {exc.code}: {detail}", "models": []}
    except Exception as exc:
        return {"status": "error", "error": str(exc), "models": []}


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
        req = urllib.request.Request(
            base_url + "/chat/completions",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=45) as response:
            body = json.loads(response.read().decode("utf-8"))
        if body.get("choices"):
            return {"status": "ok", "count": 1, "models": [model], "message": "连接成功"}
        return {"status": "error", "error": f"模型返回异常：{str(body)[:300]}", "models": []}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        return {"status": "error", "error": f"HTTP {exc.code}: {detail}", "models": []}
    except Exception as exc:
        return {"status": "error", "error": str(exc), "models": []}


def maas_request(path: str, payload: dict, timeout: int = 600) -> dict:
    config = get_llm_config()
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


def transcribe_audio(audio_bytes: bytes, mime_type: str) -> str:
    """Call qwen3-asr-flash for one short audio chunk."""
    data_uri = f"data:{mime_type or 'audio/mpeg'};base64,{base64.b64encode(audio_bytes).decode()}"
    payload = {
        "model": get_llm_config()["asrModel"],
        "messages": [{"role": "user", "content": [{"type": "input_audio", "input_audio": {"data": data_uri}}]}],
        "stream": False,
        "asr_options": {"language": "zh", "enable_itn": False},
    }
    result = maas_request("/chat/completions", payload, timeout=600)
    choices = result.get("choices") or []
    if not choices:
        raise RuntimeError(f"ASR returned no choices: {result}")
    return str(choices[0].get("message", {}).get("content") or "").strip()


def transcribe_audio_file(path: Path, mime_type: str = "audio/mpeg", progress_cb=None) -> str:
    """Transcribe an arbitrary-length audio file by splitting into 60s MP3 chunks.

    qwen3-asr-flash rejects very long single requests ("The audio is too long"),
    so the local sidecar handles segmentation and concatenation transparently.
    """
    if not FFMPEG:
        return transcribe_audio(path.read_bytes(), mime_type)

    work = DATA_DIR / "tmp" / uuid.uuid4().hex
    work.mkdir(parents=True, exist_ok=True)
    try:
        pattern = work / "chunk-%03d.mp3"
        proc = subprocess.run(
            [
                FFMPEG, "-y", "-i", str(path), "-ac", "1", "-ar", "16000",
                "-b:a", "32k", "-f", "segment", "-segment_time", "60",
                str(pattern),
            ],
            capture_output=True, text=True, timeout=900,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg segment failed: {proc.stderr[-500:]}")
        chunks = sorted(work.glob("chunk-*.mp3"))
        if not chunks:
            raise RuntimeError("ffmpeg produced no audio chunks")
        texts: list[str] = []
        for index, chunk in enumerate(chunks, start=1):
            # Encoders can leave a tiny final fragment; MaaS rejects it as
            # "audio is empty", so skip only near-empty artifacts.
            if chunk.stat().st_size < 2000:
                print(f"[ai-sidecar] chunk {index}/{len(chunks)} skipped (too small)", flush=True)
                continue
            text = transcribe_audio(chunk.read_bytes(), "audio/mpeg").strip()
            if text:
                texts.append(text)
            print(f"[ai-sidecar] chunk {index}/{len(chunks)} -> {len(text)} chars", flush=True)
            if progress_cb:
                progress_cb(index, len(chunks))
        return "\n".join(texts)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def summarize_transcript(transcript: str) -> dict:
    prompt = f"""你是客户沟通纪要助手。请只根据下面的通话转写输出 JSON，不要输出 Markdown。
要求：
1. 不得编造转写中没有的信息；没有提到的字段填“未提及”。
2. 输出严格 JSON，字段固定。
3. 字段格式：
{{
  "oneLine": "",
  "needs": "",
  "budget": "",
  "timeline": "",
  "decisionMakers": "",
  "objections": "",
  "nextActions": "",
  "paymentMethod": ""
}}
转写：
{transcript[:12000]}"""
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
    for key, value in defaults.items():
        if not data.get(key):
            data[key] = value
    data["confidence"] = float(data.get("confidence") or 0.9)
    data["evidenceCount"] = int(data.get("evidenceCount") or 0)
    return data


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


def compress_audio(src: Path, dst: Path) -> Path | None:
    if not FFMPEG:
        return None
    try:
        subprocess.run(
            [FFMPEG, "-y", "-i", str(src), "-ac", "1", "-ar", "16000", "-b:a", "32k", str(dst)],
            capture_output=True, text=True, timeout=300,
        )
        return dst if dst.exists() and dst.stat().st_size > 0 else None
    except Exception:
        return None


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
            "start": round(start / 1000),
            "end": round(end / 1000),
            "speaker": "unknown",
            "text": part,
        })
    return segments


def process_import_real(import_id: str, audio_path: Path, mime_type: str) -> None:
    """Real Sprint 1 pipeline: ffmpeg -> Qwen ASR -> Qwen structured summary."""
    try:
        def progress(value: int) -> None:
            with db() as conn:
                conn.execute("UPDATE imports SET progress=? WHERE id=? AND status='processing'", (value, import_id))

        progress(10)
        chosen = audio_path
        chosen_mime = mime_type or "audio/mpeg"
        if FFMPEG and audio_path.suffix.lower() not in (".mp3", ".m4a"):
            compressed = compress_audio(audio_path, audio_path.with_suffix(".mp3"))
            if compressed:
                chosen = compressed
                chosen_mime = "audio/mpeg"
        progress(25)

        def chunk_progress(index: int, total: int) -> None:
            progress(25 + int(25 * index / max(1, total)))

        transcript_text = transcribe_audio_file(chosen, chosen_mime, chunk_progress)
        if not transcript_text:
            raise RuntimeError("ASR returned empty text")
        progress(55)
        summary = summarize_transcript(transcript_text)
        progress(80)
        duration = probe_duration(chosen) or 0.0
        segments = split_transcript(transcript_text, duration)
        with db() as conn:
            row = conn.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
            if row is None:
                return
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
            conn.execute(
                "UPDATE imports SET progress=100, status='done', transcript_id=? WHERE id=?",
                (transcript_id, import_id),
            )
        insert_requirements_from_audio(import_id, str(row["customer"]), str(row["project"] or "—"), summary, source_time=str(row["imported_at"] or ""))
    except Exception as exc:
        print(f"[ai-sidecar] real pipeline error {import_id}: {exc}", flush=True)
        with db() as conn:
            conn.execute("UPDATE imports SET status='failed', progress=0 WHERE id=?", (import_id,))


def process_import(import_id: str) -> None:
    """Simulate the Sprint 1 pipeline: upload -> transcode -> transcribe -> summarize."""
    try:
        for progress in (20, 40, 60, 80):
            time.sleep(0.55)
            with db() as conn:
                conn.execute("UPDATE imports SET progress=? WHERE id=? AND status='processing'", (progress, import_id))
        time.sleep(0.55)
        with db() as conn:
            row = conn.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
            if row is None:
                return
            transcript_id = row["transcript_id"]
            if transcript_id is None and row["type"] in ("音频", "视频", "聊天记录"):
                transcript_id = "tr-001"
            conn.execute(
                "UPDATE imports SET progress=100, status='done', transcript_id=? WHERE id=?",
                (transcript_id, import_id),
            )
    except Exception as exc:  # pragma: no cover - defensive for local prototype
        print(f"[ai-sidecar] process error {import_id}: {exc}", flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "ClientHubAI/0.1"

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, payload: dict | list, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

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
        if path == "/api/health":
            config = get_llm_config()
            self._json({
                "status": "ok",
                "service": "clienthub-ai-sidecar",
                "mode": "maas" if config["apiKey"] else "mock",
                "asrModel": config["asrModel"],
                "summaryModel": config["summaryModel"],
                "visionModel": config["visionModel"],
                "version": "0.2.0",
            })
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
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            return
        self._json({"error": "not_found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        data = self._read_json()

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
            threading.Thread(target=process_chat_analysis, args=(import_row["id"] if import_row else "", chat_id), daemon=True).start()
            self._json({"status": "started", "chatId": chat_id})
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
            audio_b64 = str(data.get("audioBase64") or "").strip()
            audio_bytes: bytes | None = None
            if audio_b64:
                try:
                    audio_bytes = base64.b64decode(audio_b64)
                except Exception:
                    self._json({"error": "invalid_audio_base64"}, 400)
                    return
            if audio_bytes is not None:
                digest = hashlib.sha256(audio_bytes).hexdigest()
            else:
                digest = hashlib.sha256(f"{file_name}|{data.get('size','')}|{data.get('kind','')}".encode("utf-8")).hexdigest()
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
                        str(data.get("customer") or "待归档"),
                        str(data.get("project") or "—"),
                        "processing",
                        0,
                        now_time(),
                        None,
                        digest,
                    ),
                )
            if saved_path is not None:
                threading.Thread(
                    target=process_import_real,
                    args=(import_id, saved_path, str(data.get("mimeType") or "audio/mpeg")),
                    daemon=True,
                ).start()
            else:
                threading.Thread(target=process_import, args=(import_id,), daemon=True).start()
            self._json({"id": import_id, "status": "processing"}, 201)
            return

        if path == "/api/asr":
            audio_b64 = str(data.get("audioBase64") or "").strip()
            if not audio_b64:
                self._json({"error": "audioBase64_required"}, 400)
                return
            tmp_path: Path | None = None
            try:
                audio = base64.b64decode(audio_b64)
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
                image = base64.b64decode(image_b64)
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
            known = ("张三" in text) or ("会员" in text) or ("小程序" in text)
            import_id = f"imp-{uuid.uuid4().hex[:10]}"
            with db() as conn:
                conn.execute(
                    "INSERT INTO imports (id,file_name,type,size,customer,project,status,progress,imported_at,transcript_id,sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        import_id,
                        f"粘贴文本_{datetime.now().strftime('%Y-%m-%d')}.txt",
                        "聊天记录",
                        f"{len(text)} 字",
                        "张三" if known else "待归档",
                        str(data.get("project") or "—"),
                        "processing",
                        0,
                        now_time(),
                        None,
                        None,
                    ),
                )
            threading.Thread(target=process_import, args=(import_id,), daemon=True).start()
            self._json({"id": import_id, "status": "processing"}, 201)
            return

        self._json({"error": "not_found"}, 404)

    def do_PATCH(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        data = self._read_json()
        parts = [part for part in path.split("/") if part]
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    init_db()
    backfill_requirements()
    # Resume any imports left in "processing" from a previous run.
    with db() as conn:
        pending = conn.execute("SELECT id,type,transcript_id FROM imports WHERE status='processing'").fetchall()
    for row in pending:
        import_id = row["id"]
        if row["type"] == "聊天记录" and str(row["transcript_id"] or "").startswith("chat-"):
            threading.Thread(target=process_chat_analysis, args=(import_id, row["transcript_id"]), daemon=True).start()
        else:
            threading.Thread(target=process_import, args=(import_id,), daemon=True).start()
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
