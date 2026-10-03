"""ChatStudio design library — 57 готовых стилей оформления.

Агент внутри песочницы может делать так::

    import sys; sys.path.insert(0, '/srv')
    from designs import theme as T

    p = T.palette('apple-dark')          # цвета стиля
    T.pptx_title(prs, 'Заголовок', 'Подзаголовок', 'apple-dark')
    T.pptx_bullets(prs, 'План', ['Пункт 1', 'Пункт 2'], 'glass')
    T.pyplot('linear')                   # настроить matplotlib
    T.docx_style(doc, 'swiss')           # настроить Word

Каждый стиль — это палитра (фон, поверхность, текст, приглушённый, акцент,
второй акцент), шрифты и настроение. Всё детерминировано и без интернета.
"""
from __future__ import annotations

# name -> (bg, surface, text, muted, primary, accent, font, mood)
STYLES: dict[str, dict] = {
    # --- продуктовые системы ---
    "apple": ("#FFFFFF", "#F5F5F7", "#1D1D1F", "#6E6E73", "#0071E3", "#FF375F", "Helvetica Neue", "воздух, крупная типографика"),
    "apple-dark": ("#000000", "#1D1D1F", "#F5F5F7", "#86868B", "#0A84FF", "#FF375F", "Helvetica Neue", "тёмный премиум"),
    "fluent": ("#FFFFFF", "#F3F2F1", "#201F1E", "#605E5C", "#0078D4", "#106EBE", "Segoe UI", "строгая сетка Microsoft"),
    "fluent-dark": ("#201F1E", "#323130", "#F3F2F1", "#A19F9D", "#2899F5", "#50E6FF", "Segoe UI", "тёмный Fluent"),
    "material3": ("#FFFBFE", "#F3EDF7", "#1C1B1F", "#49454F", "#6750A4", "#7D5260", "Roboto", "Material You"),
    "carbon": ("#FFFFFF", "#F4F4F4", "#161616", "#525252", "#0F62FE", "#8A3FFC", "IBM Plex Sans", "корпоративный IBM"),
    "primer": ("#FFFFFF", "#F6F8FA", "#1F2328", "#656D76", "#0969DA", "#1A7F37", "Inter", "GitHub clean"),
    "atlassian": ("#FFFFFF", "#F1F2F4", "#172B4D", "#5E6C84", "#0052CC", "#6554C0", "Inter", "рабочий инструмент"),
    "stripe": ("#FFFFFF", "#F6F9FC", "#0A2540", "#425466", "#635BFF", "#00D4FF", "Inter", "градиент финтеха"),
    "vercel": ("#FFFFFF", "#FAFAFA", "#000000", "#666666", "#000000", "#0070F3", "Inter", "монохром, максимум контраста"),
    "linear": ("#0B0B0F", "#16161D", "#F7F8F8", "#8A8F98", "#5E6AD2", "#26C6DA", "Inter", "тёмный продукт"),
    "raycast": ("#141414", "#1F1F1F", "#FFFFFF", "#9A9A9A", "#FF6363", "#FFB224", "Inter", "тёмный акцент"),
    "notion": ("#FFFFFF", "#F7F6F3", "#37352F", "#787774", "#2383E2", "#EB5757", "Inter", "тихий документ"),
    "tailwind": ("#FFFFFF", "#F9FAFB", "#111827", "#6B7280", "#2563EB", "#8B5CF6", "Inter", "утилитарный"),
    "bootstrap": ("#FFFFFF", "#F8F9FA", "#212529", "#6C757D", "#0D6EFD", "#6F42C1", "system-ui", "классика веба"),

    # --- направления и настроения ---
    "glass": ("#EDF2FB", "#FFFFFF66", "#0F172A", "#64748B", "#3B82F6", "#22D3EE", "Inter", "матовое стекло, размытие"),
    "glass-dark": ("#0B1220", "#FFFFFF1A", "#F8FAFC", "#94A3B8", "#38BDF8", "#A78BFA", "Inter", "тёмное стекло"),
    "neumorphism": ("#E8EBF0", "#F2F4F8", "#3A4256", "#8892A6", "#5B7CFA", "#FF7A59", "Inter", "мягкие тени"),
    "clay": ("#FFF4EC", "#FFFFFF", "#4A3B32", "#9C8878", "#FF8A5B", "#4ECDC4", "Nunito", "пластилин, мягкие формы"),
    "neubrutalism": ("#FFFDF5", "#FFFFFF", "#111111", "#555555", "#FFD400", "#FF3B30", "Space Grotesk", "жирные обводки, тень без размытия"),
    "brutalism": ("#FFFFFF", "#FFFFFF", "#000000", "#444444", "#000000", "#FF0000", "Courier New", "сырой и громкий"),
    "swiss": ("#FFFFFF", "#F2F2F2", "#111111", "#767676", "#E30613", "#111111", "Helvetica", "международный стиль, сетка"),
    "bauhaus": ("#F4EFE6", "#FFFFFF", "#1A1A1A", "#7A7469", "#D62828", "#1D4E89", "Futura", "геометрия, первичные цвета"),
    "artdeco": ("#0E0B08", "#1A1409", "#F5E6C8", "#A79268", "#C9A227", "#8C6D1F", "Playfair Display", "золото и симметрия"),
    "midcentury": ("#FDF6E3", "#FFFFFF", "#3B3226", "#8A7B66", "#E07A5F", "#3D8361", "Futura", "50-е, тёплые тона"),
    "scandinavian": ("#FAFAF7", "#FFFFFF", "#2F2F2C", "#7C7C74", "#5C7A6B", "#C9A66B", "Inter", "северный минимализм"),
    "japanese": ("#FBFAF6", "#FFFFFF", "#2B2B2B", "#8C8C86", "#B03A2E", "#3E5C4B", "Noto Sans JP", "ма фу, пустота и акцент"),
    "wabisabi": ("#EFE9E1", "#F7F3EC", "#4A4238", "#948A7C", "#8C6E54", "#6B7F6E", "Georgia", "несовершенство и текстура"),
    "nordic-dark": ("#1B1F23", "#262B31", "#E6E9EC", "#98A2AC", "#7FB3D5", "#E59866", "Inter", "северная ночь"),
    "memphis": ("#FFF9E6", "#FFFFFF", "#1A1A1A", "#6E6E6E", "#FF5E5B", "#00CECB", "Poppins", "игривые фигуры 80-х"),
    "vaporwave": ("#1A0B2E", "#2A1046", "#F7E7FF", "#B18CD9", "#FF71CE", "#01CDFE", "Montserrat", "неон и ретро-градиент"),
    "y2k": ("#EAF6FF", "#FFFFFF", "#0B2545", "#5C7A99", "#4EA8DE", "#B9FBC0", "Trebuchet MS", "металлик и глянец нулевых"),
    "cyberpunk": ("#0A0A12", "#141425", "#EAFBFF", "#7C8AA5", "#FF2E88", "#00F0FF", "Rajdhani", "неон, техно, высокий контраст"),
    "solarpunk": ("#F3FBF2", "#FFFFFF", "#233A2B", "#6C8B72", "#3FA34D", "#F2C14E", "Inter", "оптимистичная экология"),
    "retro70": ("#FBF0D9", "#FFFFFF", "#4A3728", "#8E7A5E", "#D2691E", "#6B8E23", "Cooper Black", "тёплое ретро"),
    "isometric": ("#F0F4F8", "#FFFFFF", "#1F2937", "#6B7280", "#3B82F6", "#F59E0B", "Inter", "3D-изометрия"),
    "bento": ("#F5F5F7", "#FFFFFF", "#1D1D1F", "#86868B", "#0071E3", "#30D158", "Inter", "плиточная сетка"),
    "aurora": ("#070B18", "#101733", "#E8ECFF", "#93A0C8", "#6366F1", "#22D3EE", "Inter", "градиентное сияние"),
    "kinetic": ("#FFFFFF", "#FFFFFF", "#000000", "#666666", "#FF3D00", "#111111", "Anton", "крупная динамичная типографика"),

    # --- документы и данные ---
    "editorial": ("#FFFDF9", "#FFFFFF", "#1A1A1A", "#6B6B6B", "#B23A2E", "#1F4E5F", "Georgia", "журнальная вёрстка"),
    "newspaper": ("#F7F5EF", "#FFFFFF", "#111111", "#5A5A5A", "#000000", "#8B0000", "Times New Roman", "газетная сетка"),
    "scientific": ("#FFFFFF", "#F7F7F7", "#111111", "#5A5A5A", "#1F4E79", "#C00000", "Latin Modern", "научная статья"),
    "academic": ("#FFFFFF", "#F5F5F5", "#222222", "#666666", "#2E5C8A", "#8C6D1F", "Cambria", "академический постер"),
    "financial": ("#0C0F14", "#151A21", "#E6EDF3", "#8B949E", "#2F81F7", "#3FB950", "IBM Plex Mono", "терминал Bloomberg"),
    "consulting": ("#FFFFFF", "#F2F4F7", "#1B2A41", "#5B6B7C", "#1F4E79", "#C9A227", "Arial", "слайды стратегии"),
    "pitch": ("#0E1116", "#171C24", "#FFFFFF", "#9BA6B2", "#7C3AED", "#22D3EE", "Inter", "питч-дек для инвесторов"),
    "legal": ("#FFFFFF", "#F8F8F8", "#1A1A1A", "#5A5A5A", "#333333", "#7A1F1F", "Times New Roman", "строгий документ"),
    "medical": ("#F7FBFF", "#FFFFFF", "#12324F", "#5C7A93", "#0E7C9B", "#38B2AC", "Inter", "клинический чистый"),
    "infographic": ("#FFFFFF", "#F4F7FB", "#16233A", "#63758F", "#F97316", "#0EA5E9", "Poppins", "крупные цифры и блоки"),

    # --- изобразительные ---
    "tufte": ("#FFFFF8", "#FFFFFF", "#111111", "#666666", "#B22222", "#4C72B0", "ET Book", "минимум чернил, максимум данных"),
    "blueprint": ("#0B2E4F", "#123C63", "#EAF4FF", "#8FB6D9", "#FFFFFF", "#7FD1FF", "IBM Plex Mono", "чертёж, размерные линии"),
    "terminal": ("#0C0C0C", "#141414", "#D8E4D8", "#7A8A7A", "#3FB950", "#D29922", "JetBrains Mono", "консоль"),
    "pixel": ("#1A1C2C", "#262B44", "#F4F4F4", "#94B0C2", "#EF7D57", "#41A6F6", "monospace", "пиксель-арт"),
    "sketch": ("#FFFDF6", "#FFFFFF", "#2B2B2B", "#7A7A7A", "#3A6EA5", "#C05621", "Comic Neue", "рукописный набросок"),
    "kids": ("#FFF9F0", "#FFFFFF", "#3D2C1E", "#8A7566", "#FF6B6B", "#4ECDC4", "Nunito", "детская иллюстрация"),
    "photo": ("#0A0A0A", "#161616", "#FFFFFF", "#A0A0A0", "#FFFFFF", "#F5A623", "Inter", "фотореализм, монтаж"),
    "minimal": ("#FFFFFF", "#FFFFFF", "#111111", "#777777", "#111111", "#777777", "Helvetica", "только типографика"),
}

