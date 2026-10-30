from PIL import Image, ImageDraw, ImageFont
import math
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "assets")
os.makedirs(OUT, exist_ok=True)

FONT_PATH = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_PATH, size)


def center_text(draw, box, text, fnt, fill="#1F2937", line_gap=8):
    x1, y1, x2, y2 = box
    lines = text.split("\n")
    heights = []
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=fnt)
        heights.append(bbox[3] - bbox[1])
    total_h = sum(heights) + line_gap * (len(lines) - 1)
    y = y1 + (y2 - y1 - total_h) / 2
    for line, h in zip(lines, heights):
        bbox = draw.textbbox((0, 0), line, font=fnt)
        w = bbox[2] - bbox[0]
        draw.text((x1 + (x2 - x1 - w) / 2, y), line, font=fnt, fill=fill)
        y += h + line_gap


def box(draw, xy, text, fill="#DEEBF7", outline="#2E75B6", radius=18, size=24, bold=False):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=4)
    center_text(draw, xy, text, font(size, bold))


def arrow(draw, start, end, color="#44546A", width=5, label=None):
    draw.line([start, end], fill=color, width=width)
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    length = 20
    for sign in (-0.45, 0.45):
        x = end[0] - length * math.cos(angle + sign)
        y = end[1] - length * math.sin(angle + sign)
        draw.line([end, (x, y)], fill=color, width=width)
    if label:
        bbox = draw.textbbox((0, 0), label, font=font(20))
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        lx = (start[0] + end[0]) / 2 - w / 2
        ly = (start[1] + end[1]) / 2 - h - 10
        draw.rounded_rectangle((lx - 8, ly - 4, lx + w + 8, ly + h + 6), radius=8, fill="white")
        draw.text((lx, ly), label, font=font(20), fill="#44546A")


def architecture():
    W, H = 1600, 1000
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    d.text((60, 35), "ClientHub 系统架构", font=font(46, True), fill="#1F4E79")
    d.text((60, 95), "Windows 单机桌面应用 · 本地数据 · 云端 AI（脱敏调用）", font=font(26), fill="#6B7280")

    d.rounded_rectangle((60, 150, 1540, 430), radius=24, fill="#F8FAFC", outline="#94A3B8", width=4)
    d.text((90, 170), "Windows 桌面应用（Electron）", font=font(30, True), fill="#334155")
    box(d, (100, 220, 740, 395), "Renderer 渲染进程\nReact + TypeScript + Ant Design", fill="#DEEBF7", outline="#2E75B6", size=27)
    box(d, (800, 220, 1500, 395), "Main 主进程\n窗口 / 文件 / 通知 / 子进程", fill="#E2EFDA", outline="#548235", size=27)

    box(d, (400, 510, 1100, 660), "Python Sidecar（FastAPI）\n导入 / 解析 / ASR / LLM / 任务队列", fill="#FFF2CC", outline="#BF8F00", size=29)
    box(d, (90, 730, 520, 920), "SQLite + FTS5\n客户 / 项目 / 沟通\n需求 / 待办", fill="#FCE4D6", outline="#C55A11", size=26)
    box(d, (640, 730, 1120, 920), "本地文件存储\n音频 / 视频 / 文档 / 图片", fill="#EDE7F6", outline="#673AB7", size=26)
    box(d, (1240, 510, 1540, 690), "阿里云百炼\nParaformer + Qwen\n（脱敏调用）", fill="#E1F5FE", outline="#0288D1", size=24)

    arrow(d, (740, 307), (800, 307), label="IPC")
    arrow(d, (750, 395), (750, 510), label="localhost HTTP + Token")
    arrow(d, (700, 660), (500, 730), label="读写")
    arrow(d, (900, 660), (950, 730), label="文件")
    arrow(d, (1100, 600), (1240, 600), label="HTTPS")

    img.save(os.path.join(OUT, "architecture.png"), "PNG")
    print("saved architecture.png")


