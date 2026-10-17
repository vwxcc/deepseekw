"""Template-first file generation from validated, data-only plans.

The model sends a declarative plan (layout/content/style choices), never executable
Python. This module validates the plan and delegates Office formats to docgen.
"""
from __future__ import annotations

import csv
import html
import json
import re
import textwrap
from pathlib import Path
from typing import Any

from . import docgen, theme


TEMPLATES: tuple[dict[str, str], ...] = (
    # PowerPoint
    {"id": "presentation.editorial", "format": "pptx", "name": "Editorial Story", "description": "Воздушная редакционная презентация с сильными заголовками и большим количеством пространства.", "style": "editorial"},
    {"id": "presentation.pitch", "format": "pptx", "name": "Pitch Deck", "description": "Продуктовая или стартап-презентация: проблема, решение, рынок, метрики, план и вывод.", "style": "pitch"},
    {"id": "presentation.education", "format": "pptx", "name": "Learning Slides", "description": "Учебные слайды: понятия, примеры, шаги, сравнения, краткие выводы.", "style": "fluent"},
    {"id": "presentation.data-story", "format": "pptx", "name": "Data Story", "description": "Презентация с метриками, таблицами, диаграммами и проверяемыми выводами.", "style": "tufte"},
    {"id": "presentation.consulting", "format": "pptx", "name": "Consulting Report", "description": "Деловая презентация: executive summary, тезисы, показатели, сравнения, рекомендации.", "style": "consulting"},
    {"id": "presentation.product", "format": "pptx", "name": "Product Showcase", "description": "Презентация продукта с функциями, преимуществами, сценариями и дорожной картой.", "style": "stripe"},
    {"id": "presentation.minimal", "format": "pptx", "name": "Minimal Slides", "description": "Минималистичная презентация с одной мыслью на слайд.", "style": "minimal"},
    # Word / PDF
    {"id": "document.editorial", "format": "docx", "name": "Editorial Document", "description": "Красивый документ с обложкой, иерархией заголовков, врезками и таблицами.", "style": "editorial"},
    {"id": "document.research", "format": "docx", "name": "Research Report", "description": "Исследовательский или аналитический отчёт: разделы, факты, таблицы, ограничения и выводы.", "style": "scientific"},
    {"id": "document.proposal", "format": "docx", "name": "Business Proposal", "description": "Коммерческое предложение с проблемой, решением, объёмом работ, сроками и бюджетом.", "style": "consulting"},
    {"id": "document.academic", "format": "docx", "name": "Academic Paper", "description": "Учебная или академическая работа с разделами, таблицами и списком выводов.", "style": "academic"},
    {"id": "document.resume", "format": "docx", "name": "Resume", "description": "Резюме с компактными разделами, достижениями и навыками.", "style": "swiss"},
    {"id": "document.manual", "format": "docx", "name": "Practical Guide", "description": "Пошаговая инструкция с нумерованными действиями, предупреждениями и контрольным списком.", "style": "notion"},
    {"id": "pdf.report", "format": "pdf", "name": "PDF Report", "description": "Форматированный отчёт PDF с обложкой, разделами и аккуратной версткой.", "style": "editorial"},
    {"id": "pdf.research", "format": "pdf", "name": "Scientific PDF", "description": "Научный PDF с лаконичной типографикой, подписями и диаграммами.", "style": "scientific"},
    {"id": "pdf.handout", "format": "pdf", "name": "Study Handout", "description": "Учебная памятка или раздаточный материал.", "style": "academic"},
    # Excel / data
    {"id": "spreadsheet.analytics", "format": "xlsx", "name": "Analytics Workbook", "description": "Аналитическая книга с оформленными шапками, чередованием строк, фильтрами и итогами.", "style": "tufte"},
    {"id": "spreadsheet.finance", "format": "xlsx", "name": "Finance Workbook", "description": "Финансовая таблица с денежными форматами, итогами и спокойной деловой палитрой.", "style": "financial"},
    {"id": "spreadsheet.tracker", "format": "xlsx", "name": "Project Tracker", "description": "План или трекер с этапами, ответственными, статусами и сроками.", "style": "fluent"},
    {"id": "spreadsheet.catalog", "format": "xlsx", "name": "Comparison Matrix", "description": "Каталог, сравнение вариантов или структурированный реестр.", "style": "carbon"},
    # Vector / raster
    {"id": "vector.infographic", "format": "svg", "name": "Vector Infographic", "description": "Редактируемая векторная инфографика из карточек, метрик, текста и таблиц.", "style": "infographic"},
    {"id": "vector.flowchart", "format": "svg", "name": "Flowchart", "description": "Векторная блок-схема или последовательность этапов.", "style": "blueprint"},
    {"id": "vector.process", "format": "svg", "name": "Process Map", "description": "Карта процесса, последовательность шагов и связи между ними.", "style": "swiss"},
    {"id": "vector.poster", "format": "svg", "name": "Editorial Poster", "description": "Плакат с большой типографикой, палитрой и смысловыми карточками.", "style": "bauhaus"},
    {"id": "image.infographic", "format": "png", "name": "PNG Infographic", "description": "Растровая инфографика высокого разрешения с заголовком, метриками и блоками.", "style": "infographic"},
    {"id": "image.poster", "format": "png", "name": "PNG Poster", "description": "Плакат или обложка с выразительным заголовком и оформленными блоками.", "style": "editorial"},
    {"id": "image.chart", "format": "png", "name": "Chart Canvas", "description": "Читаемое изображение диаграммы с подписью и единым стилем.", "style": "tufte"},
    {"id": "image.social-card", "format": "png", "name": "Social Card", "description": "Карточка для публикации или анонса.", "style": "bento"},
    # Interoperable simple formats
    {"id": "data.csv", "format": "csv", "name": "Clean CSV", "description": "Структурированные данные с единой строкой заголовков.", "style": "minimal"},
    {"id": "data.json", "format": "json", "name": "Structured JSON", "description": "Проверяемая структурированная JSON-выгрузка.", "style": "minimal"},
    {"id": "document.markdown", "format": "md", "name": "Markdown Document", "description": "Структурированный Markdown-документ с заголовками, списками и таблицами.", "style": "editorial"},
    {"id": "document.plain-text", "format": "txt", "name": "Plain Text", "description": "Чистый текст без лишнего оформления.", "style": "minimal"},
)

