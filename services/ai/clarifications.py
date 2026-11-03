"""Persistence primitives for customer requirement clarification workbooks."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime


RECORD_STATUSES = {
    "draft",
    "awaiting_confirmation",
    "analyzing",
    "partial",
    "active",
    "completed",
    "failed",
    "archived",
}
QUESTION_STATUSES = {"pending", "asked", "answered", "not_applicable", "deleted"}
QUESTION_PRIORITIES = {"must_confirm", "important", "later"}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:16]}"


def _json(value, default):
    if value in (None, ""):
        return default
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except (TypeError, ValueError):
        return default
    return parsed


def _json_text(value, default):
    parsed = value if value is not None else default
    try:
        return json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ValueError("字段必须是可序列化的 JSON") from exc


def migrate(conn: sqlite3.Connection) -> None:
    """Create the clarification schema without changing existing records."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS clarification_records (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            selected_scope_json TEXT NOT NULL DEFAULT '{}',
            model_snapshot_json TEXT NOT NULL DEFAULT '{}',
            language TEXT NOT NULL DEFAULT 'zh-CN',
            total_batches INTEGER NOT NULL DEFAULT 0,
            completed_batches INTEGER NOT NULL DEFAULT 0,
            error_message TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            archived_at TEXT,
            analysis_completed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS clarification_sources (
            id TEXT PRIMARY KEY,
            record_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_id TEXT NOT NULL DEFAULT '',
            customer_id TEXT NOT NULL DEFAULT '',
            project_id TEXT NOT NULL DEFAULT '',
            display_name TEXT NOT NULL,
            source_kind TEXT NOT NULL,
            content_hash TEXT NOT NULL DEFAULT '',
            text_snapshot TEXT NOT NULL DEFAULT '',
            readable INTEGER NOT NULL DEFAULT 1,
            extraction_error TEXT NOT NULL DEFAULT '',
            occurred_at TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clarification_questions (
            id TEXT PRIMARY KEY,
            record_id TEXT NOT NULL,
            customer_id TEXT NOT NULL DEFAULT '',
            project_id TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '',
            priority TEXT NOT NULL DEFAULT 'must_confirm',
            text TEXT NOT NULL,
            rationale TEXT NOT NULL DEFAULT '',
            conclusion_type TEXT NOT NULL DEFAULT 'gap',
            confidence REAL,
            status TEXT NOT NULL DEFAULT 'pending',
            answer_text TEXT NOT NULL DEFAULT '',
            parent_question_id TEXT,
            generated_from TEXT NOT NULL DEFAULT 'initial',
            asked_at TEXT,
            copied_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clarification_evidence (
            id TEXT PRIMARY KEY,
            question_id TEXT NOT NULL,
            source_snapshot_id TEXT NOT NULL,
            excerpt TEXT NOT NULL,
            source_label TEXT NOT NULL DEFAULT '',
            source_time TEXT,
            source_reference TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS clarification_answers (
            id TEXT PRIMARY KEY,
            question_id TEXT NOT NULL,
            answer_text TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            converted_action_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_clarification_records_status_updated
            ON clarification_records(status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clarification_sources_record
            ON clarification_sources(record_id, customer_id, project_id);
        CREATE INDEX IF NOT EXISTS idx_clarification_questions_record
            ON clarification_questions(record_id, customer_id, project_id, priority, status);
        CREATE INDEX IF NOT EXISTS idx_clarification_evidence_question
            ON clarification_evidence(question_id);
        CREATE INDEX IF NOT EXISTS idx_clarification_answers_question
            ON clarification_answers(question_id, recorded_at DESC);
        """
    )
    source_columns = {row["name"] for row in conn.execute("PRAGMA table_info(clarification_sources)").fetchall()}
    if "analyzed" not in source_columns:
        conn.execute("ALTER TABLE clarification_sources ADD COLUMN analyzed INTEGER NOT NULL DEFAULT 0")
    record_columns = {row["name"] for row in conn.execute("PRAGMA table_info(clarification_records)").fetchall()}
    if "analysis_completed_at" not in record_columns:
        conn.execute("ALTER TABLE clarification_records ADD COLUMN analysis_completed_at TEXT")
    question_columns = {row["name"] for row in conn.execute("PRAGMA table_info(clarification_questions)").fetchall()}
    if "asked_at" not in question_columns:
        conn.execute("ALTER TABLE clarification_questions ADD COLUMN asked_at TEXT")
    if "copied_at" not in question_columns:
        conn.execute("ALTER TABLE clarification_questions ADD COLUMN copied_at TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_clarification_records_analysis_completed ON clarification_records(analysis_completed_at)")


def _source_values(data: dict, *, source_id: str | None = None) -> tuple:
    display_name = str(data.get("displayName") or data.get("name") or "").strip()
    source_type = str(data.get("sourceType") or "communication").strip()
    source_kind = str(data.get("sourceKind") or data.get("type") or source_type).strip()
    if not display_name:
        raise ValueError("资料名称不能为空")
    if not source_type:
        raise ValueError("资料类型不能为空")
    readable = data.get("readable", True)
    if not isinstance(readable, bool):
        raise ValueError("资料可读性必须是布尔值")
    return (
        source_id or _id("clsrc"),
        str(data.get("sourceId") or ""),
        str(data.get("customerId") or data.get("customer") or ""),
        str(data.get("projectId") or data.get("project") or ""),
        display_name[:500],
        source_type[:80],
        source_kind[:80],
        str(data.get("contentHash") or "")[:128],
        str(data.get("textSnapshot") or ""),
        1 if readable else 0,
        str(data.get("extractionError") or "")[:2000],
        str(data.get("occurredAt") or "") or None,
        _now(),
    )


def _record_row(row: sqlite3.Row, *, source_count: int = 0, question_count: int = 0, open_question_count: int = 0) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "status": row["status"],
        "selectedScope": _json(row["selected_scope_json"], {}),
        "modelSnapshot": _json(row["model_snapshot_json"], {}),
        "language": row["language"],
        "totalBatches": int(row["total_batches"] or 0),
        "completedBatches": int(row["completed_batches"] or 0),
        "errorMessage": row["error_message"] or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "archivedAt": row["archived_at"],
        "analysisCompletedAt": row["analysis_completed_at"],
        "sourceCount": int(source_count),
        "questionCount": int(question_count),
        "openQuestionCount": int(open_question_count),
    }


def _source_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "recordId": row["record_id"],
        "sourceType": row["source_type"],
        "sourceId": row["source_id"],
        "customerId": row["customer_id"],
        "projectId": row["project_id"],
        "displayName": row["display_name"],
        "sourceKind": row["source_kind"],
        "contentHash": row["content_hash"],
        "textSnapshot": row["text_snapshot"],
        "readable": bool(row["readable"]),
        "analyzed": bool(row["analyzed"]),
        "extractionError": row["extraction_error"],
        "occurredAt": row["occurred_at"],
        "createdAt": row["created_at"],
    }


def _question_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "recordId": row["record_id"],
        "customerId": row["customer_id"],
        "projectId": row["project_id"],
        "category": row["category"],
        "priority": row["priority"],
        "text": row["text"],
        "rationale": row["rationale"],
        "conclusionType": row["conclusion_type"],
        "confidence": row["confidence"],
        "status": row["status"],
        "answerText": row["answer_text"],
        "parentQuestionId": row["parent_question_id"],
        "generatedFrom": row["generated_from"],
        "askedAt": row["asked_at"],
        "copiedAt": row["copied_at"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _evidence_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "questionId": row["question_id"],
        "sourceSnapshotId": row["source_snapshot_id"],
        "excerpt": row["excerpt"],
        "sourceLabel": row["source_label"],
        "sourceTime": row["source_time"],
        "sourceReference": row["source_reference"],
    }


def _answer_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "questionId": row["question_id"],
        "answerText": row["answer_text"],
        "recordedAt": row["recorded_at"],
        "convertedAction": _json(row["converted_action_json"], None),
    }


def _record_name(data: dict) -> str:
    name = str(data.get("name") or "").strip()
    if name:
        return name[:200]
    scope = data.get("selectedScope") or {}
    if isinstance(scope, dict):
        label = str(scope.get("label") or scope.get("project") or scope.get("customer") or "未归属").strip()
    else:
        label = "未归属"
    return f"{label} · {datetime.now().strftime('%Y-%m-%d')}"


def _validate_record_patch(data: dict) -> None:
    if "status" in data and str(data["status"]) not in RECORD_STATUSES:
        raise ValueError("需求澄清单状态无效")
    if "language" in data and (not isinstance(data["language"], str) or not data["language"].strip() or len(data["language"]) > 32):
        raise ValueError("生成语言无效")
    for key in ("selectedScope", "modelSnapshot"):
        if key in data and not isinstance(data[key], (dict, list)):
            raise ValueError(f"{key} 必须是 JSON 对象或数组")
    for key in ("totalBatches", "completedBatches"):
        if key in data and (not isinstance(data[key], int) or data[key] < 0):
            raise ValueError(f"{key} 必须是非负整数")


def create_record(conn: sqlite3.Connection, data: dict) -> dict:
    if not isinstance(data, dict):
        raise ValueError("需求澄清单参数无效")
    _validate_record_patch(data)
    status = str(data.get("status") or "draft")
    if status != "draft":
        raise ValueError("新建需求澄清单必须从草稿开始")
    now = _now()
    record_id = _id("clr")
    conn.execute(
        """INSERT INTO clarification_records
        (id,name,status,selected_scope_json,model_snapshot_json,language,total_batches,completed_batches,error_message,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            record_id,
            _record_name(data),
            "draft",
            _json_text(data.get("selectedScope") or {}, {}),
            _json_text(data.get("modelSnapshot") or {}, {}),
            str(data.get("language") or "zh-CN"),
            int(data.get("totalBatches") or 0),
            int(data.get("completedBatches") or 0),
            str(data.get("errorMessage") or "")[:2000],
            now,
            now,
        ),
    )
    sources = data.get("sources") or []
    if not isinstance(sources, list):
        raise ValueError("sources 必须是数组")
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("资料项无效")
        values = _source_values(source)
        conn.execute(
            """INSERT INTO clarification_sources
            (id,record_id,source_id,customer_id,project_id,display_name,source_type,source_kind,content_hash,text_snapshot,readable,extraction_error,occurred_at,created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (values[0], record_id, *values[1:]),
        )
    return get_record(conn, record_id)


def replace_sources(conn: sqlite3.Connection, record_id: str, sources: list[dict]) -> dict | None:
    """Replace the selected material snapshots for a draft workbook."""
    if not isinstance(sources, list):
        raise ValueError("sources 必须是数组")
    record = conn.execute("SELECT status FROM clarification_records WHERE id=?", (record_id,)).fetchone()
    if record is None:
        return None
    if record["status"] not in {"draft", "awaiting_confirmation"}:
        raise ValueError("只有草稿或待确认的需求澄清单可以调整资料")
    values = []
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("资料项无效")
        values.append(_source_values(source))
    conn.execute("DELETE FROM clarification_sources WHERE record_id=?", (record_id,))
    conn.executemany(
        """INSERT INTO clarification_sources
        (id,record_id,source_id,customer_id,project_id,display_name,source_type,source_kind,content_hash,text_snapshot,readable,extraction_error,occurred_at,created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [(item[0], record_id, *item[1:]) for item in values],
    )
    now = _now()
    conn.execute("UPDATE clarification_records SET updated_at=? WHERE id=?", (now, record_id))
    return get_record(conn, record_id)


def append_sources(conn: sqlite3.Connection, record_id: str, sources: list[dict]) -> dict | None:
    """Append new source snapshots without changing previously analyzed sources."""
    if not isinstance(sources, list):
        raise ValueError("sources 必须是数组")
    record = conn.execute("SELECT status FROM clarification_records WHERE id=?", (record_id,)).fetchone()
    if record is None:
        return None
    if record["status"] in {"draft", "awaiting_confirmation", "archived"}:
        raise ValueError("只有已生成或未完成的需求澄清单可以追加资料")
    existing = conn.execute("SELECT source_id,content_hash,display_name FROM clarification_sources WHERE record_id=?", (record_id,)).fetchall()
    existing_keys = {(str(row["source_id"] or ""), str(row["content_hash"] or ""), str(row["display_name"] or "")) for row in existing}
    added = 0
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("资料项无效")
        values = _source_values(source)
        key = (values[1], values[7], values[4])
        if key in existing_keys:
            continue
        conn.execute(
            """INSERT INTO clarification_sources
            (id,record_id,source_id,customer_id,project_id,display_name,source_type,source_kind,content_hash,text_snapshot,readable,extraction_error,occurred_at,created_at,analyzed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
            (values[0], record_id, *values[1:]),
        )
        existing_keys.add(key)
        added += 1
    if added:
        conn.execute("UPDATE clarification_records SET status='active',total_batches=0,completed_batches=0,error_message='',updated_at=? WHERE id=?", (_now(), record_id))
    return get_record(conn, record_id)


def append_questions(conn: sqlite3.Connection, record_id: str, questions: list[dict], *, generated_from: str = "initial") -> int:
    """Persist a validated batch and merge exact duplicate questions with new evidence."""
    if not isinstance(questions, list):
        raise ValueError("questions 必须是数组")
    if conn.execute("SELECT 1 FROM clarification_records WHERE id=?", (record_id,)).fetchone() is None:
        raise ValueError("需求澄清单不存在")
    inserted = 0
    now = _now()
    for item in questions:
        if not isinstance(item, dict):
            raise ValueError("问题项无效")
        text = str(item.get("text") or "").strip()
        if not text:
            raise ValueError("问题文本不能为空")
        priority = str(item.get("priority") or "must_confirm").strip()
        if priority not in QUESTION_PRIORITIES:
            raise ValueError("问题优先级无效")
        customer_id = str(item.get("customerId") or "")[:200]
        project_id = str(item.get("projectId") or "")[:200]
        existing = conn.execute(
            "SELECT * FROM clarification_questions WHERE record_id=? AND customer_id=? AND project_id=? AND text=? AND status<>'deleted' LIMIT 1",
            (record_id, customer_id, project_id, text[:2000]),
        ).fetchone()
        if existing is None:
            question_id = _id("clq")
            conn.execute(
                """INSERT INTO clarification_questions
                (id,record_id,customer_id,project_id,category,priority,text,rationale,conclusion_type,confidence,status,answer_text,parent_question_id,generated_from,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    question_id, record_id, customer_id, project_id,
                    str(item.get("category") or "")[:120], priority, text[:2000],
                    str(item.get("rationale") or "")[:2000], str(item.get("conclusionType") or "gap")[:80],
                    float(item["confidence"]) if isinstance(item.get("confidence"), (int, float)) else None,
                    "pending", "", str(item.get("parentQuestionId") or "") or None, generated_from[:80], now, now,
                ),
            )
            inserted += 1
        else:
            question_id = existing["id"]
        for evidence in item.get("evidence") or []:
            if not isinstance(evidence, dict):
                continue
            excerpt = str(evidence.get("excerpt") or "").strip()
            if not excerpt:
                continue
            source_snapshot_id = str(evidence.get("sourceSnapshotId") or "")
            source_label = str(evidence.get("sourceLabel") or "")[:500]
            source_reference = str(evidence.get("sourceReference") or "")[:500]
            exists = conn.execute(
                "SELECT 1 FROM clarification_evidence WHERE question_id=? AND source_snapshot_id=? AND excerpt=? LIMIT 1",
                (question_id, source_snapshot_id, excerpt[:4000]),
            ).fetchone()
            if exists is None:
                conn.execute(
                    """INSERT INTO clarification_evidence
                    (id,question_id,source_snapshot_id,excerpt,source_label,source_time,source_reference)
                    VALUES (?,?,?,?,?,?,?)""",
                    (
                        _id("cle"), question_id, source_snapshot_id, excerpt[:4000], source_label,
                        str(evidence.get("sourceTime") or "") or None, source_reference,
                    ),
                )
    conn.execute("UPDATE clarification_records SET updated_at=? WHERE id=?", (now, record_id))
    _sync_record_status(conn, record_id)
    return inserted


def _question_detail(conn: sqlite3.Connection, question_id: str) -> dict | None:
    row = conn.execute("SELECT * FROM clarification_questions WHERE id=?", (question_id,)).fetchone()
    if row is None:
        return None
    item = _question_row(row)
    item["evidence"] = [_evidence_row(evidence) for evidence in conn.execute("SELECT * FROM clarification_evidence WHERE question_id=? ORDER BY id", (question_id,)).fetchall()]
    item["answers"] = [_answer_row(answer) for answer in conn.execute("SELECT * FROM clarification_answers WHERE question_id=? ORDER BY recorded_at, rowid", (question_id,)).fetchall()]
    return item


def create_question(conn: sqlite3.Connection, record_id: str, data: dict) -> dict | None:
    if not isinstance(data, dict):
        raise ValueError("问题参数无效")
    if conn.execute("SELECT 1 FROM clarification_records WHERE id=?", (record_id,)).fetchone() is None:
        return None
    text = str(data.get("text") or "").strip()
    if not text:
        raise ValueError("问题文本不能为空")
    priority = str(data.get("priority") or "must_confirm").strip()
    if priority not in QUESTION_PRIORITIES:
        raise ValueError("问题优先级无效")
    now = _now()
    question_id = _id("clq")
    conn.execute(
        """INSERT INTO clarification_questions
        (id,record_id,customer_id,project_id,category,priority,text,rationale,conclusion_type,confidence,status,answer_text,parent_question_id,generated_from,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            question_id, record_id, str(data.get("customerId") or "")[:200], str(data.get("projectId") or "")[:200],
            str(data.get("category") or "业务目标/指标")[:120], priority, text[:2000], str(data.get("rationale") or "")[:2000],
            str(data.get("conclusionType") or "custom")[:80], None, "pending", "", None, "custom", now, now,
        ),
    )
    conn.execute("UPDATE clarification_records SET updated_at=? WHERE id=?", (now, record_id))
    _sync_record_status(conn, record_id)
    return _question_detail(conn, question_id)


def update_question(conn: sqlite3.Connection, question_id: str, data: dict) -> dict | None:
    if not isinstance(data, dict):
        raise ValueError("问题参数无效")
    old = conn.execute("SELECT * FROM clarification_questions WHERE id=?", (question_id,)).fetchone()
    if old is None:
        return None
    status = str(data.get("status", old["status"]))
    if status not in QUESTION_STATUSES:
        raise ValueError("问题状态无效")
    priority = str(data.get("priority", old["priority"]))
    if priority not in QUESTION_PRIORITIES:
        raise ValueError("问题优先级无效")
    text = str(data.get("text", old["text"])).strip()
    if not text:
        raise ValueError("问题文本不能为空")
    now = _now()
    asked_at = old["asked_at"] or (now if status in {"asked", "answered"} else None)
    conn.execute(
        """UPDATE clarification_questions SET customer_id=?,project_id=?,category=?,priority=?,text=?,rationale=?,status=?,asked_at=?,updated_at=? WHERE id=?""",
        (
            str(data.get("customerId", old["customer_id"]))[:200], str(data.get("projectId", old["project_id"]))[:200],
            str(data.get("category", old["category"]))[:120], priority, text[:2000],
            str(data.get("rationale", old["rationale"]))[:2000], status, asked_at, now, question_id,
        ),
    )
    conn.execute("UPDATE clarification_records SET updated_at=? WHERE id=?", (now, old["record_id"]))
    _sync_record_status(conn, old["record_id"])
    return _question_detail(conn, question_id)


def _sync_record_status(conn: sqlite3.Connection, record_id: str) -> None:
    """Complete a record only after every visible question has a conclusion."""
    row = conn.execute("SELECT status FROM clarification_records WHERE id=?", (record_id,)).fetchone()
    if row is None or row["status"] in {"draft", "awaiting_confirmation", "analyzing", "partial", "failed", "archived"}:
        return
    open_count = conn.execute(
        "SELECT COUNT(*) FROM clarification_questions WHERE record_id=? AND status IN ('pending','asked')",
        (record_id,),
    ).fetchone()[0]
    total_question_count = conn.execute(
        "SELECT COUNT(*) FROM clarification_questions WHERE record_id=?",
        (record_id,),
    ).fetchone()[0]
    next_status = "completed" if total_question_count > 0 and open_count == 0 else "active"
    if row["status"] != next_status:
        conn.execute("UPDATE clarification_records SET status=?,updated_at=? WHERE id=?", (next_status, _now(), record_id))


def record_question_answer(conn: sqlite3.Connection, question_id: str, answer_text: str, *, status: str = "answered") -> dict | None:
    """Append an answer snapshot and update the question's current conclusion."""
    answer_text = str(answer_text or "").strip()
    if not answer_text:
        raise ValueError("甲方回答不能为空")
    if status not in {"asked", "answered"}:
        raise ValueError("回答状态无效")
    question = conn.execute("SELECT * FROM clarification_questions WHERE id=? AND status<>'deleted'", (question_id,)).fetchone()
    if question is None:
        return None
    now = _now()
    answer_id = _id("cla")
    conn.execute(
        "INSERT INTO clarification_answers(id,question_id,answer_text,recorded_at,converted_action_json) VALUES (?,?,?,?,NULL)",
        (answer_id, question_id, answer_text[:8000], now),
    )
    conn.execute(
        "UPDATE clarification_questions SET answer_text=?,status=?,asked_at=COALESCE(asked_at,?),updated_at=? WHERE id=?",
        (answer_text[:8000], status, now, now, question_id),
    )
    conn.execute("UPDATE clarification_records SET updated_at=? WHERE id=?", (now, question["record_id"]))
    _sync_record_status(conn, question["record_id"])
    return _question_detail(conn, question_id)


def mark_answer_converted(conn: sqlite3.Connection, question_id: str, action: dict) -> dict | None:
    """Save the confirmed write-back action on the latest answer snapshot."""
    question = conn.execute("SELECT record_id FROM clarification_questions WHERE id=?", (question_id,)).fetchone()
    if question is None:
        return None
    answer = conn.execute("SELECT id FROM clarification_answers WHERE question_id=? ORDER BY recorded_at DESC, rowid DESC LIMIT 1", (question_id,)).fetchone()
    if answer is None:
        return None
    conn.execute("UPDATE clarification_answers SET converted_action_json=? WHERE id=?", (_json_text(action, {}), answer["id"]))
    conn.execute("UPDATE clarification_records SET updated_at=? WHERE id=?", (_now(), question["record_id"]))
    return _question_detail(conn, question_id)


def duplicate_record(conn: sqlite3.Connection, record_id: str) -> dict | None:
    """Copy only the question structure into a new draft."""
    source = conn.execute("SELECT * FROM clarification_records WHERE id=?", (record_id,)).fetchone()
    if source is None:
        return None
    now = _now()
    new_id = _id("clr")
    conn.execute(
        """INSERT INTO clarification_records
        (id,name,status,selected_scope_json,model_snapshot_json,language,total_batches,completed_batches,error_message,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            new_id, f"{source['name']} · 复制", "draft", "{}", source["model_snapshot_json"],
            source["language"], 0, 0, "", now, now,
        ),
    )
    for question in conn.execute("SELECT * FROM clarification_questions WHERE record_id=? AND status<>'deleted' ORDER BY created_at,id", (record_id,)).fetchall():
        conn.execute(
            """INSERT INTO clarification_questions
            (id,record_id,customer_id,project_id,category,priority,text,rationale,conclusion_type,confidence,status,answer_text,parent_question_id,generated_from,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                _id("clq"), new_id, "", "", question["category"], question["priority"], question["text"],
                question["rationale"], question["conclusion_type"], question["confidence"], "pending", "", None, "copied", now, now,
            ),
        )
    return get_record(conn, new_id)


def _record_counts(conn: sqlite3.Connection, record_id: str) -> tuple[int, int, int]:
    source_count = conn.execute("SELECT COUNT(*) FROM clarification_sources WHERE record_id=?", (record_id,)).fetchone()[0]
    question_count = conn.execute("SELECT COUNT(*) FROM clarification_questions WHERE record_id=? AND status<>'deleted'", (record_id,)).fetchone()[0]
    open_question_count = conn.execute(
        "SELECT COUNT(*) FROM clarification_questions WHERE record_id=? AND status IN ('pending','asked')",
        (record_id,),
    ).fetchone()[0]
    return source_count, question_count, open_question_count


def record_question_copies(conn: sqlite3.Connection, record_id: str, question_ids: list[str]) -> int | None:
    if not isinstance(question_ids, list):
        raise ValueError("questionIds 必须是数组")
    if len(question_ids) > 10000:
        raise ValueError("一次最多记录 10000 个问题")
    if conn.execute("SELECT 1 FROM clarification_records WHERE id=?", (record_id,)).fetchone() is None:
        return None
    ids = list(dict.fromkeys(str(question_id) for question_id in question_ids if str(question_id)))
    if not ids:
        return 0
    copied = 0
    for start in range(0, len(ids), 900):
        batch = ids[start:start + 900]
        placeholders = ",".join("?" for _ in batch)
        cursor = conn.execute(
            f"""UPDATE clarification_questions SET copied_at=?
            WHERE record_id=? AND id IN ({placeholders})
              AND generated_from IN ('initial','incremental','followup')
              AND status NOT IN ('deleted','not_applicable') AND copied_at IS NULL""",
            [_now(), record_id, *batch],
        )
        copied += cursor.rowcount
    return copied


def baseline_metrics(conn: sqlite3.Connection, limit: int = 10) -> dict:
    completed_count = int(conn.execute(
        "SELECT COUNT(*) FROM clarification_records WHERE analysis_completed_at IS NOT NULL"
    ).fetchone()[0])
    rows = conn.execute(
        """SELECT id,name,analysis_completed_at FROM clarification_records
        WHERE analysis_completed_at IS NOT NULL
        ORDER BY analysis_completed_at,created_at,id LIMIT ?""",
        (limit,),
    ).fetchall()
    ids = [row["id"] for row in rows]
    questions_by_record = {record_id: [] for record_id in ids}
    if ids:
        placeholders = ",".join("?" for _ in ids)
        for question in conn.execute(
            f"""SELECT record_id,id,status,asked_at,copied_at FROM clarification_questions
            WHERE record_id IN ({placeholders})
              AND generated_from IN ('initial','incremental','followup')""",
            ids,
        ).fetchall():
            questions_by_record[question["record_id"]].append(question)

    analyses = []
    for row in rows:
        questions = questions_by_record[row["id"]]
        generated = len(questions)
        retained = sum(question["status"] != "deleted" for question in questions)
        copied = sum(bool(question["copied_at"]) for question in questions)
        asked = sum(bool(question["asked_at"]) for question in questions)
        engaged = sum(
            question["status"] != "deleted" or bool(question["copied_at"]) or bool(question["asked_at"])
            for question in questions
        )
        analyses.append({
            "id": row["id"],
            "name": row["name"],
            "completedAt": row["analysis_completed_at"],
            "generatedCount": generated,
            "retainedCount": retained,
            "copiedCount": copied,
            "askedCount": asked,
            "engagedCount": engaged,
        })

    totals = {
        key: sum(item[key] for item in analyses)
        for key in ("generatedCount", "retainedCount", "copiedCount", "askedCount", "engagedCount")
    }
    return {
        "limit": limit,
        "completedAnalysisCount": completed_count,
        "baselineCount": len(analyses),
        "ready": completed_count >= limit,
        **totals,
        "engagementRate": totals["engagedCount"] / totals["generatedCount"] if totals["generatedCount"] else None,
        "analyses": analyses,
    }


def list_records(conn: sqlite3.Connection, filters: dict | None = None) -> list[dict]:
    filters = filters or {}
    where = ["1=1"]
    params: list[str] = []
    include_archived = bool(filters.get("includeArchived"))
    if not include_archived:
        where.append("r.status <> 'archived'")
    status = str(filters.get("status") or "").strip()
    if status:
        where.append("r.status = ?")
        params.append(status)
    customer = str(filters.get("customerId") or filters.get("customer") or "").strip()
    if customer:
        where.append("(EXISTS (SELECT 1 FROM clarification_sources s WHERE s.record_id=r.id AND s.customer_id=?) OR EXISTS (SELECT 1 FROM clarification_questions q WHERE q.record_id=r.id AND q.customer_id=? AND q.status<>'deleted'))")
        params.extend([customer, customer])
    project = str(filters.get("projectId") or filters.get("project") or "").strip()
    if project:
        where.append("(EXISTS (SELECT 1 FROM clarification_sources s WHERE s.record_id=r.id AND s.project_id=?) OR EXISTS (SELECT 1 FROM clarification_questions q WHERE q.record_id=r.id AND q.project_id=? AND q.status<>'deleted'))")
        params.extend([project, project])
    rows = conn.execute(
        "SELECT r.* FROM clarification_records r WHERE " + " AND ".join(where) + " ORDER BY r.updated_at DESC, r.created_at DESC",
        params,
    ).fetchall()
    result = []
    for row in rows:
        counts = _record_counts(conn, row["id"])
        item = _record_row(row, source_count=counts[0], question_count=counts[1], open_question_count=counts[2])
        source_rows = conn.execute("SELECT customer_id,project_id FROM clarification_sources WHERE record_id=? UNION SELECT customer_id,project_id FROM clarification_questions WHERE record_id=? AND status<>'deleted'", (row["id"], row["id"])).fetchall()
        item["customers"] = sorted({str(source["customer_id"]) for source in source_rows if source["customer_id"]})
        item["projects"] = sorted({str(source["project_id"]) for source in source_rows if source["project_id"]})
        result.append(item)
    return result


def get_record(conn: sqlite3.Connection, record_id: str) -> dict | None:
    row = conn.execute("SELECT * FROM clarification_records WHERE id=?", (record_id,)).fetchone()
    if row is None:
        return None
    counts = _record_counts(conn, record_id)
    result = _record_row(row, source_count=counts[0], question_count=counts[1], open_question_count=counts[2])
    result["sources"] = [_source_row(item) for item in conn.execute("SELECT * FROM clarification_sources WHERE record_id=? ORDER BY created_at, id", (record_id,)).fetchall()]
    questions = []
    for question in conn.execute("SELECT * FROM clarification_questions WHERE record_id=? AND status<>'deleted' ORDER BY CASE priority WHEN 'must_confirm' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, created_at, id", (record_id,)).fetchall():
        item = _question_row(question)
        item["evidence"] = [_evidence_row(evidence) for evidence in conn.execute("SELECT * FROM clarification_evidence WHERE question_id=? ORDER BY id", (question["id"],)).fetchall()]
        item["answers"] = [_answer_row(answer) for answer in conn.execute("SELECT * FROM clarification_answers WHERE question_id=? ORDER BY recorded_at, rowid", (question["id"],)).fetchall()]
        questions.append(item)
    result["questions"] = questions
    return result


def update_record(conn: sqlite3.Connection, record_id: str, data: dict) -> dict | None:
    if not isinstance(data, dict):
        raise ValueError("需求澄清单参数无效")
    _validate_record_patch(data)
    old = conn.execute("SELECT * FROM clarification_records WHERE id=?", (record_id,)).fetchone()
    if old is None:
        return None
    values = {
        "name": str(data.get("name", old["name"])).strip()[:200],
        "status": str(data.get("status", old["status"])),
        "selected_scope_json": _json_text(data.get("selectedScope", _json(old["selected_scope_json"], {})), {}),
        "model_snapshot_json": _json_text(data.get("modelSnapshot", _json(old["model_snapshot_json"], {})), {}),
        "language": str(data.get("language", old["language"])),
        "total_batches": int(data.get("totalBatches", old["total_batches"] or 0)),
        "completed_batches": int(data.get("completedBatches", old["completed_batches"] or 0)),
        "error_message": str(data.get("errorMessage", old["error_message"] or ""))[:2000],
    }
    if not values["name"]:
        raise ValueError("需求澄清单名称不能为空")
    if values["completed_batches"] > values["total_batches"]:
        raise ValueError("已完成批次不能超过总批次")
    archived_at = old["archived_at"]
    if values["status"] == "archived":
        archived_at = archived_at or _now()
    elif values["status"] != "archived":
        archived_at = None
    updated_at = _now()
    conn.execute(
        """UPDATE clarification_records SET name=?,status=?,selected_scope_json=?,model_snapshot_json=?,language=?,
        total_batches=?,completed_batches=?,error_message=?,updated_at=?,archived_at=? WHERE id=?""",
        (
            values["name"], values["status"], values["selected_scope_json"], values["model_snapshot_json"], values["language"],
            values["total_batches"], values["completed_batches"], values["error_message"], updated_at, archived_at, record_id,
        ),
    )
    return get_record(conn, record_id)


def delete_record(conn: sqlite3.Connection, record_id: str) -> bool:
    if conn.execute("SELECT 1 FROM clarification_records WHERE id=?", (record_id,)).fetchone() is None:
        return False
    question_ids = [row[0] for row in conn.execute("SELECT id FROM clarification_questions WHERE record_id=?", (record_id,)).fetchall()]
    if question_ids:
        placeholders = ",".join("?" for _ in question_ids)
        conn.execute(f"DELETE FROM clarification_evidence WHERE question_id IN ({placeholders})", question_ids)
        conn.execute(f"DELETE FROM clarification_answers WHERE question_id IN ({placeholders})", question_ids)
    conn.execute("DELETE FROM clarification_questions WHERE record_id=?", (record_id,))
    conn.execute("DELETE FROM clarification_sources WHERE record_id=?", (record_id,))
    conn.execute("DELETE FROM clarification_records WHERE id=?", (record_id,))
    return True
