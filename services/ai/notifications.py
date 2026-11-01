"""Persistent due reminders for the local desktop workspace."""

from datetime import datetime


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY, todo_id TEXT NOT NULL, due_date TEXT NOT NULL,
            created_at TEXT NOT NULL, read_at TEXT, delivered_at TEXT,
            UNIQUE(todo_id, due_date)
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at, created_at);
    """)


def quiet_now(settings, now):
    start, end = settings["quietStart"], settings["quietEnd"]
    current = now.strftime("%H:%M")
    if start == end:
        return False
    return start <= current < end if start < end else current >= start or current < end


def refresh(conn, now=None):
    now = now or datetime.now()
    # Completed/deleted/postponed items must never produce an outdated reminder.
    conn.execute("""DELETE FROM notifications WHERE NOT EXISTS (
        SELECT 1 FROM todos t WHERE t.id=notifications.todo_id
        AND t.status IN ('todo','doing') AND t.due_date=notifications.due_date)""")
    if now.hour < 9:
        return
    stamp = now.isoformat(timespec="seconds")
    conn.execute("""INSERT OR IGNORE INTO notifications(id,todo_id,due_date,created_at)
        SELECT 'due:' || id || ':' || due_date,id,due_date,? FROM todos
        WHERE status IN ('todo','doing') AND due_date<>'' AND due_date<=?""", (stamp, now.date().isoformat()))


def listing(conn, settings, now=None):
    now = now or datetime.now()
    refresh(conn, now)
    rows = conn.execute("""SELECT n.*,t.title,t.customer,t.project,t.owner FROM notifications n
        JOIN todos t ON t.id=n.todo_id ORDER BY n.created_at DESC,n.id DESC LIMIT 200""").fetchall()
    can_deliver = settings["systemNotifications"] and not quiet_now(settings, now)
    return {
        "unreadCount": conn.execute("SELECT COUNT(*) FROM notifications WHERE read_at IS NULL").fetchone()[0],
        "items": [{"id": row["id"], "todoId": row["todo_id"], "title": row["title"],
                   "customer": row["customer"], "project": row["project"], "owner": row["owner"],
                   "dueDate": row["due_date"], "createdAt": row["created_at"],
                   "read": bool(row["read_at"]), "delivered": bool(row["delivered_at"]),
                   "deliver": bool(can_deliver and not row["read_at"] and not row["delivered_at"])} for row in rows],
    }


def mark(conn, data, now=None):
    action = data.get("action")
    if action not in ("read", "delivered"):
        raise ValueError("不支持的通知操作")
    column = "read_at" if action == "read" else "delivered_at"
    stamp = (now or datetime.now()).isoformat(timespec="seconds")
    if data.get("all") is True and action == "read":
        conn.execute("UPDATE notifications SET read_at=? WHERE read_at IS NULL", (stamp,))
    else:
        ids = data.get("ids")
        if not isinstance(ids, list) or not 1 <= len(ids) <= 200 or any(not isinstance(value, str) for value in ids):
            raise ValueError("请选择 1–200 条通知")
        conn.executemany(f"UPDATE notifications SET {column}=COALESCE({column},?) WHERE id=?", [(stamp, value) for value in ids])