TEMPLATE_BY_ID = {item["id"]: item for item in TEMPLATES}
FORMAT_ALIASES = {
    "presentation": "pptx", "slides": "pptx", "powerpoint": "pptx",
    "word": "docx", "document": "docx",
    "excel": "xlsx", "spreadsheet": "xlsx", "sheet": "xlsx",
    "vector": "svg", "image": "png", "markdown": "md", "text": "txt",
}
FORMAT_EXTENSIONS = {
    "pptx": ".pptx", "docx": ".docx", "xlsx": ".xlsx", "pdf": ".pdf",
    "svg": ".svg", "png": ".png", "csv": ".csv", "json": ".json",
    "md": ".md", "txt": ".txt",
}
DEFAULT_TEMPLATE = {
    "pptx": "presentation.editorial", "docx": "document.editorial",
    "xlsx": "spreadsheet.analytics", "pdf": "pdf.report",
    "svg": "vector.infographic", "png": "image.infographic",
    "csv": "data.csv", "json": "data.json", "md": "document.markdown",
    "txt": "document.plain-text",
}
PALETTE_ALIASES = {"background": "bg", "primary": "primary", "accent": "accent",
                   "surface": "surface", "text": "text", "muted": "muted"}
BLOCK_ALIASES = {
    "paragraph": "text", "body": "text", "heading": "h1", "subheading": "h2",
    "columns": "two_col", "two-columns": "two_col", "two-columns-slide": "two_col",
    "stats": "metrics", "kpi": "metrics", "data-table": "table", "data_table": "table",
    "steps": "bullets", "list": "bullets", "conclusion": "section",
    "divider": "section", "cover": "section",
}