FALLBACK = "minimal"


def catalog() -> list[str]:
    return sorted(STYLES)


def get(name: str) -> dict:
    """Palette dict for a style name (falls back to ``minimal``)."""
    key = (name or "").strip().lower().replace(" ", "-").replace("_", "-")
    raw = STYLES.get(key) or STYLES[FALLBACK]
    bg, surface, text, muted, primary, accent, font, mood = raw
    return {
        "name": key if key in STYLES else FALLBACK,
        "bg": bg,
        "surface": surface,
        "text": text,
        "muted": muted,
        "primary": primary,
        "accent": accent,
        "font": font,
        "mood": mood,
    }


def palette(name: str) -> dict:
    return get(name)


def _rgb(value: str):
    v = (value or "#000000").strip()
    if len(v) == 9:  # #RRGGBBAA -> ignore alpha for office formats
        v = v[:7]
    v = v.lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))


def hexcolor(value: str) -> str:
    v = (value or "#000000").strip().lstrip("#")[:6]
    return v.upper()


# ---------------------------------------------------------------- PowerPoint

def pptx_slide(prs, style: str = "minimal", blank: bool = True):
    """Новый слайд в нужном размере с залитым фоном стиля."""
    from pptx.dml.color import RGBColor
    from pptx.util import Emu

    p = get(style)
    layout = prs.slide_layouts[6] if blank and len(prs.slide_layouts) > 6 else prs.slide_layouts[0]
    slide = prs.slides.add_slide(layout)
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = RGBColor(*_rgb(p["bg"]))
    slide.width, slide.height = prs.slide_width, prs.slide_height
    _ = Emu(1)
    return slide


