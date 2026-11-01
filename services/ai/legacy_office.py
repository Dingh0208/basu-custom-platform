"""Text readers for unencrypted Word/PPT 97-2003 compound documents."""

import re
import struct


def word_text(document, table):
    if len(document) < 0x1AA or struct.unpack_from("<H", document)[0] != 0xA5EC:
        raise ValueError("不支持的旧版 Word，请转换为 DOCX 后导入")
    flags = struct.unpack_from("<H", document, 10)[0]
    if flags & 0x0100:
        raise ValueError("Word 已加密，请先解锁")
    start, length = struct.unpack_from("<II", document, 0x1A2)
    clx = table[start:start + length]
    offset = 0
    while offset < len(clx) and clx[offset] == 1:
        if offset + 3 > len(clx):
            raise ValueError("Word 片段表损坏")
        offset += 3 + struct.unpack_from("<H", clx, offset + 1)[0]
    if offset + 5 > len(clx) or clx[offset] != 2:
        raise ValueError("Word 片段表缺失，请转换为 DOCX 后导入")
    size = struct.unpack_from("<I", clx, offset + 1)[0]
    plc = clx[offset + 5:offset + 5 + size]
    if len(plc) != size or size < 4 or (size - 4) % 12:
        raise ValueError("Word 片段表损坏")
    count = (size - 4) // 12
    parts = []
    character_count = 0
    for index in range(count):
        begin, end = struct.unpack_from("<II", plc, index * 4)
        if end < begin:
            raise ValueError("Word 字符范围无效")
        fc = struct.unpack_from("<I", plc, 4 * (count + 1) + index * 8 + 2)[0]
        compressed = bool(fc & 0x40000000)
        pos = (fc & 0x3FFFFFFF) // (2 if compressed else 1)
        width = 1 if compressed else 2
        if pos + (end - begin) * width > len(document):
            raise ValueError("Word 文本位置无效")
        raw = document[pos:pos + min(end - begin, 100_000 - character_count) * width]
        parts.append(raw.decode("cp1252" if compressed else "utf-16le", "replace"))
        character_count += len(parts[-1])
        if character_count >= 100_000:
            break
    return re.sub(r"[\x00-\x08\x0b\x0e-\x1f]", " ", "".join(parts).replace("\r", "\n").replace("\x07", "\t"))[:100_000]


def powerpoint_text(data):
    parts = []
    length = 0

    def records(start, end, depth=0):
        nonlocal length
        if depth > 32:
            raise ValueError("PPT 结构嵌套过深")
        while start + 8 <= end and length < 100_000:
            options, kind, size = struct.unpack_from("<HHI", data, start)
            body = start + 8
            limit = body + size
            if limit > end:
                raise ValueError("PPT 数据损坏")
            if options & 15 == 15:
                records(body, limit, depth + 1)
            elif kind in (4000, 4008):  # TextCharsAtom / TextBytesAtom
                text = data[body:limit].decode("utf-16le" if kind == 4000 else "cp1252", "replace")
                if text.strip():
                    parts.append(text.replace("\r", "\n").replace("\x0b", "\n"))
                    length += len(text) + 1
            start = limit
    records(0, len(data))
    return "\n".join(parts)[:100_000]


