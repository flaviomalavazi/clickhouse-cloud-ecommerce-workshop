# One image for both producers (web_events.py and credit_card.py): the Deployment
# picks the command. Build context is data-generators/ — NOT this directory — so
# the image can pull in the shared modules alongside the producer code.
FROM python:3.14-slim

WORKDIR /app

# All dependencies ship prebuilt wheels for this Python, so no compiler or -dev
# packages are needed.
COPY producers/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The shared modules: the traffic profile (funnel rates, hour-of-day curve, run
# modes, the storefront transaction builder), the row renderer, the ClickHouse
# connection settings and the batched insert path. The simulator image copies the
# same traffic profile, which is what keeps the two generators on the same funnel.
COPY shared/ ./

COPY producers/web_events.py producers/credit_card.py ./

# Default to the web-events producer; the credit-card Deployment overrides the command.
CMD ["python", "-u", "web_events.py"]
