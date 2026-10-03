"""File storage, kind detection and text extraction."""
from __future__ import annotations

import hashlib
import io
from pathlib import Path

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff", ".ico"}
TEXT_EXTS = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml",
    ".html", ".htm", ".log", ".ini", ".cfg", ".conf", ".py", ".js", ".mjs", ".ts",
    ".tsx", ".jsx", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".go", ".rs", ".rb",
    ".php", ".sh", ".bash", ".sql", ".css", ".scss", ".env", ".toml", ".r", ".kt",
}


def detect_kind(name: str, mime: str) -> str:
    ext = Path(name).suffix.lower()
    mime = (mime or "").lower()
    if ext == ".pdf" or mime == "application/pdf":
        return "pdf"
    if ext in IMAGE_EXTS or mime.startswith("image/"):
        return "image"
    if ext in {".doc", ".docx"}:
        return "doc"
    if ext in {".xls", ".xlsx", ".csv", ".tsv"}:
        return "sheet"
    if ext in {".ppt", ".pptx"}:
        return "slide"
    if ext in TEXT_EXTS or mime.startswith("text/"):
        return "text"
    return "other"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def decode_text(data: bytes) -> str:
    try:
        import chardet

        guess = chardet.detect(data[:30000]) or {}
        enc = guess.get("encoding") or "utf-8"
        return data.decode(enc, errors="replace")
    except Exception:
        return data.decode("utf-8", errors="replace")


def extract_text(kind: str, name: str, data: bytes) -> str:
    """Return plain text extracted from the file (best effort)."""
    try:
        if kind == "pdf":
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            parts = [(page.extract_text() or "") for page in reader.pages]
            return "\n\n".join(p for p in parts if p).strip()

        if kind == "doc":
            import docx

            doc = docx.Document(io.BytesIO(data))
            lines = [p.text for p in doc.paragraphs]
            for table in doc.tables:
                for row in table.rows:
                    cells = [c.text.strip() for c in row.cells if c.text.strip()]
                    if cells:
                        lines.append(" | ".join(cells))
            return "\n".join(lines).strip()

        if kind == "sheet":
            if Path(name).suffix.lower() in {".csv", ".tsv"}:
                return decode_text(data)[:200000]
            import openpyxl

            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            lines: list[str] = []
            for ws in wb.worksheets:
                lines.append(f"# Лист: {ws.title}")
                for row in ws.iter_rows(values_only=True):
                    cells = [str(c) for c in row if c is not None]
                    if cells:
                        lines.append(" | ".join(cells))
            return "\n".join(lines).strip()

        if kind == "slide":
            from pptx import Presentation

            prs = Presentation(io.BytesIO(data))
            lines = []
            for i, slide in enumerate(prs.slides, 1):
                lines.append(f"# Слайд {i}")
                for shape in slide.shapes:
                    if getattr(shape, "has_text_frame", False) and shape.text_frame.text:
                        lines.append(shape.text_frame.text)
            return "\n".join(lines).strip()

        if kind == "text":
            return decode_text(data).strip()
    except Exception as e:  # pragma: no cover - defensive
        return f"[Не удалось извлечь текст: {type(e).__name__}: {e}]"
    return ""