def pptx_text(slide, text, left, top, width, height, size=24, color=None,
              bold=False, align=None, font=None, style="minimal"):
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN
    from pptx.util import Emu, Pt

    p = get(style)
    box = slide.shapes.add_textbox(Emu(int(left)), Emu(int(top)), Emu(int(width)), Emu(int(height)))
    tf = box.text_frame
    tf.word_wrap = True
    para = tf.paragraphs[0]
    para.text = str(text)
    if align == "center":
        para.alignment = PP_ALIGN.CENTER
    elif align == "right":
        para.alignment = PP_ALIGN.RIGHT
    run = para.runs[0] if para.runs else para.add_run()
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.name = font or p["font"]
    run.font.color.rgb = RGBColor(*_rgb(color or p["text"]))
    return box


def pptx_title(prs, title, subtitle="", style="apple"):
    """Титульный слайд: крупный заголовок + подзаголовок + акцентная полоса."""
    from pptx.dml.color import RGBColor
    from pptx.util import Emu

    p = get(style)
    slide = pptx_slide(prs, style)
    w, h = prs.slide_width, prs.slide_height
    bar = slide.shapes.add_shape(1, Emu(int(w * 0.08)), Emu(int(h * 0.36)),
                                 Emu(int(w * 0.10)), Emu(int(h * 0.012)))
    bar.fill.solid()
    bar.fill.fore_color.rgb = RGBColor(*_rgb(p["primary"]))
    bar.line.fill.background()
    pptx_text(slide, title, w * 0.08, h * 0.40, w * 0.80, h * 0.18,
              size=44, bold=True, style=style)
    if subtitle:
        pptx_text(slide, subtitle, w * 0.08, h * 0.60, w * 0.70, h * 0.12,
                  size=18, color=p["muted"], style=style)
    return slide