def catalog() -> dict[str, Any]:
    """Return a serialisable catalogue of every template and all 57 design styles."""
    return {
        "templates": [dict(item) for item in TEMPLATES],
        "styles": [
            {"id": theme.palette(style)["name"], "description": theme.palette(style)["mood"],
             "font": theme.palette(style)["font"], "palette": theme.palette(style)}
            for style in theme.catalog() if not style.startswith("_")
        ],
        "formats": list(FORMAT_EXTENSIONS),
        "plan_version": 1,
    }


def catalog_text() -> str:
    """Compact system-prompt excerpt describing every template and style."""
    lines = ["Available file templates (id | format | look):"]
    for item in TEMPLATES:
        lines.append(f'- {item["id"]} | {item["format"]} | {item["name"]}: {item["description"]} Default style: {item["style"]}.')
    styles = []
    for style in theme.catalog():
        if style.startswith("_"):
            continue
        p = theme.palette(style)
        styles.append(f'{style} ({p["mood"]})')
    lines.append("All design styles: " + ", ".join(styles))
    return "\n".join(lines)


def _normal_format(value: Any) -> str:
    fmt = str(value or "").strip().lower().lstrip(".")
    fmt = FORMAT_ALIASES.get(fmt, fmt)
    if fmt not in FORMAT_EXTENSIONS:
        raise ValueError("Неподдерживаемый формат файла. Доступны: " + ", ".join(FORMAT_EXTENSIONS))
    return fmt


def _clean_filename(value: Any, title: str, fmt: str) -> str:
    ext = FORMAT_EXTENSIONS[fmt]
    raw = str(value or title or "ai-ch-file").strip()
    # Discard any supplied path; the plan may only select a filename, never a directory.
    raw = Path(raw.replace("\\", "/")).name
    raw = re.sub(r"\.[A-Za-z0-9]{1,8}$", "", raw)
    raw = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "-", raw)
    raw = re.sub(r"\s+", "-", raw).strip(" .-_")
    raw = raw[:100].strip(" .-_") or "ai-ch-file"
    return raw + ext


def _normalise_block(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"kind": "text", "text": str(value)[:8000]}
    block = dict(value)
    kind = str(block.get("kind") or block.get("layout") or block.get("type") or "text").strip().lower()
    kind = BLOCK_ALIASES.get(kind, kind.replace("-", "_"))
    if kind == "two_col":
        block["kind"] = "two_col"
    else:
        block["kind"] = kind
    block.pop("layout", None)
    block.pop("type", None)
    if "body" in block and "text" not in block:
        block["text"] = block.pop("body")
    if "content" in block and "text" not in block and isinstance(block["content"], str):
        block["text"] = block.pop("content")
    return block


def _normalise_palette(value: Any, style: str) -> tuple[str, tuple[str, ...] | None]:
    """Validate optional hex colour overrides and map them to a private style."""
    base = theme.palette(style)
    if value is None:
        return style, None
    if not isinstance(value, dict):
        raise ValueError("palette должна быть объектом с цветами.")
    raw = {}
    for key, val in value.items():
        dest = PALETTE_ALIASES.get(str(key).lower())
        if not dest:
            raise ValueError(f"Неизвестный цвет палитры: {key}")
        color = str(val).strip()
        if not re.fullmatch(r"#(?:[0-9a-fA-F]{6})", color):
            raise ValueError(f"Цвет {key} должен иметь формат #RRGGBB.")
        raw[dest] = color.upper()
    palette_tuple = (
        raw.get("bg", base["bg"]), raw.get("surface", base["surface"]),
        raw.get("text", base["text"]), raw.get("muted", base["muted"]),
        raw.get("primary", base["primary"]), raw.get("accent", base["accent"]),
        base["font"], base["mood"] + " · пользовательская палитра",
    )
    return "_fileplan_custom", palette_tuple