def current_powerpoint_text(data, current_user):
    """Follow incremental-save pointers so deleted/old slides are excluded."""
    def record(offset):
        if offset < 0 or offset + 8 > len(data):
            raise ValueError("PPT 记录位置无效")
        options, kind, size = struct.unpack_from("<HHI", data, offset)
        end = offset + 8 + size
        if end > len(data):
            raise ValueError("PPT 数据损坏")
        return options, kind, offset + 8, end

    def children(begin, end):
        while begin + 8 <= end:
            options, kind, body, limit = record(begin)
            if limit > end:
                raise ValueError("PPT 容器损坏")
            yield options, kind, body, limit
            begin = limit

    if len(current_user) < 20:
        raise ValueError("PPT 当前版本信息缺失")
    if struct.unpack_from('<I', current_user, 12)[0] == 0xF3D1C4DF:
        raise ValueError("PPT 已加密，请先解锁")
    edit = struct.unpack_from('<I', current_user, 16)[0]
    pointers, visited = {}, set()
    document_id = None
    while edit:
        if edit in visited or len(visited) >= 10000:
            raise ValueError("PPT 保存历史损坏")
        visited.add(edit)
        _, kind, body, end = record(edit)
        if kind != 4085 or end - body < 28:
            raise ValueError("PPT 编辑记录损坏")
        previous, directory, reference = struct.unpack_from('<III', data, body + 8)
        if document_id is None:
            document_id = reference
        _, kind, pos, limit = record(directory)
        if kind not in (6001, 6002):
            raise ValueError("PPT 索引缺失")
        while pos + 4 <= limit:
            descriptor = struct.unpack_from('<I', data, pos)[0]
            pos += 4
            first, count = descriptor & 0xFFFFF, descriptor >> 20
            if pos + count * 4 > limit:
                raise ValueError("PPT 索引损坏")
            for index in range(count):
                pointers.setdefault(first + index, struct.unpack_from('<I', data, pos + index * 4)[0])
            pos += count * 4
        edit = previous
    if document_id not in pointers:
        raise ValueError("PPT 当前文档缺失")
    _, kind, body, end = record(pointers[document_id])
    if kind != 1000:
        raise ValueError("PPT 文档结构无效")
    parts, count = [], 0
    for options, kind, begin, limit in children(body, end):
        # SlideListWithText instance 0=slides, 1=masters, 2=notes.
        if kind != 4080 or options >> 4 not in (0, 2):
            continue
        groups = []
        for _, child_kind, child_body, child_end in children(begin, limit):
            if child_kind == 1011 and child_end - child_body >= 4:
                groups.append([struct.unpack_from('<I', data, child_body)[0], []])
            elif child_kind in (4000, 4008) and groups:
                value = data[child_body:child_end].decode('utf-16le' if child_kind == 4000 else 'cp1252', 'replace')
                groups[-1][1].append(value.replace('\r', '\n').replace('\x0b', '\n').strip())
        for reference, outline in groups[:200]:
            if reference not in pointers:
                raise ValueError("PPT 幻灯片索引缺失")
            offset = pointers[reference]
            _, _, _, slide_end = record(offset)
            shape_text = powerpoint_text(data[offset:slide_end])
            # Outline placeholders can also appear in the slide's shape tree.
            texts = list(dict.fromkeys(value for value in outline if value))
            for value in shape_text.split('\n'):
                if value.strip() and value.strip() not in texts:
                    texts.append(value.strip())
            section = '\n'.join(texts)
            if section:
                parts.append(('备注：\n' if options >> 4 == 2 else '') + section)
                count += len(parts[-1]) + 1
            if count >= 100_000:
                return '\n\n'.join(parts)[:100_000]
    return '\n\n'.join(parts)[:100_000]


def extract(path):
    import olefile

    with olefile.OleFileIO(str(path)) as compound:
        if compound.exists("EncryptedPackage") or compound.exists("EncryptionInfo"):
            raise ValueError("Office 文件已加密，请先解锁")
        if path.suffix.lower() == ".doc":
            document = compound.openstream("WordDocument").read()
            if len(document) < 12:
                raise ValueError("Word 文件损坏")
            flags = struct.unpack_from("<H", document, 10)[0]
            if flags & 0x0100:
                raise ValueError("Word 已加密，请先解锁")
            table = compound.openstream("1Table" if flags & 0x0200 else "0Table").read()
            return word_text(document, table)
        if compound.exists("EncryptedSummary"):
            raise ValueError("PPT 已加密，请先解锁")
        return current_powerpoint_text(compound.openstream("PowerPoint Document").read(),
                                       compound.openstream("Current User").read())
