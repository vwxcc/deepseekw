FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    SANDBOX_WORK=/work \
    SANDBOX_REQUIRE_AUTH=1

WORKDIR /srv

# The runner uses only the Python standard library; matplotlib is installed
# for common graph/image-generation tasks inside the isolated worker process.
RUN pip install --no-cache-dir matplotlib==3.9.4 \
    && mkdir -p /work/projects /tmp/mpl \
    && chmod 0777 /work /work/projects /tmp/mpl

COPY sandbox/server.py /srv/server.py

EXPOSE 10000
CMD ["python", "/srv/server.py"]
