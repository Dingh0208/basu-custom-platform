from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "clientatlas-icon.png"
ICON = Image.open(SOURCE).convert("RGBA")
SIZES = [16, 24, 32, 48, 64, 128, 256]

ICON.save(ROOT / "public" / "favicon.ico", format="ICO", sizes=[(size, size) for size in SIZES])
build_icon = ROOT / "build" / "icon.ico"
build_icon.parent.mkdir(parents=True, exist_ok=True)
ICON.save(build_icon, format="ICO", sizes=[(size, size) for size in SIZES])
print(f"Generated Web and Windows icons from {SOURCE.name}")
