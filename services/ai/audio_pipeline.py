"""Bounded parallel ASR with ordered output and reusable chunk checkpoints."""

import csv
import hashlib
import json
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from pathlib import Path


# Shared across files: importing many recordings must not flood the ASR service.
ASR_SLOTS = threading.BoundedSemaphore(3)


def transcribe(path, *, ffmpeg, cache_dir, cache_key, recognize, check_active,
               progress=None):
    if not ffmpeg:
        raise ValueError("FFmpeg 未安装，无法切片音频，请检查本地服务诊断")
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    stopped = threading.Event()

    def active():
        if stopped.is_set():
            raise RuntimeError("转写已停止")
        check_active()

    with tempfile.TemporaryDirectory(prefix="clienthub-asr-") as temp:
        work = Path(temp)
        manifest = work / "chunks.csv"
        # Leave headroom below Qwen's 60-second limit for MP3 frame padding.
        with tempfile.TemporaryFile(mode="w+b") as errors:
            proc = subprocess.Popen([
                ffmpeg, "-nostdin", "-y", "-i", str(path), "-map", "0:a:0",
                "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame",
                "-b:a", "32k", "-f", "segment", "-segment_time", "55",
                "-reset_timestamps", "1", "-segment_list", str(manifest),
                str(work / "chunk-%06d.mp3"),
            ], stdout=subprocess.DEVNULL, stderr=errors,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            try:
                deadline = time.monotonic() + 900
                while proc.poll() is None:
                    active()
                    if time.monotonic() > deadline:
                        raise TimeoutError("音频切片超时")
                    time.sleep(0.1)
                if proc.returncode:
                    errors.seek(0, 2)
                    errors.seek(max(0, errors.tell() - 1500))
                    raise ValueError("音频切片失败：" + errors.read().decode("utf-8", "replace"))
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
        with manifest.open(encoding="utf-8", newline="") as source:
            chunks = [(work / Path(name).name, float(start), float(end))
                      for name, start, end in csv.reader(source)]
        if not chunks:
            raise ValueError("音频中没有可转写的音轨")

        def run_chunk(chunk):
            active()
            data = chunk[0].read_bytes()
            digest = hashlib.sha256(cache_key.encode() + b"\0" + data).hexdigest()
            checkpoint = cache_dir / (digest + ".json")
            if checkpoint.exists():
                try:
                    result = json.loads(checkpoint.read_text(encoding="utf-8"))
                    if isinstance(result.get("text"), str):
                        return result["text"]
                except (OSError, ValueError, TypeError):
                    pass
            for attempt in range(3):
                active()
                while not ASR_SLOTS.acquire(timeout=0.2):
                    active()
                try:
                    active()
                    result = recognize(data)
                    active()
                    tmp = checkpoint.with_suffix("." + uuid.uuid4().hex + ".tmp")
                    tmp.write_text(json.dumps({"text": result}, ensure_ascii=False), encoding="utf-8")
                    tmp.replace(checkpoint)
                    return result
                except Exception as exc:
                    active()
                    if attempt == 2 or not any(token in str(exc).lower() for token in
                            ("429", "500", "502", "503", "504", "timeout", "timed out", "connection")):
                        raise
                finally:
                    ASR_SLOTS.release()
                until = time.monotonic() + 2 ** attempt
                while time.monotonic() < until:
                    active()
                    time.sleep(0.1)

        results = [""] * len(chunks)
        pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="asr")
        pending = {}
        next_index = 0
        completed = 0
        try:
            while next_index < len(chunks) or pending:
                active()
                while next_index < len(chunks) and len(pending) < 3:
                    pending[pool.submit(run_chunk, chunks[next_index])] = next_index
                    next_index += 1
                ready, _ = wait(pending, timeout=0.2, return_when=FIRST_COMPLETED)
                for future in ready:
                    index = pending.pop(future)
                    results[index] = future.result()
                    completed += 1
                    if progress:
                        progress(completed, len(chunks))
        finally:
            stopped.set()
            pool.shutdown(wait=False, cancel_futures=True)
        active_result = []
        for index, (_, start, end) in enumerate(chunks):
            if results[index].strip():
                active_result.append({"start": start, "end": end, "text": results[index].strip()})
        check_active()
        return active_result
