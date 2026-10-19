# Build context is data-generators/ — NOT this directory — so the image can pull
# in shared/traffic_profile.py alongside the simulator code.
#
# Uses the official Playwright Python image – Chromium + all system deps included.
# Version is pinned to match playwright==1.44.0 in requirements.txt.
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

WORKDIR /sim

# Stream stdout/stderr live to `docker logs` / `kubectl logs` instead of
# block-buffering it (Python buffers when stdout is a pipe rather than a TTY).
ENV PYTHONUNBUFFERED=1

# Install Python dependencies (the playwright binding and the OTel exporter).
# The Chromium binary is already present in the base image.
COPY simulator/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The shared traffic profile — the same file the producer image copies, which is
# what keeps the two generators emitting the same funnel.
COPY shared/traffic_profile.py ./

COPY simulator/ ./

RUN chmod +x /sim/entrypoint.sh

ENTRYPOINT ["/sim/entrypoint.sh"]
