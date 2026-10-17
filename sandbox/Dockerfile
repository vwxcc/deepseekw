FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    SANDBOX_WORK=/work \
    SANDBOX_REQUIRE_AUTH=1 \
    SANDBOX_CONCURRENCY=1

WORKDIR /srv

# File creation runs inside this isolated worker, so every renderer and its
# local design catalogue must be present here (the web-app requirements do not
# install packages into this separate container).
RUN pip install --no-cache-dir \
    matplotlib==3.9.4 \
    python-docx==1.1.2 \
    openpyxl==3.1.5 \
    python-pptx==1.0.2 \
    Pillow==11.0.0 \
    pypdf==5.1.0 \
    && mkdir -p /work/projects \
    && chmod 0711 /work /work/projects

COPY sandbox/server.py /srv/server.py
COPY sandbox/designs /srv/designs
COPY sandbox/fonts /srv/fonts

EXPOSE 10000
CMD ["python", "/srv/server.py"]
