"""Local sales follow-up, deliberately separate from the AI processing queue."""

import json
import math
import re
import sqlite3
import uuid
from datetime import date, datetime, timedelta


def migrate(conn: sqlite3.Connection) -> None:
    for table, column, declaration in (
        ("imports", "owner", "TEXT NOT NULL DEFAULT ''"),
        ("requirements", "owner", "TEXT NOT NULL DEFAULT ''"),
        ("requirements", "due_date", "TEXT NOT NULL DEFAULT ''"),
    ):
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS todos (
            id TEXT PRIMARY KEY, customer TEXT NOT NULL, project TEXT NOT NULL DEFAULT '—',
            requirement_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
            owner TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'todo', source_type TEXT NOT NULL DEFAULT 'manual',
            source_id TEXT NOT NULL DEFAULT '', source_quote TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_todos_customer_status ON todos(customer,status,due_date);
        CREATE INDEX IF NOT EXISTS idx_todos_requirement ON todos(requirement_id);
        CREATE TABLE IF NOT EXISTS customer_match_audits (
            id TEXT PRIMARY KEY, import_id TEXT NOT NULL,
            suggested_customer TEXT NOT NULL DEFAULT '',
            confirmed_customer TEXT NOT NULL DEFAULT '',
            method TEXT NOT NULL DEFAULT 'manual',
            is_correct INTEGER,
            created_at TEXT NOT NULL,
            confirmed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_customer_match_audits_metrics ON customer_match_audits(method,confirmed_at,is_correct);
    """)
    # The sales migration is also used against small legacy databases during
    # upgrade. Create optional performance indexes only when their host table
    # already exists.
    tables = {row["name"] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    optional_indexes = {
        "todos": ("CREATE INDEX IF NOT EXISTS idx_todos_metrics ON todos(source_id,source_type,created_at)", {"source_id", "source_type", "created_at"}),
        "tasks": ("CREATE INDEX IF NOT EXISTS idx_tasks_metrics ON tasks(kind,status,created_at,finished_at)", {"kind", "status", "created_at", "finished_at"}),
        "requirements": ("CREATE INDEX IF NOT EXISTS idx_requirements_metrics ON requirements(source_type,status,created_at,updated_at)", {"source_type", "status", "created_at", "updated_at"}),
        "imports": ("CREATE INDEX IF NOT EXISTS idx_imports_metrics ON imports(status,imported_at,customer,project)", {"status", "imported_at", "customer", "project"}),
        "chats": ("CREATE INDEX IF NOT EXISTS idx_chats_metrics ON chats(imported_at,ended_at,customer,project)", {"imported_at", "ended_at", "customer", "project"}),
        "transcripts": ("CREATE INDEX IF NOT EXISTS idx_transcripts_metrics ON transcripts(imported_at,customer,project)", {"imported_at", "customer", "project"}),
    }
    for table, (statement, required_columns) in optional_indexes.items():
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")} if table in tables else set()
        if required_columns <= columns:
            conn.execute(statement)
    if "todos" in tables and {row["name"] for row in conn.execute("PRAGMA table_info(todos)")} >= {"created_at", "source_id"}:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos(created_at,source_id)")


def _metric(value, numerator: int, denominator: int, *, unit: str, note: str = "") -> dict:
    return {
        "value": value,
        "numerator": int(numerator),
        "denominator": int(denominator),
        "unit": unit,
        "available": denominator > 0,
        "note": note,
    }


def _ratio_metric(numerator: int, denominator: int, *, note: str = "") -> dict:
    return _metric(round(numerator / denominator, 4) if denominator else None, numerator, denominator, unit="ratio", note=note)


def _metric_datetime(value) -> datetime | None:
    raw = str(value or "").strip()
    # Historical demo records sometimes contain only HH:MM. They cannot be
    # placed in a reporting window without guessing their date.
    if not raw or re.fullmatch(r"\d{1,2}:\d{2}", raw):
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed


def _p95(values: list[float]) -> float | None:
    if not values:
        return None
    values = sorted(values)
    return round(values[max(0, math.ceil(len(values) * 0.95) - 1)], 1)


def metrics(conn: sqlite3.Connection, days: int = 7, now: datetime | None = None) -> dict:
    """Return observable product metrics for a bounded reporting window.

    Metrics intentionally expose sample sizes. A missing sample is represented
    by null instead of zero so the UI cannot confuse "not measured" with
    "measured and unsuccessful".
    """
    window_days = max(1, min(int(days or 7), 90))
    current = now or datetime.now()
    window_start = current - timedelta(days=window_days)
    window_key = window_start.date().isoformat()

    imports = conn.execute(
        "SELECT status,imported_at,customer,project FROM imports WHERE imported_at >= ?",
        (window_key,),
    ).fetchall()
    terminal_imports = [
        row for row in imports
        if row["status"] in ("done", "failed", "cancelled")
        and (parsed := _metric_datetime(row["imported_at"])) is not None
        and parsed >= window_start
    ]
    import_success = sum(row["status"] == "done" for row in terminal_imports)

    parse_kinds = ("import", "import_real", "import_document", "chat_analysis")
    task_rows = conn.execute(
        "SELECT kind,status,created_at,finished_at FROM tasks WHERE kind IN (?,?,?,?) AND created_at >= ?",
        (*parse_kinds, window_key),
    ).fetchall()
    terminal_tasks = [
        row for row in task_rows
        if row["status"] in ("succeeded", "failed", "cancelled")
        and (parsed := _metric_datetime(row["created_at"])) is not None
        and parsed >= window_start
    ]
    parse_success = sum(row["status"] == "succeeded" for row in terminal_tasks)
    durations = []
    for row in terminal_tasks:
        started = _metric_datetime(row["created_at"])
        finished = _metric_datetime(row["finished_at"])
        if started and finished and finished >= started:
            durations.append((finished - started).total_seconds())

    has_match_audits = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='customer_match_audits'"
    ).fetchone()
    match_rows = conn.execute(
        "SELECT is_correct,confirmed_at FROM customer_match_audits WHERE method='auto' AND confirmed_at >= ? AND is_correct IS NOT NULL",
        (window_key,),
    ).fetchall() if has_match_audits else []
    match_rows = [
        row for row in match_rows
        if (parsed := _metric_datetime(row["confirmed_at"])) is not None and parsed >= window_start
    ]
    match_correct = sum(int(row["is_correct"]) == 1 for row in match_rows)

    requirement_rows = conn.execute(
        "SELECT source_type,status,created_at FROM requirements WHERE source_type<>'manual' AND created_at >= ?",
        (window_key,),
    ).fetchall()
    generated_requirements = [
        row for row in requirement_rows
        if (parsed := _metric_datetime(row["created_at"])) is not None and parsed >= window_start
    ]
    actionable_requirements = sum(row["status"] in ("已确认", "已报价", "已实现") for row in generated_requirements)

    contact_times: dict[str, datetime] = {}
    for row in conn.execute("SELECT id,imported_at FROM imports").fetchall():
        parsed = _metric_datetime(row["imported_at"])
        if parsed:
            contact_times[str(row["id"])] = parsed
    for row in conn.execute("SELECT id,imported_at FROM transcripts").fetchall():
        parsed = _metric_datetime(row["imported_at"])
        if parsed:
            contact_times[str(row["id"])] = parsed
    for row in conn.execute("SELECT id,imported_at,ended_at FROM chats").fetchall():
        parsed = _metric_datetime(row["ended_at"]) or _metric_datetime(row["imported_at"])
        if parsed:
            contact_times[str(row["id"])] = parsed
    latency_values = []
    for row in conn.execute(
        "SELECT source_id,created_at FROM todos WHERE source_id<>'' AND created_at >= ?",
        (window_key,),
    ).fetchall():
        created = _metric_datetime(row["created_at"])
        contact = contact_times.get(str(row["source_id"]))
        if not created or not contact or created < window_start or created < contact:
            continue
        latency_values.append((created - contact).total_seconds() / 60)

    active_customers: set[str] = set()
    active_projects: set[tuple[str, str]] = set()
    for table, timestamp_column in (("imports", "imported_at"), ("transcripts", "imported_at"), ("chats", "imported_at")):
        rows = conn.execute(f"SELECT customer,project,{timestamp_column} AS occurred_at FROM {table} WHERE {timestamp_column} >= ?", (window_key,)).fetchall()
        for row in rows:
            occurred = _metric_datetime(row["occurred_at"])
            customer = str(row["customer"] or "").strip()
            project = str(row["project"] or "").strip()
            if not occurred or occurred < window_start or not customer or customer in ("待归档", "待确认"):
                continue
            active_customers.add(customer)
            if project and project != "—":
                active_projects.add((customer, project))

    return {
        "windowDays": window_days,
        "windowStart": window_start.date().isoformat(),
        "generatedAt": current.isoformat(timespec="seconds"),
        "importsSuccessRate": _ratio_metric(import_success, len(terminal_imports), note="仅统计已完成、失败或取消的导入"),
        "parseCompletionRate": _ratio_metric(parse_success, len(terminal_tasks), note="仅统计导入与聊天解析任务"),
        "parseP95Seconds": _metric(_p95(durations), len(durations), len(durations), unit="seconds", note="基于任务创建到完成的墙钟时间"),
        "customerMatchAccuracy": _ratio_metric(match_correct, len(match_rows), note="需要自动建议被人工确认的样本；当前人工归档不计入"),
        "requirementEffectiveness": _ratio_metric(actionable_requirements, len(generated_requirements), note="需求状态进入已确认、已报价或已实现"),
        "nextActionLatencyMinutes": _metric(round(sum(latency_values) / len(latency_values), 1) if latency_values else None, len(latency_values), len(latency_values), unit="minutes", note="可解析沟通日期且已有来源待办的平均耗时"),
        "weeklyActiveCustomers": _metric(len(active_customers), len(active_customers), len(active_customers), unit="count", note="窗口内发生导入、转写或聊天的客户数"),
        "weeklyActiveProjects": _metric(len(active_projects), len(active_projects), len(active_projects), unit="count", note="窗口内发生导入、转写或聊天的项目数"),
    }


def due_date(value) -> str:
    value = str(value or "").strip()
    if value and date.fromisoformat(value).isoformat() != value:
        raise ValueError("截止时间须为 YYYY-MM-DD")
    return value


def todo_row(row) -> dict:
    return {"id": row["id"], "customer": row["customer"], "project": row["project"],
            "requirementId": row["requirement_id"], "title": row["title"],
            "owner": row["owner"], "dueDate": row["due_date"], "status": row["status"],
            "sourceType": row["source_type"], "sourceId": row["source_id"],
            "sourceQuote": row["source_quote"], "createdAt": row["created_at"],
            "updatedAt": row["updated_at"], "completedAt": row["completed_at"]}


def list_todos(conn, customer="") -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM todos WHERE (?='' OR customer=?) ORDER BY "
        "CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END, "
        "CASE WHEN due_date='' THEN 1 ELSE 0 END, due_date, created_at DESC",
        (customer, customer),
    ).fetchall()
    return [todo_row(row) for row in rows]


def save_todo(conn, data, todo_id="") -> dict | None:
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    old = conn.execute("SELECT * FROM todos WHERE id=?", (todo_id,)).fetchone() if todo_id else None
    if todo_id and old is None:
        return None
    value = {**(todo_row(old) if old else {}), **data}
    requirement_id = str(value.get("requirementId") or "")
    if requirement_id:
        req = conn.execute("SELECT * FROM requirements WHERE id=?", (requirement_id,)).fetchone()
        if req is None:
            raise ValueError("关联需求不存在")
        value.update(customer=req["customer"], project=req["project"])
        if not old or requirement_id != old["requirement_id"]:
            value.update(sourceType=req["source_type"], sourceId=req["source_id"], sourceQuote=req["source_quote"])
        if not old:
            value.setdefault("owner", req["owner"])
            value.setdefault("dueDate", req["due_date"])
    customer = str(value.get("customer") or "").strip()
    if not conn.execute("SELECT 1 FROM customers WHERE name=?", (customer,)).fetchone():
        raise ValueError("请先确认客户归属")
    project = str(value.get("project") or "—")
    if project != "—" and not conn.execute("SELECT 1 FROM projects WHERE customer=? AND name=?", (customer, project)).fetchone():
        raise ValueError("项目不属于所选客户")
    source_id = str(value.get("sourceId") or "")
    if source_id and not conn.execute(
        "SELECT 1 FROM imports WHERE customer=? AND (id=? OR transcript_id=?) "
        "UNION SELECT 1 FROM transcripts WHERE customer=? AND id=? "
        "UNION SELECT 1 FROM chats WHERE customer=? AND id=?",
        (customer, source_id, source_id, customer, source_id, customer, source_id),
    ).fetchone():
        raise ValueError("来源记录不存在或不属于所选客户")
    title = str(value.get("title") or "").strip()
    owner = str(value.get("owner") or "").strip()
    deadline = due_date(value.get("dueDate"))
    status = str(value.get("status") or "todo")
    if not title or not owner or not deadline:
        raise ValueError("请填写待办标题、负责人和截止时间")
    if status not in ("todo", "doing", "done", "cancelled"):
        raise ValueError("无效的待办状态")
    if not old:
        duplicate = conn.execute(
            "SELECT * FROM todos WHERE customer=? AND project=? AND requirement_id=? AND source_id=? AND title=? AND status<>'cancelled'",
            (customer, project, requirement_id, source_id, title),
        ).fetchone()
        if duplicate:
            return todo_row(duplicate)
    now = datetime.now().isoformat(timespec="seconds")
    todo_id = todo_id or f"todo-{uuid.uuid4().hex[:12]}"
    completed_at = (old["completed_at"] if old and old["status"] == "done" else now) if status == "done" else None
    conn.execute(
        "INSERT INTO todos (id,customer,project,requirement_id,title,owner,due_date,status,source_type,source_id,source_quote,created_at,updated_at,completed_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
        "customer=excluded.customer,project=excluded.project,requirement_id=excluded.requirement_id,title=excluded.title,"
        "owner=excluded.owner,due_date=excluded.due_date,status=excluded.status,source_type=excluded.source_type,"
        "source_id=excluded.source_id,source_quote=excluded.source_quote,updated_at=excluded.updated_at,completed_at=excluded.completed_at",
        (todo_id, customer, project, requirement_id, title, owner, deadline, status,
         str(value.get("sourceType") or "manual"), source_id, str(value.get("sourceQuote") or ""),
         old["created_at"] if old else now, now, completed_at),
    )
    return todo_row(conn.execute("SELECT * FROM todos WHERE id=?", (todo_id,)).fetchone())


def archive_imports(conn, data) -> dict:
    ids = data.get("ids")
    if not isinstance(ids, list) or not ids or len(ids) > 200 or any(not isinstance(item, str) for item in ids):
        raise ValueError("请选择 1–200 条待归档记录")
    ids = list(dict.fromkeys(ids))
    customer, project, owner = (str(data.get(key) or "").strip() for key in ("customer", "project", "owner"))
    if not customer or not project or not owner:
        raise ValueError("请选择客户、项目并填写负责人")
    if not conn.execute("SELECT 1 FROM customers WHERE name=?", (customer,)).fetchone():
        raise ValueError("客户不存在，请先新建客户")
    if not conn.execute("SELECT 1 FROM projects WHERE customer=? AND name=?", (customer, project)).fetchone():
        raise ValueError("项目不属于所选客户")
    conn.execute("BEGIN IMMEDIATE")
    records = []
    for record_id in ids:
        row = conn.execute("SELECT * FROM imports WHERE id=?", (record_id,)).fetchone()
        if row is None or (row["customer"] not in ("", "待归档", "待确认") and row["status"] != "inbox"):
            raise ValueError("所选记录已归档或不存在，请刷新后重试")
        if row["status"] not in ("inbox", "done") or conn.execute(
            "SELECT 1 FROM tasks WHERE import_id=? AND status IN ('queued','running')", (record_id,)
        ).fetchone():
            raise ValueError("请等待解析完成后归档；失败或取消的任务请先重试")
        records.append(row)
    for row in records:
        conn.execute("UPDATE imports SET customer=?,project=?,owner=?,status='done' WHERE id=?", (customer, project, owner, row["id"]))
        # Keep manual confirmation separate from automatic match accuracy. A
        # manual archive is useful audit history, but it is not a correctness
        # sample for the auto matcher.
        conn.execute(
            "INSERT INTO customer_match_audits (id,import_id,suggested_customer,confirmed_customer,method,is_correct,created_at,confirmed_at) VALUES (?,?,?,?,?,?,?,?)",
            (f"match-{uuid.uuid4().hex[:12]}", row["id"], str(row["customer"] or ""), customer, "manual", None, datetime.now().isoformat(timespec="seconds"), datetime.now().isoformat(timespec="seconds")),
        )
    for row in records:
        source_id = str(row["transcript_id"] or "")
        # Shared demo transcripts must not move records belonging to another customer.
        if source_id and conn.execute("SELECT 1 FROM imports WHERE transcript_id=? AND id<>? AND customer<>?", (source_id, row["id"], customer)).fetchone():
            raise ValueError("该记录共用其他客户的转写，请先核对来源")
        for table in ("chats", "transcripts"):
            conn.execute(f"UPDATE {table} SET customer=?,project=? WHERE id=?", (customer, project, source_id))
        conn.execute("UPDATE requirements SET customer=?,project=?,owner=? WHERE source_id=? OR (source_id<>'' AND source_id=?)", (customer, project, owner, row["id"], source_id))
        conn.execute("UPDATE todos SET customer=?,project=?,owner=? WHERE source_id=? OR (source_id<>'' AND source_id=?)", (customer, project, owner, row["id"], source_id))
    return {"updated": ids}


def followup(conn, customer) -> dict:
    todos = list_todos(conn, customer)
    source_ids = {row["id"]: row["transcript_id"] for row in conn.execute(
        "SELECT id,transcript_id FROM imports WHERE customer=? AND transcript_id<>''", (customer,)
    )}
    confirmed = {(source_ids.get(item["sourceId"], item["sourceId"]), item["title"])
                 for item in todos if item["status"] != "cancelled"}
    today = date.today().isoformat()
    active = [item for item in todos if item["status"] in ("todo", "doing")]
    suggestions, risks, dates = [], [], []
    for table, field in (("transcripts", "summary_json"), ("chats", "analysis_json")):
        rows = conn.execute(f"SELECT * FROM {table} WHERE customer=? ORDER BY imported_at DESC, rowid DESC", (customer,)).fetchall()
        for row in rows:
            data = json.loads(row[field] or "{}")
            if table == "chats":
                contact_at = str(row["ended_at"] or "")
                dates.append(contact_at if len(contact_at) >= 10 else str(row["imported_at"] or ""))
                actions = data.get("nextActions") or []
                for risk in data.get("risks") or []:
                    text = str(risk.get("content") or risk.get("evidence") or "") if isinstance(risk, dict) else str(risk)
                    if text.strip():
                        risks.append({"text": text, "sourceId": row["id"], "sourceType": "chat", "project": row["project"]})
            else:
                dates.append(str(row["imported_at"] or ""))
                text = str(data.get("nextActions") or "").strip()
                actions = [{"action": text, "evidence": text}] if text not in ("", "未提及", "无", "—") else []
                risk = str(data.get("objections") or "").strip()
                if risk not in ("", "未提及", "无", "—"):
                    risks.append({"text": risk, "sourceId": row["id"], "sourceType": "audio", "project": row["project"]})
            for action in actions:
                if not isinstance(action, dict) or not str(action.get("action") or "").strip():
                    continue
                title = str(action["action"]).strip()
                if (row["id"], title) in confirmed:
                    continue
                suggestions.append({"title": title, "owner": str(action.get("owner") or ""),
                                    "dueText": str(action.get("due") or ""), "project": row["project"],
                                    "sourceId": row["id"], "sourceType": "chat" if table == "chats" else "audio",
                                    "sourceQuote": str(action.get("evidence") or title)})
    # Historical HH:MM-only imports have no reliable date; never interpret them as today.
    dated = []
    for value in dates:
        try:
            dated.append(date.fromisoformat(value[:10]))
        except ValueError:
            continue
    last = max(dated) if dated else None
    return {"todos": todos, "suggestions": suggestions[:20], "risks": risks[:10],
            "overdue": sum(item["dueDate"] < today for item in active),
            "dueToday": sum(item["dueDate"] == today for item in active),
            "lastContactAt": last.isoformat() if last else "",
            "daysSinceContact": max(0, (date.today() - last).days) if last else None}


def search(conn, query) -> dict:
    query = query.strip()[:100]
    if not query:
        return {"query": "", "results": [], "counts": {}}
    # Each entity is queried once; results always reflect edits/deletes without a second index.
    def json_text(column):
        return f"coalesce((SELECT group_concat(value,' ') FROM json_tree({column}) WHERE type='text'),'')"

    specs = (
        ("customer", "customers", "name", "name", "name", "''", f"company||' '||position||' '||phone||' '||wechat||' '||email||' '||notes||' '||{json_text('tags_json')}"),
        ("project", "projects", "id", "name", "customer", "name", "description||' '||owner||' '||stage||' '||budget"),
        ("requirement", "requirements", "id", "title", "customer", "project", "description||' '||source_quote||' '||owner"),
        ("chat", "chats", "id", "title", "customer", "project", f"file_name||' '||{json_text('messages_json')}||' '||{json_text('analysis_json')}||' '||{json_text('attachments_json')}"),
        ("transcript", "transcripts", "id", "title", "customer", "project", f"file_name||' '||{json_text('segments_json')}||' '||{json_text('summary_json')}||' '||{json_text('attachments_json')}"),
    )
    results, counts = [], {}
    for kind, table, id_col, title, customer, project, content in specs:
        where = f"instr(lower({title}||' '||{customer}||' '||{project}||' '||{content}),lower(?))>0"
        rows = conn.execute(f"SELECT {id_col} AS id,{title} AS title,{customer} AS customer,{project} AS project,{content} AS content,COUNT(*) OVER() AS matches FROM {table} WHERE {where} ORDER BY rowid DESC LIMIT 20", (query,)).fetchall()
        counts[kind] = rows[0]["matches"] if rows else 0
        for row in rows:
            body = row["content"] or ""
            index = body.lower().find(query.lower())
            snippet = body[max(0, index - 40):max(0, index - 40) + 180]
            results.append({"kind": kind, "id": row["id"], "title": row["title"], "customer": row["customer"], "project": row["project"], "snippet": snippet})
    return {"query": query, "results": results, "counts": counts}
