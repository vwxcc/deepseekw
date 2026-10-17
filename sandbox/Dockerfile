FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    SANDBOX_WORK=/work \
    SANDBOX_REQUIRE_AUTH=1 \
    SANDBOX_CONCURRENCY=1

WORKDIR /srv

# Match the libraries promised by the document/design skill and install them
# in the isolated runner image, rather than assuming they exist in the web app.
RUN pip install --no-cache-dir \
    matplotlib==3.9.4 \
    numpy==2.1.3 \
    pandas==2.2.3 \
    Pillow==11.0.0 \
    python-docx==1.1.2 \
    openpyxl==3.1.5 \
    python-pptx==1.0.2 \
    pypdf==5.1.0 \
    XlsxWriter==3.2.0 \
    svgwrite==1.4.3 \
    tabulate==0.9.0 \
    'qrcode[pil]==8.0' \
    python-barcode==0.15.1 \
    odfpy==1.4.1 \
    Markdown==3.7 \
    markdown2==2.5.2 \
    docx2txt==0.8 \
    lxml==5.3.0 \
    Jinja2==3.1.4 \
    && mkdir -p /work/projects \
    && chmod 0711 /work /work/projects

COPY sandbox/server.py /srv/server.py
COPY sandbox/designs/ /srv/designs/

EXPOSE 10000
CMD ["python", "/srv/server.py"]
