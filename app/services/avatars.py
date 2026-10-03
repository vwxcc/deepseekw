"""Thirty server-generated SVG avatars, assigned to users at registration."""
from __future__ import annotations

PALETTES: list[tuple[str, str]] = [
    ("#e8834f", "#f7c39c"),
    ("#2f6fb0", "#8dc0ec"),
    ("#7c5cbf", "#c3aef0"),
    ("#2f8f6f", "#93dcbc"),
    ("#c0563f", "#f0a893"),
    ("#b8862f", "#eed7a4"),
    ("#4a5568", "#a8b3c4"),
    ("#a03f6f", "#eda1c2"),
    ("#3f7a3f", "#a6dba6"),
    ("#8a4a2f", "#d9ac95"),
]

SHAPES = ("circle", "triangle", "square")
AVATAR_COUNT = len(PALETTES) * len(SHAPES)  # 30


def avatar_svg(index: int, size: int = 96) -> str:
    """Deterministic avatar: palette x shape, plus a per-index rotation."""
    i = int(index or 0) % AVATAR_COUNT
    c1, c2 = PALETTES[i % len(PALETTES)]
    shape = SHAPES[(i // len(PALETTES)) % len(SHAPES)]
    rot = (i * 37) % 360
    uid = f"av{i}"

    if shape == "triangle":
        inner = f'<polygon points="48,22 78,72 18,72" fill="url(#{uid}g)" opacity="0.92"/>'
    elif shape == "square":
        inner = f'<rect x="26" y="26" width="44" height="44" rx="12" fill="url(#{uid}g)" opacity="0.92"/>'
    else:
        inner = f'<circle cx="48" cy="48" r="24" fill="url(#{uid}g)" opacity="0.92"/>'

    dots = "".join(
        f'<circle cx="{24 + (k % 3) * 24}" cy="{24 + (k // 3) * 24}" r="2.2" '
        f'fill="#ffffff" opacity="0.28"/>'
        for k in range(9)
    )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" '
        f'width="{size}" height="{size}" role="img" aria-label="avatar {i}">'
        f"<defs>"
        f'<linearGradient id="{uid}g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0%" stop-color="{c1}"/><stop offset="100%" stop-color="{c2}"/>'
        f"</linearGradient>"
        f'<linearGradient id="{uid}b" x1="0" y1="1" x2="1" y2="0">'
        f'<stop offset="0%" stop-color="{c1}" stop-opacity="0.22"/>'
        f'<stop offset="100%" stop-color="{c2}" stop-opacity="0.35"/>'
        f"</linearGradient>"
        f"</defs>"
        f'<rect width="96" height="96" rx="22" fill="url(#{uid}b)"/>'
        f'<g transform="rotate({rot} 48 48)">{dots}</g>'
        f"{inner}"
        f"</svg>"
    )


def all_avatars() -> list[str]:
    return [avatar_svg(i) for i in range(AVATAR_COUNT)]
