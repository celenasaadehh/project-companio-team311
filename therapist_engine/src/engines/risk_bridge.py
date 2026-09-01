# =============================================================================
# risk_bridge.py  -  THE INTERPRETER between two engines
# =============================================================================
# THE STORY (read this first):
#   Your friend built a separate program (in the ../../risk_engine/ folder) that
#   reads body sensors and answers "how stressed is the body right now?".
#   BUT your friend's program answers in ITS OWN format, and your program only
#   understands YOUR format. They can't talk directly.
#
#   This file is the INTERPRETER. Like a human translator between someone who
#   speaks French and someone who speaks English, it takes your friend's answer
#   and re-says it in a form your engine understands. That's its ONLY job.
#
# WHAT YOUR FRIEND'S ANSWER LOOKS LIKE (this is the "French"):
#   {
#     "physiological_distress_score": 0.82,   # a number from 0 to 1
#     "model_pattern": "stress-like",         # or "baseline-like"
#     "support_level": "high",                # one of: low / elevated / high
#     "action": "prominent_grounding_offer",
#   }
#   (The { ... } thing is called a "dictionary" - a labelled bag of values.
#    You read a value by its label, e.g. answer["support_level"] gives "high".)
#
# WHAT YOUR ENGINE WANTS INSTEAD (the "English") = a "RiskState".
#   A RiskState is a small record YOU designed in Phase 1. It holds:
#     - patient_id  : the codename, like "P-001" (never a real name)
#     - risk_score  : a number 0 to 1  (0 = calm, 1 = very elevated)
#     - risk_level  : a WORD: baseline / elevated / high / critical
#     - confidence  : a number 0 to 1 (how sure we are)
#     - contributing_signals : short text reasons, for the record
# =============================================================================


# --- Borrow two things YOU built in Phase 1 ----------------------------------
# "from src.models.risk_state import RiskState" means:
#   go into your OWN project (src) -> models folder -> the file risk_state.py,
#   and grab the RiskState record described above.
from src.models.risk_state import RiskState

# Same idea: grab the RiskLevel "menu" from your enums.py file. RiskLevel is the
# fixed list of allowed level words: BASELINE, ELEVATED, HIGH, CRITICAL. Using a
# menu means a typo like "hgih" is impossible.
from src.models.enums import RiskLevel


# --- A translation table: their word  ->  your menu word ---------------------
# This "{ ... }" is a dictionary again (a labelled bag). Here it works like a
# little translation dictionary: you look up their word on the LEFT and get your
# menu value on the RIGHT.
#   their "low"      -> your RiskLevel.BASELINE
#   their "elevated" -> your RiskLevel.ELEVATED
#   their "high"     -> your RiskLevel.HIGH
# (Their engine never says "critical", so we simply don't list it here.)
_SUPPORT_TO_RISK = {
    "low": RiskLevel.BASELINE,
    "elevated": RiskLevel.ELEVATED,
    "high": RiskLevel.HIGH,
}


