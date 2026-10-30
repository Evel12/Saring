"""Bounded local parsing. No uploaded code, URLs, or model image submission."""
import json
import os
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile


class IngestionError(ValueError):
    pass


def sufficient(text):
    return sum(c.isalpha() for c in text) >= 40 and len(text.split()) >= 8


def ocr_page(path, index):
    import pypdfium2 as pdfium
    import pytesseract
    if os.getenv("TESSERACT_CMD"):
        pytesseract.pytesseract.tesseract_cmd = os.environ["TESSERACT_CMD"]
    with pdfium.PdfDocument(str(path)) as doc:
        page = doc[index]
        width, height = page.get_size()
        if width * height * 4 > 24_000_000:
            raise IngestionError("Page exceeds OCR pixel limit; reupload a standard-size PDF")
        bitmap = page.render(scale=2)
        image = bitmap.to_pil()
        try:
            data = pytesseract.image_to_data(image, lang=os.getenv("OCR_LANG", "eng"),
                config="--psm 3", timeout=20, output_type=pytesseract.Output.DICT)
            words = [(t, float(c)) for t, c in zip(data["text"], data["conf"]) if t.strip() and float(c) >= 0]
            lines = {}
            for i, text in enumerate(data["text"]):
                if text.strip():
                    key = tuple(data[k][i] for k in ("block_num", "par_num", "line_num"))
                    lines.setdefault(key, []).append(text)
            return "\n".join(" ".join(parts) for parts in lines.values()), (sum(c for _, c in words) / len(words) if words else 0)
        finally:
            image.close()
            bitmap.close()
            page.close()


def parse_local(path, suffix, ocr=ocr_page):
    if suffix == ".docx":
        from docx import Document
        with ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > 1000 or sum(e.file_size for e in entries) > 20 * 1024 * 1024:
                raise IngestionError("DOCX expansion limit exceeded")
        from docx.oxml.ns import qn
        doc = Document(path)
        # XML order includes table paragraphs; never fabricate PDF page numbers.
        result = [{"locator": f"paragraph {i}", "page": None, "paragraph": i,
                   "text": "".join(t.text or "" for t in p.iter(qn("w:t"))),
                   "method": "docx", "quality": "readable"}
                  for i, p in enumerate(doc.element.body.iter(qn("w:p")), 1)]
        result = [p for p in result if p["text"].strip()]
        if not result:
            raise IngestionError("No document text; reupload an accessible document")
        return result
    if suffix != ".pdf":
        raise IngestionError("Unsupported document format")
    from pypdf import PdfReader
    reader = PdfReader(path, strict=False)
    if reader.is_encrypted:
        raise IngestionError("Password-protected PDF; reupload an unlocked copy")
    if not 1 <= len(reader.pages) <= 20:
        raise IngestionError("PDF must contain 1–20 pages")
    result = []
    for i, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        method, quality, confidence = "pdf", "readable", None
        if not sufficient(text):
            try:
                text, confidence = ocr(path, i)
                method = "tesseract-ocr"
                quality = "uncertain" if confidence < 75 or not sufficient(text) else "ocr-review"
            except Exception:
                method, quality = "ocr-unavailable", "uncertain"
        result.append({"locator": f"page {i+1}", "page": i+1, "paragraph": None,
            "text": text[:50000], "method": method, "quality": quality, "ocr_confidence": confidence})
    return result


def extract(path, suffix):
    """Kill parsing subprocess on timeout; output is bounded, never provider diagnostics."""
    try:
        completed = subprocess.run([sys.executable, "-m", "backend.ingestion", str(Path(path).resolve()), suffix],
            capture_output=True, timeout=90, check=False)
    except subprocess.TimeoutExpired:
        raise IngestionError("Extraction timed out; correct or reupload the document") from None
    if completed.returncode or len(completed.stdout) > 5_000_000:
        # Child returns only controlled public error categories.
        error = completed.stdout.decode("utf-8", errors="replace")[:200]
        raise IngestionError(error if error.startswith("Document error:") else "Malformed document; correct or reupload")
    return json.loads(completed.stdout)


if __name__ == "__main__":
    try:
        sys.stdout.buffer.write(json.dumps(parse_local(sys.argv[1], sys.argv[2])).encode())
    except IngestionError as exc:
        sys.stdout.buffer.write(("Document error: " + str(exc)).encode())
        sys.exit(1)
    except Exception:
        sys.stdout.buffer.write(b"Document error: malformed document; correct or reupload")
        sys.exit(1)
