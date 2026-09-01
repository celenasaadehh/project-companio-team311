# =============================================================================
# sensor_event.py
# -----------------------------------------------------------------------------
# This file defines ONE form (model): SensorEvent.
#
# A SensorEvent is ONE raw reading from ONE sensor at ONE moment. It is
# deliberately "dumb": it only REPORTS what was measured. It does NOT decide
# what the measurement MEANS. (A heart rate of 120 could be exercise, caffeine,
# stairs, or fear — a single number has no meaning on its own.) Interpreting the
# reading is the RISK ENGINE's job, which produces a separate RiskState later.
# =============================================================================


# -----------------------------------------------------------------------------
# IMPORTS
# -----------------------------------------------------------------------------

from datetime import datetime, timezone

# uuid4 comes from Python's built-in "uuid" toolbox. It generates a random,
# practically-unique value every time it is called. We use it to AUTO-GENERATE
# the record id below, so we never have to type one by hand.
from uuid import uuid4

# "Optional" = a box that may be empty.
# "Union" = a box that may hold ONE type OR ANOTHER. Union[float, str] means
#   "a decimal number OR a piece of text". This is the tool that solves our
#   number-vs-word puzzle for the "value" box below.
#
# NOTE on why we import Union: for list/dict we could use lowercase with no
# import. The modern lowercase way to write "A or B" is "float | str", but that
# syntax needs Python 3.10+, and this machine runs Python 3.9 — so here the
# import genuinely IS needed. (On 3.10+, "float | str" would work import-free.)
from typing import Optional, Union

from pydantic import BaseModel, Field

# We reuse the SensorType menu we built in enums.py so the sensor_type box can
# only ever be one of the allowed kinds (heart_rate, visual_scene, etc.).
from .enums import SensorType


# -----------------------------------------------------------------------------
# THE FORM: SensorEvent
# -----------------------------------------------------------------------------
class SensorEvent(BaseModel):

    # YOUR RULE: a unique id for this one reading.
    # ---------------------------------------------------------------------
    # This is a "RECORD id" — pure bookkeeping for one high-volume row, and
    # nobody hand-picks its value (a wristband can produce a reading every
    # second). So we AUTO-GENERATE it: default_factory calls the little function
    # each time a SensorEvent is made. uuid4() creates a random unique value;
    # ".hex[:8]" keeps the first 8 characters so the id stays short, e.g.
    # "E-3f9a2b1c". Compare this with "patient_id", a REFERENCE id we always
    # assign deliberately because many tables must share the exact same value.
    event_id: str = Field(default_factory=lambda: f"E-{uuid4().hex[:8]}")

    # YOUR RULE: whose sensor this is — only the codename, never a name.
    patient_id: str

    # YOUR RULE: WHEN it was measured. Sensor data is meaningless without a time,
    # so we auto-fill "now" if it isn't given.
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    # YOUR RULE: WHAT KIND of reading this is. Must be a value from the
    # SensorType menu. This makes typos impossible and tells us how to read
    # the "value" box below.
    sensor_type: SensorType

    # ---------------------------------------------------------------------
    # THE NUMBER-VS-WORD PUZZLE, SOLVED
    # ---------------------------------------------------------------------
    # YOUR RULE: the measured value can be a NUMBER or a WORD.
    #   - heart_rate  -> a number, e.g. 120.0
    #   - visual_scene-> a label,  e.g. "trash_bag"
    # "Union[float, str]" tells the engine: "accept EITHER a decimal number OR
    # text here." That is how one field cleanly handles both kinds of sensor.
    value: Union[float, str]

    # YOUR RULE: the unit for a numeric value, so "120" is not ambiguous.
    # Optional because a word value (like "trash_bag") has no unit.
    # Example: "bpm".
    unit: Optional[str] = None

    # YOUR RULE: which device produced the reading (some devices are more
    # trustworthy than others). Optional text. Example: "wrist-band-v2".
    source: Optional[str] = None

    # YOUR RULE: how confident we are in this reading, from 0.0 to 1.0.
    # "Field(ge=0.0, le=1.0)" enforces the range (ge = ">= 0", le = "<= 1").
    # Optional: not every device reports a quality score. A bad sensor contact
    # would produce a low quality, telling the risk engine to trust it less.
    quality: Optional[float] = Field(default=None, ge=0.0, le=1.0)