def validate_plan(plan: Any) -> dict[str, Any]:
    """Validate and normalise a data-only file plan before any file is written."""
    if isinstance(plan, str):
        try:
            plan = json.loads(plan)
        except json.JSONDecodeError as exc:
            raise ValueError(f"План не является корректным JSON: {exc.msg}.") from exc
    if not isinstance(plan, dict):
        raise ValueError("План файла должен быть JSON-объектом.")
    if len(json.dumps(plan, ensure_ascii=False)) > 180_000:
        raise ValueError("План файла слишком большой (лимит 180 КБ).")

    fmt = _normal_format(plan.get("format"))
    template_id = str(plan.get("template_id") or DEFAULT_TEMPLATE[fmt]).strip()
    template = TEMPLATE_BY_ID.get(template_id)
    if template is None:
        raise ValueError("Неизвестный шаблон. Доступные шаблоны: " + ", ".join(TEMPLATE_BY_ID))
    if template["format"] != fmt:
        raise ValueError(f"Шаблон {template_id} предназначен для формата {template['format']}, а запрос указан как {fmt}.")
    title = str(plan.get("title") or "Новый файл").strip()[:180]
    style = str(plan.get("style") or template["style"]).strip().lower()
    if style not in theme.catalog():
        raise ValueError("Неизвестный стиль. Доступные стили: " + ", ".join(theme.catalog()))

    clean = dict(plan)
    clean.update({"version": 1, "format": fmt, "template_id": template_id,
                  "title": title, "style": style, "filename": _clean_filename(plan.get("filename"), title, fmt)})

    # Both "slides" and "blocks" are accepted as layout commands.
    raw_blocks = plan.get("blocks")
    if raw_blocks is None:
        raw_blocks = plan.get("slides")
    if raw_blocks is None:
        raw_blocks = plan.get("sections")
    if raw_blocks is None:
        raw_blocks = plan.get("items")
    if raw_blocks is None:
        raw_blocks = []
    if not isinstance(raw_blocks, list):
        raise ValueError("blocks/slides/sections должны быть списком команд.")
    max_blocks = 36 if fmt in ("docx", "pdf", "md", "txt") else 24
    if len(raw_blocks) > max_blocks:
        raise ValueError(f"Слишком много блоков ({len(raw_blocks)}); предел для {fmt} — {max_blocks}.")
    clean["blocks"] = [_normalise_block(b) for b in raw_blocks]
    for i, block in enumerate(clean["blocks"]):
        if len(str(block.get("text") or "")) > 12000:
            raise ValueError(f"Текст блока {i + 1} слишком длинный.")
        if "items" in block and isinstance(block["items"], list) and len(block["items"]) > 30:
            raise ValueError(f"В блоке {i + 1} слишком много элементов.")

    if fmt == "pptx":
        supported = {"section", "bullets", "two_col", "metrics", "chart", "image", "table", "quote", "text"}
        for i, block in enumerate(clean["blocks"]):
            if block["kind"] not in supported:
                raise ValueError(f"Макет слайда {i + 1}: неподдерживаемый layout {block['kind']}.")
    elif fmt in ("docx", "pdf"):
        supported = {"h1", "h2", "h3", "text", "bullets", "numbers", "callout", "table", "image", "pagebreak"}
        for i, block in enumerate(clean["blocks"]):
            if block["kind"] not in supported:
                # A slide-style command is safely converted to a regular section in reports.
                if block["kind"] in {"section", "quote", "two_col", "metrics"}:
                    block["kind"] = "h2" if block["kind"] in {"section", "metrics"} else "text"
                else:
                    raise ValueError(f"Блок документа {i + 1}: неподдерживаемый тип {block['kind']}.")
    elif fmt == "xlsx":
        sheets = plan.get("sheets")
        if sheets is None:
            tables = [b for b in clean["blocks"] if b.get("kind") == "table"]
            sheets = []
            for index, table in enumerate(tables or [{}], start=1):
                sheets.append({"name": table.get("title") or f"Лист {index}",
                               "head": table.get("head") or [],
                               "rows": table.get("rows") or []})
        if not isinstance(sheets, list) or not sheets:
            raise ValueError("Для XLSX укажи sheets: список листов с head и rows.")
        if len(sheets) > 12:
            raise ValueError("В книге XLSX можно создать не более 12 листов за один запрос.")
        total_rows = 0
        normal_sheets = []
        for index, sh in enumerate(sheets, start=1):
            if not isinstance(sh, dict):
                raise ValueError(f"Лист XLSX {index} должен быть объектом.")
            head = sh.get("head") or []
            rows = sh.get("rows") or []
            if not isinstance(head, list) or not isinstance(rows, list):
                raise ValueError(f"Для листа XLSX {index} head и rows должны быть списками.")
            if len(head) > 40 or any(not isinstance(row, (list, tuple)) or len(row) > 40 for row in rows):
                raise ValueError(f"Лист XLSX {index}: предел — 40 столбцов.")
            if len(rows) > 1500:
                raise ValueError(f"Лист XLSX {index}: предел — 1500 строк за файл.")
            total_rows += len(rows)
            normal_sheets.append({**sh, "name": str(sh.get("name") or f"Лист {index}")[:31],
                                  "head": head, "rows": rows})
        if total_rows > 5000:
            raise ValueError("Слишком много строк для одного плана (общий предел 5000).")
        clean["sheets"] = normal_sheets
    else:
        clean["blocks"] = clean["blocks"][:16]

    palette_style, palette_tuple = _normalise_palette(plan.get("palette"), style)
    clean["_resolved_style"] = palette_style
    clean["_palette_tuple"] = palette_tuple
    return clean


