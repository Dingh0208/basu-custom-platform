from PIL import Image, ImageDraw, ImageFont
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "docs", "prototype")
REF = os.path.join(BASE, "docs", "ui-refs")
FONT = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"

items = [
    ("file-upload_17", "file-upload:17 · Transcription", "上传中心：居中拖拽区 + 三种入口"),
    ("audio-player_24", "audio-player:24 · Fieldnote", "记录详情：音频播放器嵌入内容页"),
    ("timeline-history_25", "timeline-history:25 · Marlowe", "三栏结构：对象列表 / 上下文 / 任务"),
    ("note-detail_40", "note-detail:40 · Sidenote", "文档编辑：正文 + 联系人信息卡"),
    ("audio-video-recorder_34", "audio-video-recorder:34 · Corbel", "语音转文字：主面板 + 右侧参数"),
]

W = 1740
cols = 3
cw, ch = 560, 390
label_h = 66
rows = 2
H = 120 + rows * (ch + label_h)
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)
d.text((50, 36), "乔木 UI 参考选择", font=ImageFont.truetype(FONT_BOLD, 38), fill="#1F4E79")
d.text((50, 86), "从 Qiaomu UI Learn 的 13,561 条设计参考中，筛选出 5 个与本功能最相关的界面", font=ImageFont.truetype(FONT, 19), fill="#667085")

for i, (key, title, desc) in enumerate(items):
    path = os.path.join(REF, f"thumb_{key}.webp")
    im = Image.open(path).convert("RGB")
    im.thumbnail((cw - 20, ch - 20), Image.LANCZOS)
    col = i % cols
    row = i // cols
    x = 50 + col * (cw + 20) + (cw - im.width) // 2
    y = 120 + row * (ch + label_h) + (ch - im.height) // 2
    img.paste(im, (x, y))
    bx = 50 + col * (cw + 20)
    by = 120 + row * (ch + label_h) + ch
    d.rectangle((bx, by, bx + cw, by + label_h), fill="#F5F7FA")
    d.text((bx + 12, by + 9), title, font=ImageFont.truetype(FONT_BOLD, 17), fill="#172033")
    d.text((bx + 12, by + 35), desc, font=ImageFont.truetype(FONT, 14), fill="#667085")

out = os.path.join(OUT, "00-乔木UI参考.png")
img.save(out, "PNG")
print("saved", out, img.size)
