# Build context is data-generators/ — NOT this directory — so the image can pull
# in shared/traffic_profile.py alongside the simulator code.
#
# Chromium only. The official Playwright image carries Chromium, Firefox and WebKit
# (2.9 GB, copied onto every node of the cluster); the simulator launches Chromium
# and nothing else, so this installs just that browser and its system libraries
# (about 1.1 GB). Debian 12 is the base because Playwright 1.44 supports it; newer
# Debian releases need a newer Playwright. The version is pinned to match
# playwright==1.44.0 in requirements.txt: each Playwright release wants its own
# Chromium build.
FROM python:3.12-slim-bookworm

WORKDIR /sim

# Stream stdout/stderr live to `docker logs` / `kubectl logs` instead of
# block-buffering it (Python buffers when stdout is a pipe rather than a TTY).
ENV PYTHONUNBUFFERED=1

# Python dependencies (the playwright binding and the OTel exporter), then the
# Chromium build that binding drives, with the system libraries it needs.
COPY simulator/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

# The shared traffic profile — the same file the producer image copies, which is
# what keeps the two generators emitting the same funnel.
COPY shared/traffic_profile.py ./

COPY simulator/ ./

RUN chmod +x /sim/entrypoint.sh

ENTRYPOINT ["/sim/entrypoint.sh"]
