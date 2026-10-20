#!/usr/bin/env bash
# Every environment variable the code reads is in .env.example, set by the chart or an image,
# or named (with a reason) in scripts/checks/env_contract.py. No cluster needed.
cd "$(dirname "${BASH_SOURCE[0]}")/../.." && exec python3 scripts/checks/env_contract.py
