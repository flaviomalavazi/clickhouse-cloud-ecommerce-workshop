"""
Simulation configuration.

Everything that used to live here — funnel rates, UTM sources, dwell timings,
page titles, search queries, user agents — now lives in
`data-generators/shared/traffic_profile.py`, which the producers read too.
Keeping one definition is what guarantees the simulator and the producers emit
the *same* funnel; when the rates lived in two files they silently drifted apart.

This module stays as the import surface (`import config`) so the session classes
and the CLI keep working unchanged. Prefer editing `shared/traffic_profile.py`.
"""

import os
import sys

# In the container, traffic_profile.py is copied next to this file, so the import
# below resolves directly. For a local checkout it lives in ../shared, which has
# to go on sys.path first.
_SHARED = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "shared"
)
if os.path.isdir(_SHARED) and _SHARED not in sys.path:
    sys.path.append(_SHARED)

from traffic_profile import *        # noqa: E402,F401,F403  (re-export, see __all__)
import traffic_profile as _profile   # noqa: E402

__all__ = list(_profile.__all__)
