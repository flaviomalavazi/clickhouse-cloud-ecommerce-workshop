"""Put the generator modules on the path, the way the images lay them out flat."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
for sub in ("shared", "simulator", "producers"):
    p = str(ROOT / sub)
    if p not in sys.path:
        sys.path.insert(0, p)
