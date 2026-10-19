"""
Simulation configuration.

Funnel rates, UTM sources, dwell timings, page titles, search queries and user
agents live in `data-generators/shared/traffic_profile.py`, which the producers
read too. Keeping one definition is what guarantees the simulator and the
producers emit the *same* funnel; when the rates lived in two files they silently
drifted apart. This module re-exports it (`import config`) and adds the one thing
that is the simulator's own: how many of its shoppers buy.
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

__all__ = list(_profile.__all__) + ["apply_workshop_funnel", "WORKSHOP_FUNNEL"]

# The realistic rates in traffic_profile.FUNNEL put about 2.5% of sessions through to
# a purchase, which is right for the generated clickstream. But the simulator is the
# only source of real orders, and at a laptop's six arrivals a minute that would be
# an order every seven minutes or so: nothing to watch in the CDC pipe, the
# inventory or the analytics. So by default its shoppers browse a little deeper and
# buy more often (roughly one session in six ends in an order, about ten orders
# in ten minutes at six sessions a minute: enough to see every payment method).
# SIM_REALISTIC_FUNNEL=true restores the shared rates.
WORKSHOP_FUNNEL = {
    "bounce_rate": 0.20,
    "search_rate": 0.40,
    "pdp_to_cart": 0.20,
    "cart_to_checkout": 0.95,
    "checkout_to_purchase": 0.95,
}


def apply_workshop_funnel() -> bool:
    """
    Switch this process to the workshop funnel unless SIM_REALISTIC_FUNNEL is set.
    Returns True when the workshop funnel is in effect.

    Must run before any session is planned. It changes FUNNEL in place, and only
    in the simulator's process: the producers keep the realistic rates.
    """
    if env_bool("SIM_REALISTIC_FUNNEL", False):    # noqa: F405 (re-exported)
        return False
    _profile.FUNNEL.update(WORKSHOP_FUNNEL)
    return True