def data_model():
    W, H = 1600, 1000
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    d.text((60, 35), "ClientHub 核心数据模型", font=font(46, True), fill="#1F4E79")
    d.text((60, 95), "客户 → 项目 → 沟通 → 消息；项目 → 需求 → 需求版本", font=font(26), fill="#6B7280")

    boxes = {
        "customer": (620, 130, 980, 260, "客户 Customer\n姓名 / 公司 / 手机 / 微信", "#DEEBF7", "#2E75B6"),
        "project": (620, 350, 980, 480, "项目 Project\n当前进展 / 预算 / 时间", "#E2EFDA", "#548235"),
        "comm": (110, 570, 480, 700, "沟通 Communication\n渠道 / 时间 / 转写 / 摘要", "#FFF2CC", "#BF8F00"),
        "message": (110, 800, 480, 930, "消息 Message\n说话人 / 内容 / 时间戳", "#FCE4D6", "#C55A11"),
        "requirement": (720, 570, 1090, 700, "需求 Requirement\n标题 / 状态 / 优先级", "#EDE7F6", "#673AB7"),
        "reqver": (720, 800, 1090, 930, "需求版本 RequirementVersion\n版本号 / 快照 / 变更原因", "#F3E5F5", "#8E24AA"),
        "task": (1230, 350, 1560, 480, "待办 Task\n截止时间 / 状态 / 优先级", "#E0F2F1", "#00796B"),
        "file": (1230, 570, 1560, 700, "文件 File\nSHA-256 / 类型 / 路径", "#E1F5FE", "#0288D1"),
        "conflict": (1230, 130, 1560, 260, "冲突 Conflict\n字段 / 值A / 值B", "#FFEBEE", "#C62828"),
    }
    for x1, y1, x2, y2, text, fill, outline in boxes.values():
        box(d, (x1, y1, x2, y2), text, fill=fill, outline=outline, size=23)

    arrow(d, (800, 260), (800, 350), label="1 : N")
    arrow(d, (620, 415), (480, 570), label="1 : N")
    arrow(d, (295, 700), (295, 800), label="1 : N")
    arrow(d, (980, 415), (900, 570), label="1 : N")
    arrow(d, (905, 700), (905, 800), label="1 : N")
    arrow(d, (980, 195), (1230, 195), label="1 : N")
    arrow(d, (980, 415), (1230, 415), label="1 : N")
    arrow(d, (1090, 480), (1395, 570), label="1 : N")

    img.save(os.path.join(OUT, "data-model.png"), "PNG")
    print("saved data-model.png")


def pipeline():
    W, H = 1600, 620
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    d.text((60, 35), "导入与 AI 处理流水线", font=font(46, True), fill="#1F4E79")
    steps = [
        ("1. 导入", "拖拽 / 粘贴\n批量文件"),
        ("2. 识别", "类型 / 去重\n客户匹配"),
        ("3. 提取", "转码 / 解析\nOCR"),
        ("4. 转写", "ASR / 说话人\n时间戳"),
        ("5. 分析", "摘要 / 需求\n冲突 / 画像"),
        ("6. 入库", "SQLite\nFTS5"),
        ("7. 展示", "客户 360\n搜索 / 待办"),
    ]
    x = 55
    y = 160
    w = 200
    gap = 18
    for i, (title, desc) in enumerate(steps):
        fill = "#DEEBF7" if i % 2 == 0 else "#E2EFDA"
        outline = "#2E75B6" if i % 2 == 0 else "#548235"
        box(d, (x, y, x + w, y + 220), f"{title}\n\n{desc}", fill=fill, outline=outline, size=24)
        if i < len(steps) - 1:
            arrow(d, (x + w, y + 110), (x + w + gap, y + 110), width=4)
        x += w + gap

    d.text((60, 440), "异步任务：queued → extracting → transcribing → analyzing → indexing → succeeded / failed", font=font(22), fill="#44546A")
    d.text((60, 485), "AI 输出必须带 evidence（原文 + 时间戳）；找不到信息时写“未提及”，禁止编造。", font=font(22), fill="#44546A")
    img.save(os.path.join(OUT, "pipeline.png"), "PNG")
    print("saved pipeline.png")


if __name__ == "__main__":
    architecture()
    data_model()
    pipeline()