def _output_text(value: Any) -> str:
    return str(value or "").strip()


def _slug(title: str) -> str:
    slug = re.sub(r"[^\w.-]+", "-", title.lower(), flags=re.UNICODE).strip(" .-_")
    return (slug[:70].strip(" .-_") or "ai-ch-file")


def _render_svg(path: Path, plan: dict[str, Any], p: dict[str, str]) -> str:
    width = min(2400, max(900, int(plan.get("width") or 1600)))
    blocks = plan.get("blocks") or []
    height = min(2800, max(900, 250 + 175 * max(1, len(blocks))))
    fg = html.escape(p["text"])
    bg = html.escape(p["bg"])
    primary = html.escape(p["primary"])
    accent = html.escape(p["accent"])
    muted = html.escape(p["muted"])
    surface = html.escape(p["surface"])
    title = html.escape(str(plan.get("title") or "Инфографика"))
    subtitle = html.escape(str(plan.get("subtitle") or ""))
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        f'<rect width="{width}" height="{height}" rx="24" fill="{bg}"/>',
        f'<rect width="{width}" height="16" fill="{primary}"/>',
        f'<rect x="70" y="64" width="12" height="110" rx="6" fill="{accent}"/>',
        f'<text x="110" y="108" font-family="Inter,Manrope,sans-serif" font-size="46" font-weight="700" fill="{fg}">{title}</text>',
    ]
    if subtitle:
        parts.append(f'<text x="110" y="156" font-family="Inter,Manrope,sans-serif" font-size="23" fill="{muted}">{subtitle}</text>')
    y = 220
    for index, block in enumerate(blocks[:16]):
        kind = str(block.get("kind") or "text").lower()
        x, card_w, card_h = 70, width - 140, 130
        if kind in {"metrics", "metric"}:
            metrics = block.get("items") or []
            count = min(4, max(1, len(metrics)))
            gap = 18
            card_w = (width - 140 - gap * (count - 1)) // count
            for i, metric in enumerate(metrics[:count]):
                mx = 70 + i * (card_w + gap)
                parts.append(f'<rect x="{mx}" y="{y}" width="{card_w}" height="142" rx="16" fill="{surface}" stroke="{html.escape(p["muted"])}" stroke-opacity=".25"/>')
                parts.append(f'<rect x="{mx}" y="{y}" width="6" height="142" rx="3" fill="{accent if i % 2 else primary}"/>')
                val = html.escape(str(metric.get("value", "")))
                label = html.escape(str(metric.get("label", "")))
                parts.append(f'<text x="{mx+26}" y="{y+58}" font-family="Inter,Manrope,sans-serif" font-size="36" font-weight="700" fill="{primary}">{val}</text>')
                parts.append(f'<text x="{mx+26}" y="{y+98}" font-family="Inter,Manrope,sans-serif" font-size="17" fill="{muted}">{label}</text>')
            y += 166
            continue
        heading = html.escape(str(block.get("title") or block.get("kicker") or f"Блок {index+1}"))
        text = str(block.get("text") or "")
        items = block.get("items") or []
        rows = block.get("rows") or []
        head = block.get("head") or []
        if kind == "table":
            card_h = min(220, 74 + 26 * (min(5, len(rows)) + (1 if head else 0)))
        elif kind == "quote":
            card_h = 146
        else:
            card_h = min(170, 92 + min(3, len(items)) * 22)
        parts.append(f'<rect x="{x}" y="{y}" width="{card_w}" height="{card_h}" rx="16" fill="{surface}" stroke="{html.escape(p["muted"])}" stroke-opacity=".22"/>')
        parts.append(f'<text x="{x+26}" y="{y+34}" font-family="Inter,Manrope,sans-serif" font-size="22" font-weight="650" fill="{primary}">{heading}</text>')
        if kind == "table":
            columns = head or (rows[0] if rows else [])
            row_values = rows if head else rows[1:]
            cell_w = card_w / max(1, len(columns))
            if columns:
                parts.append(f'<rect x="{x+18}" y="{y+48}" width="{card_w-36}" height="27" rx="5" fill="{primary}" fill-opacity=".12"/>')
                for ci, cell in enumerate(columns[:8]):
                    parts.append(f'<text x="{x+26+ci*cell_w}" y="{y+68}" font-family="Inter,Manrope,sans-serif" font-size="13" fill="{fg}">{html.escape(str(cell))}</text>')
            for ri, row in enumerate(row_values[:5]):
                if y+96+ri*22 < y+card_h-8:
                    for ci, cell in enumerate(row[:8]):
                        parts.append(f'<text x="{x+26+ci*cell_w}" y="{y+94+ri*22}" font-family="Inter,Manrope,sans-serif" font-size="12" fill="{muted}">{html.escape(str(cell))}</text>')
        else:
            lines = [text] if text else [str(v) for v in items[:3]]
            for li, line in enumerate(lines[:3]):
                # Bound each SVG line so a generated file stays readable and lightweight.
                safe_line = html.escape(textwrap.shorten(str(line), width=135, placeholder="…"))
                parts.append(f'<text x="{x+26}" y="{y+66+li*24}" font-family="Inter,Manrope,sans-serif" font-size="16" fill="{fg}">{safe_line}</text>')
        y += card_h + 20
        if y > height - 80:
            break
    parts.append(f'<text x="{width-70}" y="{height-30}" text-anchor="end" font-family="Inter,Manrope,sans-serif" font-size="12" fill="{muted}">Создано в AI-CH · {html.escape(str(plan.get("template_id", "")))}</text>')
    parts.append("</svg>")
    path.write_text("\n".join(parts), encoding="utf-8")
    return str(path)


