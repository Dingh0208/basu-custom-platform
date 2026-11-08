from __future__ import annotations

import imaplib
import re
import ssl
from datetime import date
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr, parsedate_to_datetime


MAX_MESSAGE_BYTES = 25 * 1024 * 1024


class MailSyncError(RuntimeError):
    pass


class MessageTooLarge(MailSyncError):
    pass


def open_connection(host: str, port: int, username: str, password: str, timeout: int = 15):
    try:
        client = imaplib.IMAP4_SSL(host, port, ssl_context=ssl.create_default_context(), timeout=timeout)
    except (OSError, imaplib.IMAP4.error) as exc:
        raise MailSyncError("无法连接 IMAP 服务器，请检查地址、端口和网络") from exc
    try:
        status, _ = client.login(username, password)
        if status != "OK":
            raise MailSyncError("邮箱认证失败，请检查邮箱地址和授权码")
        return client
    except Exception as exc:
        try:
            client.logout()
        except Exception:
            pass
        if isinstance(exc, MailSyncError):
            raise
        raise MailSyncError("邮箱认证失败，请检查邮箱地址和授权码") from exc


def test_connection(host: str, port: int, username: str, password: str) -> dict:
    client = open_connection(host, port, username, password)
    try:
        capabilities = {item.decode("ascii", "ignore").upper() if isinstance(item, bytes) else str(item).upper() for item in client.capabilities}
        status, _ = client.select("INBOX", readonly=True)
        if status != "OK":
            raise MailSyncError("无法读取收件箱")
        return {"idleSupported": "IDLE" in capabilities}
    finally:
        try:
            client.logout()
        except Exception:
            pass


def select_inbox(client) -> str:
    status, _ = client.select("INBOX", readonly=True)
    if status != "OK":
        raise MailSyncError("无法读取收件箱")
    _, data = client.response("UIDVALIDITY")
    match = re.search(rb"\d+", b" ".join(item for item in (data or []) if isinstance(item, bytes)))
    if not match:
        raise MailSyncError("邮箱未返回有效的 UIDVALIDITY")
    return match.group(0).decode("ascii")


def search_uids(client, last_uid: int, since: date) -> list[int]:
    if last_uid:
        status, data = client.uid("SEARCH", None, "UID", f"{last_uid + 1}:*")
    else:
        month = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")[since.month - 1]
        status, data = client.uid("SEARCH", None, "SINCE", f"{since.day:02d}-{month}-{since.year}")
    if status != "OK":
        raise MailSyncError("搜索收件箱失败")
    if not data or not data[0]:
        return []
    return sorted({int(uid) for uid in data[0].split() if uid.isdigit() and int(uid) > last_uid})


def message_metadata(raw: bytes) -> dict[str, str]:
    message = BytesParser(policy=policy.default).parsebytes(raw)
    try:
        sent_at = parsedate_to_datetime(str(message.get("Date") or "")).strftime("%Y-%m-%d %H:%M")
    except (TypeError, ValueError, OverflowError):
        sent_at = ""
    return {
        "subject": str(message.get("Subject") or "无主题邮件").strip() or "无主题邮件",
        "sender": parseaddr(str(message.get("From") or ""))[1].strip().casefold(),
        "sentAt": sent_at,
    }


def fetch_message(client, uid: int) -> bytes:
    size = fetch_message_size(client, uid)
    if size > MAX_MESSAGE_BYTES:
        raise MessageTooLarge("邮件超过 25 MB，无法导入；请取消选择该邮件，或单独导入 EML 文件")

    status, data = client.uid("FETCH", str(uid), "(BODY.PEEK[])")
    if status != "OK":
        raise MailSyncError("读取邮件内容失败")
    for item in data or []:
        if isinstance(item, tuple) and len(item) > 1 and isinstance(item[1], bytes):
            if len(item[1]) > MAX_MESSAGE_BYTES:
                raise MessageTooLarge("邮件超过 25 MB，无法导入；请取消选择该邮件，或单独导入 EML 文件")
            return item[1]
    raise MailSyncError("邮箱未返回邮件内容")


def fetch_message_size(client, uid: int) -> int:
    status, size_data = client.uid("FETCH", str(uid), "(RFC822.SIZE)")
    if status != "OK":
        raise MailSyncError("读取邮件大小失败")
    size_reply = b" ".join(
        item if isinstance(item, bytes) else item[0]
        for item in (size_data or [])
        if isinstance(item, bytes) or isinstance(item, tuple) and item and isinstance(item[0], bytes)
    )
    size_match = re.search(rb"RFC822\.SIZE\s+(\d+)", size_reply)
    if not size_match:
        raise MailSyncError("邮箱未返回邮件大小")
    return int(size_match.group(1))


def fetch_headers(client, uid: int) -> dict[str, str | int]:
    size = fetch_message_size(client, uid)
    status, data = client.uid("FETCH", str(uid), "(BODY.PEEK[HEADER.FIELDS (DATE FROM SUBJECT)])")
    if status != "OK":
        raise MailSyncError("读取邮件列表失败")
    for item in data or []:
        if isinstance(item, tuple) and len(item) > 1 and isinstance(item[1], bytes):
            metadata = message_metadata(item[1])
            return {
                **metadata,
                "size": size,
            }
    raise MailSyncError("邮箱未返回邮件列表")
