"""ChatStudio design library: готовые стили оформления для агента.

Использование внутри песочницы::

    import sys; sys.path.insert(0, '/srv')
    from designs import theme as T
    T.catalog()                     # 57 названий стилей
    T.pptx_title(prs, 'Отчёт', '2026', 'apple')
"""
from . import theme  # noqa: F401

__all__ = ["theme"]
