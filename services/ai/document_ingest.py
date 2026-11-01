"""Extract bounded, readable text from imported office documents and email."""

import io
from email import policy
from email.parser import BytesParser
from pathlib import Path


SUPPORTED = {".pdf", ".docx", ".xlsx", ".eml"}
MAX_TEXT = 100_000


def extract(path: Path) -> tuple[str, list[tuple[str, bytes]]]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        if reader.is_encrypted:
            raise ValueError("PDF 已加密，请先解锁后重新导入")
        pages = []
        character_count = 0
        has_text = False
        for index, page in enumerate(reader.pages[:200], 1):
            if character_count >= MAX_TEXT:
                break
            page_text = (page.extract_text(extraction_mode="layout") or "") if "/Contents" in page else ""
            has_text = has_text or bool(page_text.strip())
            section = f"第 {index} 页\n{page_text}"[:MAX_TEXT - character_count]
            pages.append(section)
            character_count += len(section) + 2
        text = "\n\n".join(pages).strip()
        if not has_text:
            raise ValueError("扫描版 PDF 没有文本层，需要 OCR 后重新导入")
        return text, []
    if suffix == ".docx":
        from docx import Document

        document = Document(str(path))
        parts = []
        character_count = 0
        for paragraph in document.paragraphs:
            if character_count >= MAX_TEXT:
                break
            if paragraph.text.strip():
                value = paragraph.text[:MAX_TEXT - character_count]
                parts.append(value)
                character_count += len(value) + 1
        for table in document.tables:
            if character_count >= MAX_TEXT:
                break
            for row in table.rows:
                if character_count >= MAX_TEXT:
                    break
                value = "\t".join(cell.text for cell in row.cells)[:MAX_TEXT - character_count]
                parts.append(value)
                character_count += len(value) + 1
        return "\n".join(parts), []
    if suffix == ".xlsx":
        from openpyxl import load_workbook

        book = load_workbook(str(path), read_only=True, data_only=True)
        try:
            parts = []
            character_count = 0
            for sheet in book.worksheets[:50]:
                parts.append(f"工作表：{sheet.title}")
                character_count += len(parts[-1])
                for row in sheet.iter_rows(max_row=10000, max_col=200, values_only=True):
                    if character_count >= MAX_TEXT:
                        break
                    line = "\t".join(str(value) if value is not None else "" for value in row)
                    if line.strip():
                        line = line[:MAX_TEXT - character_count]
                        parts.append(line)
                        character_count += len(line) + 1
                    if character_count >= MAX_TEXT:
                        break
                if character_count >= MAX_TEXT:
                    break
            return "\n".join(parts)[:MAX_TEXT], []
        finally:
            book.close()
    if suffix == ".eml":
        message = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
        headers = [f"{key}：{message.get(key, '')}" for key in ("From", "To", "Date", "Subject")]
        body = message.get_body(preferencelist=("plain", "html")) if message.is_multipart() else message
        content = body.get_content() if body else ""
        if body and body.get_content_type() == "text/html":
            from html.parser import HTMLParser

            class PlainText(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.parts = []
                    self.ignored = 0

                def handle_starttag(self, tag, attrs):
                    if tag in ("script", "style", "head"):
                        self.ignored += 1

                def handle_endtag(self, tag):
                    if tag in ("script", "style", "head"):
                        self.ignored = max(0, self.ignored - 1)

                def handle_data(self, data):
                    if not self.ignored:
                        self.parts.append(data)

            parser = PlainText()
            parser.feed(str(content))
            content = " ".join(parser.parts)
        attachments = []
        attachment_bytes = 0
        for part in message.iter_attachments():
            filename = part.get_filename()
            if filename:
                data = part.get_payload(decode=True)
                if data and len(attachments) < 20 and len(data) <= 25 * 1024 * 1024 and attachment_bytes + len(data) <= 100 * 1024 * 1024:
                    attachments.append((filename, data))
                    attachment_bytes += len(data)
        return ("\n".join(headers) + "\n\n" + str(content))[:MAX_TEXT], attachments
    raise ValueError("该文件类型暂不支持内容解析")