def pptx_bullets(prs, title, bullets, style="fluent", note=""):
    """Слайд с заголовком и списком (акцентные маркеры)."""
    from pptx.dml.color import RGBColor
    from pptx.util import Emu

    p = get(style)
    slide = pptx_slide(prs, style)
    w, h = prs.slide_width, prs.slide_height
    pptx_text(slide, title, w * 0.07, h * 0.10, w * 0.86, h * 0.14, size=30, bold=True, style=style)
    y = h * 0.28
    for item in bullets[:6]:
        dot = slide.shapes.add_shape(9, Emu(int(w * 0.07)), Emu(int(y + h * 0.012)),
                                     Emu(int(h * 0.016)), Emu(int(h * 0.016)))
        dot.fill.solid()
        dot.fill.fore_color.rgb = RGBColor(*_rgb(p["primary"]))
        dot.line.fill.background()
        pptx_text(slide, item, w * 0.11, y, w * 0.80, h * 0.10, size=18, style=style)
        y += h * 0.115
    if note:
        pptx_text(slide, note, w * 0.07, h * 0.88, w * 0.86, h * 0.07,
                  size=11, color=p["muted"], style=style)
    return slide


def pptx_metric(prs, title, metrics, style="consulting"):
    """Слайд с крупными цифрами: metrics = [(значение, подпись), ...]."""
    from pptx.dml.color import RGBColor
    from pptx.util import Emu

    p = get(style)
    slide = pptx_slide(prs, style)
    w, h = prs.slide_width, prs.slide_height
    pptx_text(slide, title, w * 0.07, h * 0.10, w * 0.86, h * 0.14, size=30, bold=True, style=style)
    items = list(metrics)[:4] or [("—", "нет данных")]
    step = w * 0.86 / len(items)
    for i, (value, label) in enumerate(items):
        x = w * 0.07 + step * i
        pptx_text(slide, str(value), x, h * 0.36, step * 0.92, h * 0.18,
                  size=40, bold=True, color=p["primary"], style=style)
        pptx_text(slide, str(label), x, h * 0.55, step * 0.92, h * 0.10,
                  size=13, color=p["muted"], style=style)
    _ = RGBColor
    _ = Emu
    return slide