def _font_for_size(size: int):
    from PIL import ImageFont
    candidates = (
        "/srv/fonts/Manrope-Regular.ttf",
        "/srv/fonts/Inter-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    )
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def _wrap_pixels(draw, text: str, font, max_width: int, limit: int = 3) -> list[str]:
    words = str(text or "").split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = (current + " " + word).strip()
        if current and draw.textlength(candidate, font=font) > max_width:
            lines.append(current)
            current = word
            if len(lines) >= limit:
                break
        else:
            current = candidate
    if current and len(lines) < limit:
        lines.append(current)
    if len(lines) == limit and words and lines[-1] and len(" ".join(lines)) < len(" ".join(words)):
        last = lines[-1]
        while last and draw.textlength(last + "…", font=font) > max_width:
            last = last[:-1]
        lines[-1] = last.rstrip() + "…"
    return lines or [""]


def _render_png(path: Path, plan: dict[str, Any], p: dict[str, str]) -> str:
    from PIL import Image, ImageDraw

    width = min(2400, max(900, int(plan.get("width") or 1600)))
    blocks = plan.get("blocks") or []
    height = min(2800, max(900, int(plan.get("height") or (300 + 170 * max(1, len(blocks))))))
    image = Image.new("RGB", (width, height), p["bg"])
    draw = ImageDraw.Draw(image)
    title_font = _font_for_size(max(30, width // 28))
    subtitle_font = _font_for_size(max(16, width // 68))
    heading_font = _font_for_size(max(19, width // 66))
    body_font = _font_for_size(max(15, width // 92))
    muted_font = _font_for_size(max(12, width // 110))
    margin, gap = width // 22, 18
    draw.rectangle((0, 0, width, 16), fill=p["primary"])
    draw.rounded_rectangle((margin, 58, margin + 12, 160), radius=6, fill=p["accent"])
    draw.text((margin + 34, 60), str(plan.get("title") or "Инфографика"), font=title_font, fill=p["text"])
    if plan.get("subtitle"):
        draw.text((margin + 34, 128), str(plan["subtitle"]), font=subtitle_font, fill=p["muted"])
    y = 205
    card_w = width - margin * 2
    for index, block in enumerate(blocks[:16]):
        kind = str(block.get("kind") or "text").lower()
        title = str(block.get("title") or block.get("kicker") or f"Блок {index+1}")
        if kind in {"metrics", "metric"}:
            metrics = (block.get("items") or [])[:4]
            count = max(1, len(metrics))
            metric_w = (card_w - gap * (count - 1)) // count
            for i, metric in enumerate(metrics):
                x = margin + i * (metric_w + gap)
                draw.rounded_rectangle((x, y, x + metric_w, y + 138), radius=16, fill=p["surface"], outline=p["muted"], width=1)
                draw.rounded_rectangle((x, y, x + 7, y + 138), radius=4, fill=p["accent"] if i % 2 else p["primary"])
                draw.text((x + 22, y + 25), str(metric.get("value", ""))[:24], font=heading_font, fill=p["primary"])
                draw.text((x + 22, y + 81), str(metric.get("label", ""))[:55], font=muted_font, fill=p["muted"])
            y += 155
            continue
        rows = block.get("rows") or []
        head = block.get("head") or []
        items = block.get("items") or []
        text = str(block.get("text") or "")
        card_h = min(230, 94 + min(5, len(rows)) * 24) if kind == "table" else 142
        draw.rounded_rectangle((margin, y, width - margin, y + card_h), radius=15, fill=p["surface"], outline=p["muted"], width=1)
        draw.text((margin + 23, y + 16), title[:95], font=heading_font, fill=p["primary"])
        if kind == "table":
            columns = head or (rows[0] if rows else [])
            data_rows = rows if head else rows[1:]
            count = max(1, min(6, len(columns)))
            cell_w = (card_w - 44) // count
            draw.rounded_rectangle((margin + 18, y + 53, width - margin - 18, y + 81), radius=5, fill=p["bg"])
            for ci, value in enumerate(columns[:count]):
                draw.text((margin + 24 + ci * cell_w, y + 59), str(value)[:25], font=muted_font, fill=p["text"])
            for ri, row in enumerate(data_rows[:5]):
                for ci, value in enumerate(row[:count]):
                    draw.text((margin + 24 + ci * cell_w, y + 87 + ri * 24), str(value)[:30], font=muted_font, fill=p["muted"])
        else:
            lines = _wrap_pixels(draw, text or " · ".join(str(v) for v in items[:4]), body_font, card_w - 48, limit=3)
            for li, line in enumerate(lines):
                draw.text((margin + 24, y + 57 + li * 25), line, font=body_font, fill=p["text"])
        y += card_h + gap
        if y > height - 80:
            break
    draw.text((margin, height - 40), f"AI-CH · {plan.get('template_id', '')}", font=muted_font, fill=p["muted"])
    image.save(path, format="PNG", optimize=True)
    return str(path)


def _render_simple_text(outdir: Path, plan: dict[str, Any], fmt: str) -> list[str]:
    out = outdir / plan["filename"]
    if fmt == "csv":
        sheets = plan.get("sheets") or [{"head": plan.get("head") or [], "rows": plan.get("rows") or []}]
        with out.open("w", newline="", encoding="utf-8-sig") as stream:
            writer = csv.writer(stream)
            for index, sheet in enumerate(sheets):
                if index:
                    writer.writerow([])
                    writer.writerow([sheet.get("name") or f"Лист {index+1}"])
                if sheet.get("head"):
                    writer.writerow(sheet["head"])
                writer.writerows(sheet.get("rows") or [])
    elif fmt == "json":
        payload = {key: value for key, value in plan.items() if not key.startswith("_")}
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    elif fmt in ("md", "txt"):
        lines = [str(plan.get("title") or "")]
        if plan.get("subtitle"):
            lines.extend(["", str(plan["subtitle"])])
        for block in plan.get("blocks") or []:
            kind = block.get("kind", "text")
            text = str(block.get("text") or "")
            if kind in ("h1", "h2", "h3"):
                lines.extend(["", "#" * int(kind[1]) + " " + text])
            elif kind in ("bullets", "numbers"):
                lines.extend(["", *[(f"- {item}" if kind == "bullets" else f"{i}. {item}") for i, item in enumerate(block.get("items") or [], 1)]])
            elif kind == "table":
                head = block.get("head") or []
                rows = block.get("rows") or []
                if head:
                    lines.extend(["", "| " + " | ".join(map(str, head)) + " |",
                                  "| " + " | ".join("---" for _ in head) + " |"])
                lines.extend("| " + " | ".join(map(str, row)) + " |" for row in rows)
            elif text:
                lines.extend(["", text])
        out.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    return [str(out)]


def build_from_plan(outdir: str | Path, plan: Any) -> dict[str, Any]:
    """Validate a model-authored command plan and render the requested files."""
    spec = validate_plan(plan)
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    fmt = spec["format"]
    style = spec["_resolved_style"]
    palette_tuple = spec.get("_palette_tuple")
    previous_custom = theme.STYLES.get("_fileplan_custom")
    if palette_tuple is not None:
        theme.STYLES["_fileplan_custom"] = palette_tuple

    try:
        palette = theme.palette(style)
        spec["style"] = style
        spec.pop("_resolved_style", None)
        spec.pop("_palette_tuple", None)
        spec.pop("template_id", None)
        spec.pop("version", None)
        spec.pop("filename", None)
        spec.pop("palette", None)
        if fmt in ("svg", "png"):
            output = outdir / _clean_filename(plan.get("filename"), spec.get("title", "graphic"), fmt)
            primary = _render_svg(output, spec, palette) if fmt == "svg" else _render_png(output, spec, palette)
            files = [primary]
            previews: list[str] = []
        elif fmt in ("csv", "json", "md", "txt"):
            files = _render_simple_text(outdir, {**spec, "filename": _clean_filename(plan.get("filename"), plan.get("title", "file"), fmt)}, fmt)
            previews = []
        else:
            result = docgen.build(outdir, spec)
            files = list(result.get("files") or [])
            previews = list(result.get("previews") or [])
            expected_name = {
                "pptx": "presentation.pptx", "docx": "document.docx",
                "xlsx": "workbook.xlsx", "pdf": "document.pdf",
            }[fmt]
            primary_file = outdir / expected_name
            if primary_file.is_file():
                target = outdir / _clean_filename(plan.get("filename"), plan.get("title", "file"), fmt)
                if target != primary_file:
                    primary_file.replace(target)
                files = [str(target) if Path(name) == primary_file else name for name in files]
        return {
            "ok": True,
            "format": fmt,
            "template_id": plan.get("template_id") or DEFAULT_TEMPLATE[fmt],
            "title": str(plan.get("title") or "Новый файл"),
            "files": files,
            "previews": previews,
            "style": style,
        }
    finally:
        if palette_tuple is not None:
            if previous_custom is None:
                theme.STYLES.pop("_fileplan_custom", None)
            else:
                theme.STYLES["_fileplan_custom"] = previous_custom
