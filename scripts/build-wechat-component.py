"""Build the separately downloaded WeChat component for a release."""

import hashlib
import json
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "services" / "wechat-engine"
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
NAME = f"ClientAtlas-WeChat-Engine-{VERSION}.zip"
TARGET = ROOT / "release" / "components" / NAME

files = [SOURCE / "wechat-backend.exe"] + sorted(
    file for file in (SOURCE / "native").rglob("*")
    if file.is_file() and "macos" not in file.parts and file.name != "sns_image_fixture.json"
)
if files[0].stat().st_size < 100_000_000:
    raise SystemExit("WeChat engine is a Git LFS pointer; run git lfs pull first")

TARGET.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(TARGET, "w", compression=ZIP_STORED) as archive:
    for file in files:
        entry = ZipInfo(file.relative_to(SOURCE).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
        entry.compress_type = ZIP_STORED
        entry.external_attr = 0o644 << 16
        archive.writestr(entry, file.read_bytes())

with TARGET.open("rb") as component_file:
    digest = hashlib.file_digest(component_file, "sha256").hexdigest()
manifest = {
    "url": f"https://github.com/Dingh0208/clientatlas/releases/download/v{VERSION}/{NAME}",
    "sha256": digest,
    "maxBytes": TARGET.stat().st_size + 1,
}
(ROOT / "electron" / "wechat-component.json").write_text(
    json.dumps(manifest, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
)
print(f"{NAME}: {TARGET.stat().st_size} bytes, sha256 {digest}")
