"""Start the released WeChat component with disposable data and check health."""

import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
archive = root / "release" / "components" / f"ClientAtlas-WeChat-Engine-{version}.zip"

with tempfile.TemporaryDirectory(prefix="clientatlas-wechat-check-") as temporary:
    directory = Path(temporary)
    with ZipFile(archive) as component:
        component.extractall(directory / "engine")
    executable = directory / "engine" / "wechat-backend.exe"
    assert executable.stat().st_size > 100_000_000
    assert (directory / "engine" / "native" / "wechatdb_broker.exe").stat().st_size > 1_000_000
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    env = dict(os.environ, WECHAT_TOOL_HOST="127.0.0.1", WECHAT_TOOL_PORT=str(port),
               WECHAT_TOOL_DATA_DIR=str(directory / "data"),
               WECHAT_TOOL_OUTPUT_DIR=str(directory / "data" / "output"),
               APPDATA=str(directory / "roaming"))
    with (directory / "engine.log").open("w+b") as log:
        process = subprocess.Popen([str(executable)], cwd=executable.parent, env=env,
                                   stdout=log, stderr=subprocess.STDOUT,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            deadline = time.monotonic() + 60
            while True:
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as response:
                        health = json.load(response)
                    assert health["status"] == "healthy", health
                    print("PASS optional WeChat component health")
                    break
                except (OSError, ValueError):
                    if process.poll() is not None:
                        raise RuntimeError(f"WeChat component exited: {process.returncode}")
                    if time.monotonic() > deadline:
                        raise TimeoutError("WeChat component health timed out")
                    time.sleep(0.5)
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