def pptx_image(prs, image_path, caption="", style="minimal"):
    """Слайд с картинкой во всю ширину и подписью."""
    from pptx.util import Emu

    p = get(style)
    slide = pptx_slide(prs, style)
    w, h = prs.slide_width, prs.slide_height
    slide.shapes.add_picture(str(image_path), Emu(int(w * 0.10)), Emu(int(h * 0.12)),
                             width=Emu(int(w * 0.80)))
    if caption:
        pptx_text(slide, caption, w * 0.10, h * 0.86, w * 0.80, h * 0.08,
                  size=12, color=p["muted"], align="center", style=style)
    return slide


# ---------------------------------------------------------------- matplotlib

def pyplot(style="tufte"):
    """Настроить matplotlib под стиль и вернуть палитру."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    p = get(style)
    plt.rcParams.update({
        "figure.facecolor": p["bg"],
        "axes.facecolor": p["bg"],
        "savefig.facecolor": p["bg"],
        "axes.edgecolor": p["muted"],
        "axes.labelcolor": p["text"],
        "text.color": p["text"],
        "xtick.color": p["muted"],
        "ytick.color": p["muted"],
        "grid.color": p["muted"],
        "grid.alpha": 0.25,
        "font.family": "DejaVu Sans",
        "axes.spines.top": False,
        "axes.spines.right": False,
        "figure.dpi": 150,
    })
    return p


def colors(style="tufte", n=6) -> list[str]:
    """Палитра для серий: основной, второй акцент и производные."""
    p = get(style)
    base = [p["primary"], p["accent"], p["muted"], p["text"], "#8AB4F8", "#F2C14E"]
    out = []
    while len(out) < n:
        out.extend(base)
    return out[:n]


# ---------------------------------------------------------------- Word / Excel

def docx_style(doc, style="editorial"):
    """Оформить документ Word: шрифт, цвет заголовков, поля."""
    from docx.shared import Pt, RGBColor

    p = get(style)
    normal = doc.styles["Normal"]
    normal.font.name = p["font"]
    normal.font.size = Pt(11)
    try:
        normal.font.color.rgb = RGBColor(*_rgb(p["text"]))
    except Exception:
        pass
    for name, size in (("Heading 1", 22), ("Heading 2", 16), ("Heading 3", 13)):
        try:
            st = doc.styles[name]
            st.font.name = p["font"]
            st.font.size = Pt(size)
            st.font.color.rgb = RGBColor(*_rgb(p["primary"]))
        except Exception:
            continue
    for section in doc.sections:
        section.left_margin = section.right_margin = Pt(64)
    return p


def xlsx_style(workbook, style="carbon", sheet=None):
    """Шапка таблицы цветом стиля + автоширина + зебра."""
    from openpyxl.styles import Alignment, Font, PatternFill

    p = get(style)
    ws = sheet or workbook.active
    head = PatternFill("solid", fgColor=hexcolor(p["primary"]))
    zebra = PatternFill("solid", fgColor=hexcolor(p["surface"]))
    for col, _ in enumerate(ws.iter_cols(min_row=1, max_row=1), start=1):
        cell = ws.cell(row=1, column=col)
        cell.fill = head
        cell.font = Font(color="FFFFFF", bold=True, name=p["font"])
        cell.alignment = Alignment(vertical="center")
    for row in range(2, ws.max_row + 1):
        for col in range(1, ws.max_column + 1):
            cell = ws.cell(row=row, column=col)
            if row % 2 == 0:
                cell.fill = zebra
            cell.font = Font(name=p["font"], color=hexcolor(p["text"]))
    for col in range(1, ws.max_column + 1):
        letter = ws.cell(row=1, column=col).column_letter
        width = 12
        for row in range(1, min(ws.max_row, 60) + 1):
            value = ws.cell(row=row, column=col).value
            width = max(width, min(48, len(str(value or "")) + 4))
        ws.column_dimensions[letter].width = width
    ws.freeze_panes = "A2"
    return p


__all__ = [
    "STYLES", "catalog", "get", "palette", "hexcolor",
    "pptx_slide", "pptx_text", "pptx_title", "pptx_bullets", "pptx_metric", "pptx_image",
    "pyplot", "colors", "docx_style", "xlsx_style",
]
