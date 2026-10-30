from PIL import Image, ImageDraw, ImageFont
import os
import urllib.request

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "ui-refs")
os.makedirs(OUT, exist_ok=True)
FONT = r"C:\Windows\Fonts\msyh.ttc"

items = [
    ("file-upload", 17, "Transcription"),
    ("file-upload", 31, "Batch Log"),
    ("file-upload", 3, "Media"),
    ("audio-player", 24, "Fieldnote"),
    ("audio-player", 3, "Fathom"),
    ("audio-player", 9, "Aviary"),
    ("audio-player", 15, "Mynah"),
    ("audio-player", 18, "Corvo"),
    ("audio-player", 21, "Lull"),
    ("audio-player", 25, "Thrum"),
    ("audio-player", 36, "Vocable"),
    ("audio-video-recorder", 1, "Basalt"),
    ("audio-video-recorder", 2, "Feldspar Console"),
    ("audio-video-recorder", 7, "Ligature"),
    ("audio-video-recorder", 16, "Isobar"),
    ("audio-video-recorder", 20, "Bronzewright Pro"),
    ("audio-video-recorder", 34, "Corbel"),
    ("audio-video-recorder", 40, "Escapement"),
    ("call", 7, "Session"),
    ("call", 10, "Hushgale"),
    ("call", 20, "Quaymark"),
    ("call", 31, "Kesswage"),
    ("chat-detail", 21, "Assistants"),
    ("chat-detail", 9, "Auralis"),
    ("chat-detail", 14, "Parley"),
    ("chat-detail", 18, "Tonewell"),
    ("note-detail", 22, "Loomnote"),
    ("note-detail", 40, "Sidenote"),
    ("note-detail", 3, "Quire"),
    ("timeline-history", 3, "Halyard"),
    ("timeline-history", 5, "Tanager"),
    ("timeline-history", 17, "Milepost"),
    ("timeline-history", 25, "Marlowe"),
]

THUMB_BASE = "https://kombai-assets.b-cdn.net/examples/thumbnails/screens/{slug}/web2/{num}/thumbnail.webp"

def fetch(slug, num):
    dst = os.path.join(OUT, f"thumb_{slug}_{num}.webp")
    if not os.path.exists(dst):
        req = urllib.request.Request(THUMB_BASE.format(slug=slug, num=num), headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r, open(dst, "wb") as f:
            f.write(r.read())
    return dst

def make_sheet():
    cols = 4
    cw, ch = 360, 250
    label_h = 34
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw, rows * (ch + label_h)), "white")
    d = ImageDraw.Draw(sheet)
    label_font = ImageFont.truetype(FONT, 18)
    for idx, (slug, num, name) in enumerate(items):
        try:
            path = fetch(slug, num)
            im = Image.open(path).convert("RGB")
        except Exception as e:
            im = Image.new("RGB", (cw, ch), "#eeeeee")
            print("fetch failed", slug, num, e)
        im.thumbnail((cw - 16, ch - 16), Image.LANCZOS)
        x = (idx % cols) * cw + (cw - im.width) // 2
        y = (idx // cols) * (ch + label_h) + (ch - im.height) // 2
        sheet.paste(im, (x, y))
        label = f"{slug}:{num} · {name}"
        d.rectangle([(idx % cols) * cw, (idx // cols) * (ch + label_h) + ch, (idx % cols + 1) * cw, (idx // cols + 1) * (ch + label_h)], fill="#f2f4f7")
        d.text(((idx % cols) * cw + 10, (idx // cols) * (ch + label_h) + ch + 7), label, font=label_font, fill="#1f2937")
    out = os.path.join(OUT, "contact-sheet candidates.png")
    sheet.save(out, "PNG")
    print("saved", out, sheet.size)

if __name__ == "__main__":
    make_sheet()
