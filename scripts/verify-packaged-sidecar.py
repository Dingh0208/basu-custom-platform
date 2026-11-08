"""Smoke-test the actual frozen runtime using disposable data and local fixtures."""

import argparse
import base64
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
from email.message import EmailMessage


def verify(app_dir):
    resources = app_dir / "resources"
    executable = resources / "ai-sidecar" / "clienthub-ai.exe"
    ffmpeg = resources / "ffmpeg" / "ffmpeg.exe"
    engine = resources / "wechat-engine" / "wechat-backend.exe"
    assert executable.is_file() and ffmpeg.is_file() and engine.is_file()
    assert not list((resources / "ai-sidecar").rglob(".env")), "Bundled credentials"
    subprocess.run([str(ffmpeg), "-version"], check=True, capture_output=True, timeout=15)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]

    with tempfile.TemporaryDirectory(prefix="clienthub-package-check-") as temporary:
        root = Path(temporary)
        env = dict(os.environ, CLIENTHUB_DATA_DIR=str(root / "data"),
                   CLIENTHUB_ENV_FILE=str(root / "absent.env"), MAAS_API_KEY="",
                   MAAS_BASE_URL="http://127.0.0.1:1", FFMPEG_PATH=str(ffmpeg),
                   WECHAT_DATA_ANALYSIS_BACKEND=str(engine),
                   WECHAT_DATA_ANALYSIS_DATA_DIR=str(root / "wechat"))

        def api(route, data=None):
            request = urllib.request.Request(f"http://127.0.0.1:{port}{route}",
                data=None if data is None else json.dumps(data).encode(),
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.load(response)

        with (root / "runtime.log").open("w+b") as log:
            process = subprocess.Popen([str(executable), "--port", str(port),
                "--parent-pid", str(os.getpid())], cwd=executable.parent,
                env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 45
                while True:
                    try:
                        health = api("/api/health")
                        break
                    except OSError:
                        assert process.poll() is None, "Frozen runtime exited"
                        if time.monotonic() > deadline:
                            raise TimeoutError("Frozen runtime did not become healthy")
                        time.sleep(0.2)
                version = json.loads((Path(__file__).resolve().parents[1] / "package.json").read_text(encoding="utf-8"))["version"]
                assert health["version"] == version and health["apiRevision"] == 23, health
                api("/api/settings/app", {"aiImportEnabled": False})

                from docx import Document
                from openpyxl import Workbook
                from pptx import Presentation
                from pptx.util import Inches
                from PIL import Image, ImageDraw, ImageFont
                import xlwt

                doc = Document()
                doc.add_paragraph("PACKAGE_DOCX")
                doc.save(root / "sample.docx")
                book = Workbook()
                book.active.append(["PACKAGE_XLSX"])
                book.save(root / "sample.xlsx")
                legacy = xlwt.Workbook()
                legacy.add_sheet("Sheet1").write(0, 0, "PACKAGE_XLS")
                legacy.save(str(root / "sample.xls"))
                slides = Presentation()
                slide = slides.slides.add_slide(slides.slide_layouts[6])
                slide.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(1)).text = "PACKAGE_PPTX"
                slides.save(root / "sample.pptx")
                mail = EmailMessage()
                mail["Subject"] = "Package check"
                mail.set_content("PACKAGE_EMAIL")
                (root / "sample.eml").write_bytes(mail.as_bytes())
                image = Image.new("RGB", (1200, 240), "white")
                font = ImageFont.truetype(str(Path(os.environ["WINDIR"]) / "Fonts" / "arial.ttf"), 42)
                ImageDraw.Draw(image).text((40, 60), "Customer plan 2026", font=font, fill="black")
                image.save(root / "scan.png")
                image.save(root / "scan.pdf", "PDF", resolution=144)
                samples = [(root / f"sample.{ext}", expected) for ext, expected in
                    [("docx", "PACKAGE_DOCX"), ("xlsx", "PACKAGE_XLSX"), ("xls", "PACKAGE_XLS"),
                     ("pptx", "PACKAGE_PPTX"), ("eml", "PACKAGE_EMAIL")]]
                samples += [(root / "scan.png", "Customer"), (root / "scan.pdf", "Customer")]
                fixtures = Path(__file__).resolve().parents[1] / "services" / "ai" / "fixtures"
                samples += [(fixtures / "simple.doc", "Word 97-SR2"),
                            (fixtures / "basic_test_ppt_file.ppt", "This is a test title")]
                for sample, expected in samples:
                    imported = api("/api/imports", {"fileName": sample.name,
                        "type": "PDF" if sample.suffix == ".pdf" else "图片" if sample.suffix == ".png" else "Word",
                        "contentBase64": base64.b64encode(sample.read_bytes()).decode()})
                    deadline = time.monotonic() + 60
                    while True:
                        item = next(record for record in api("/api/imports") if record["id"] == imported["id"])
                        if item["status"] in {"done", "failed"}:
                            break
                        if time.monotonic() > deadline:
                            raise TimeoutError(f"Import timed out: {sample.name}")
                        time.sleep(0.2)
                    assert item["status"] == "done", item
                    transcript = api("/api/transcripts/" + item["transcriptId"])
                    assert expected in "\n".join(segment["text"] for segment in transcript["segments"]), sample.name
                    print("PASS frozen parser:", sample.name, flush=True)
                print(f"PASS packaged v{version}/API23, FFmpeg, nine parsers, isolated data", flush=True)
            except Exception:
                log.seek(0)
                print(log.read().decode("utf-8", errors="replace"))
                raise
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-dir", type=Path, default=Path("release/win-unpacked"))
    verify(parser.parse_args().app_dir.resolve())