# =============================================================================
# THE MAIN TRANSLATOR FUNCTION
# =============================================================================
# "def name(inputs) -> RiskState:" means: define a reusable action called "name",
# it takes some inputs, and it HANDS BACK ("-> ") a RiskState.
#
# IN PLAIN ENGLISH:
#   GOES IN : response   = your friend's answer (the dictionary shown at the top)
#             patient_id = the codename, e.g. "P-001"
#   COMES OUT: a RiskState (your engine's record)
#
# We'll follow one example the whole way: their score is 0.82, level "high".
# =============================================================================
def distress_response_to_risk_state(response: dict, patient_id: str) -> RiskState:

    # STEP 1 - copy the score across (both sides use 0 to 1, so no change needed).
    # response["physiological_distress_score"] reads that value out of the bag.
    # float(...) just makes sure it is a decimal number (e.g. 0.82), not text.
    score = float(response["physiological_distress_score"])

    # STEP 2 - translate their level WORD into your menu word.
    # response.get("support_level", "") reads their level; the ", ''" part means
    # "if that label is missing, use an empty text instead of crashing".
    # .lower() makes it lowercase so "High" and "high" are treated the same.
    support = str(response.get("support_level", "")).lower()

    # Look their word up in our translation table above.
    # .get(support) returns the matching RiskLevel, OR "None" (Python's word for
    # "nothing found") if their word isn't in our table.
    level = _SUPPORT_TO_RISK.get(support)

    # If we didn't find a match (level is None), work the level out from the
    # score ourselves, using the SAME cut-offs their engine documented.
    if level is None:
        if score >= 0.70:            # 0.70 or higher  -> high
            level = RiskLevel.HIGH
        elif score >= 0.40:          # 0.40 up to 0.69 -> elevated
            level = RiskLevel.ELEVATED
        else:                        # below 0.40      -> baseline
            level = RiskLevel.BASELINE
    # For our example (score 0.82, support "high") -> level = HIGH.

    # STEP 3 - make up a "confidence" number, because their engine doesn't send one.
    # Idea: a score near 0 or near 1 is a CONFIDENT call; a score near 0.5 is a
    # coin-flip (unsure).
    #   abs(score - 0.5)  = distance from the middle 0.5 (abs = always positive).
    #   times 2           = stretch it so the ends reach 1.0.
    #   min(1.0, ...)     = a safety cap so it can never go above 1.0.
    # Example: abs(0.82 - 0.5) = 0.32; 0.32 * 2 = 0.64  -> confidence 0.64.
    confidence = min(1.0, abs(score - 0.5) * 2)

    # STEP 4 - keep a few short reasons, so the record can explain itself later.
    # "list[str]" means a list (an ordered basket) of text items. We start empty.
    signals: list[str] = []
    # .append(x) adds x to the basket. The f"...{value}..." is an "f-string":
    # it builds a piece of text with a value dropped inside the { }.
    if response.get("model_pattern"):
        signals.append(f"pattern: {response['model_pattern']}")
    if support:
        signals.append(f"support_level: {support}")
    if response.get("action"):
        signals.append(f"suggested: {response['action']}")
    # For our example, signals = ["pattern: stress-like", "support_level: high",
    #                             "suggested: prominent_grounding_offer"].

    # STEP 5 - build and HAND BACK the RiskState (the English record).
    # (Because RiskState was built with Pydantic in Phase 1, it double-checks the
    #  values here too - e.g. a silly score like 1.5 would be rejected.)
    return RiskState(
        patient_id=patient_id,
        risk_score=score,            # 0.82
        risk_level=level,            # HIGH
        contributing_signals=signals,
        confidence=confidence,       # 0.64
    )


# =============================================================================
# OPTIONAL: talk to your friend's LIVE server over the internet
# =============================================================================
# The function above works OFFLINE - you hand it the answer yourself. This one
# actually CALLS your friend's running program to get the answer, then translates
# it using the function above.
#
# IN PLAIN ENGLISH:
#   GOES IN : patient_id    = "P-001"
#             sensor_window = the 30 seconds of sensor numbers to send
#             base_url      = the web address of your friend's server
#   COMES OUT: a RiskState
# =============================================================================
def fetch_risk_state(
    patient_id: str,
    sensor_window: dict,
    base_url: str = "http://127.0.0.1:8000",
) -> RiskState:
    # "requests" is a tool for making internet calls. We import it HERE (inside
    # the function) instead of at the top, so the rest of the file still works
    # even on a computer that doesn't have "requests" installed.
    import requests

    # Send the sensor numbers to your friend's "/predict-distress" address.
    # "POST" means "I am SENDING you data to process". timeout=10 = give up after
    # 10 seconds if the server never answers.
    resp = requests.post(f"{base_url}/predict-distress", json=sensor_window, timeout=10)

    # If the server replied with an error (like 400 = bad request), turn that into
    # a normal Python error so we notice it instead of silently continuing.
    resp.raise_for_status()

    # resp.json() turns the server's reply back into a dictionary, then we hand it
    # to the translator function above to get a RiskState.
    return distress_response_to_risk_state(resp.json(), patient_id)
