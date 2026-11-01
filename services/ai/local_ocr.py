"""Offline Chinese/English OCR; models are distributed with RapidOCR."""

import threading
from PIL import Image, ImageOps

_lock = threading.Lock()
_engine = None
PDF_LOCK = threading.Lock()  # PDFium's API is not thread safe.


def image_text(image, check_active=lambda: None):
    global _engine
    import numpy as np
    from rapidocr_onnxruntime import RapidOCR

    check_active()
    if image.width * image.height > 40_000_000:
        raise ValueError("图片超过 4000 万像素，请缩小后重新导入")
    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail((2400, 2400))
    with _lock:
        check_active()
        if _engine is None:
            _engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1)
        result, _ = _engine(np.asarray(image))
    check_active()
    return "\n".join(str(item[1]) for item in (result or []) if float(item[2]) >= 0.35)


def file_text(path, check_active=lambda: None, progress=None):
    with Image.open(path) as image:
        parts, count = [], 0
        for index in range(min(getattr(image, 'n_frames', 1), 200)):
            check_active()
            image.seek(index)
            text = image_text(image, check_active)
            parts.append(text[:100_000 - count])
            count += len(parts[-1]) + 1
            if progress:
                progress(index + 1, min(getattr(image, 'n_frames', 1), 200))
            if count >= 100_000:
                break
        return '\n'.join(parts)


def pdf_page_text(path, index, check_active=lambda: None):
    import pypdfium2 as pdfium

    check_active()
    with PDF_LOCK:
        with pdfium.PdfDocument(str(path)) as document:
            page = document[index]
            try:
                width, height = page.get_size()
                bitmap = page.render(scale=min(2, 2400 / max(width, height)))
                try:
                    image = bitmap.to_pil().copy()
                finally:
                    bitmap.close()
            finally:
                page.close()
    try:
        return image_text(image, check_active)
    finally:
        image.close()
