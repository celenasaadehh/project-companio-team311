# =============================================================================
# safety.py  -  THE GUARD (checks the words are safe before they're spoken)
# =============================================================================
# THE STORY (read this first):
#   This is the last checkpoint before ANY message reaches the patient. Think of
#   a bouncer at a door who reads the message and refuses it if it contains
#   anything dangerous. It blocks THREE forbidden kinds of content:
#
#     1. FALSE SAFETY PROMISE  - e.g. "you are completely safe".
#          Forbidden: a camera/sensor cannot KNOW someone is safe. Promising
#          safety we can't verify is dangerous.
#     2. DIAGNOSIS             - e.g. "you are having a panic attack".
#          Forbidden: the app notices body elevation; it does NOT diagnose.
#     3. MEDICATION ADVICE     - e.g. "take your medication".
#          Forbidden: that is a clinician's job, never an app's.
#
#   IMPORTANT: this guard is SIMPLE word-matching, NOT an AI. On purpose - your
#   very last safety check must be predictable, not another guessing machine.
#   Even the AI reasoner's own messages must pass through HERE before use.
# =============================================================================


import re
import unicodedata

# --- The banned phrases, grouped into the 3 categories -----------------------
# Each of these is a "list" (an ordered basket) of text phrases. If a message
# contains any phrase from a basket, that category is flagged. We compare in
# lowercase, so "You Are Safe" and "you are safe" count the same.
_SAFETY_GUARANTEE_PHRASES = [
    "you are completely safe",
    "you are totally safe",
    "you are safe",
    "you're safe",
    "you are 100% safe",
    "nothing can hurt you",
    "no danger",
    "there is no threat",
]

_DIAGNOSIS_PHRASES = [
    "panic attack",
    "you have ptsd",
    "you are having a",
    "you're having a",
    "diagnos",          # this stub also catches "diagnose" and "diagnosis"
    "flashback",        # naming a clinical symptom as if it were a fact
]

_MEDICATION_PHRASES = [
    "medication",
    "take your meds",
    "increase your dose",
    "your dose",
    "your pill",
    "milligram",
    " mg",              # the leading space avoids matching words that end in "mg"
]


# The safe, honest sentence we say INSTEAD when a message is unsafe. It never
# promises safety, never diagnoses, never mentions medication. (It is spelled in
# CAPITALS because it's a constant - a fixed value other files can import.)
SAFE_FALLBACK_MESSAGE = "I'm here with you. Let's take this one breath at a time."


# =============================================================================
# find_violations  -  list every problem found in a message
# =============================================================================
# IN PLAIN ENGLISH:
#   GOES IN : message = the text we want to check (a string)
#   COMES OUT: a list of problem names. An EMPTY list [] means "no problems".
# Example: "you are completely safe, take your medication"
#          -> ["false safety guarantee", "medication advice"]
# =============================================================================
def _normalize(message: str) -> str:
    # Unicode + punctuation/spacing normalization makes simple obfuscations such as
    # "YOU...ARE SAFE" or repeated whitespace less likely to bypass the guard.
    text = unicodedata.normalize("NFKC", str(message)).lower()
    text = re.sub(r"[^a-z0-9%]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def find_violations(message: str) -> list[str]:
    text = _normalize(message)

    # "problems: list[str] = []" starts an empty basket we'll add problem names to.
    problems: list[str] = []

    # "any(phrase in text for phrase in LIST)" reads as:
    #   "is ANY phrase from LIST found inside the text?" -> True or False.
    #   ("phrase in text" checks if that phrase appears anywhere in the message.)
    # If yes, ".append(...)" adds the problem's name to the basket.
    normalized_guarantees = [_normalize(p) for p in _SAFETY_GUARANTEE_PHRASES]
    normalized_diagnosis = [_normalize(p) for p in _DIAGNOSIS_PHRASES]
    normalized_medication = [_normalize(p) for p in _MEDICATION_PHRASES]

    if any(phrase in text for phrase in normalized_guarantees):
        problems.append("false safety guarantee")

    if any(phrase in text for phrase in normalized_diagnosis):
        problems.append("diagnosis language")

    if any(phrase in text for phrase in normalized_medication):
        problems.append("medication advice")

    return problems


# =============================================================================
# is_safe  -  a simple yes/no
# =============================================================================
#   GOES IN : message (a string).   COMES OUT: True if safe, False if not.
def is_safe(message: str) -> bool:
    # find_violations returns a list. "not <list>" is True when the list is EMPTY
    # (no problems) -> so this returns True only when the message is clean.
    return not find_violations(message)


# =============================================================================
# make_safe  -  THE MAIN ENTRY POINT other files call
# =============================================================================
# IN PLAIN ENGLISH:
#   GOES IN : message = a proposed message.
#   COMES OUT: TWO things at once (a "tuple"): (safe_text, problems)
#       - if the message was already safe -> (the original message, [])
#       - if it was unsafe                -> (the neutral fallback, [the problems])
#
# THE KEY DESIGN CHOICE ("fail closed"): if a message is unsafe we do NOT try to
# edit it into something safe (that could twist a clinician's meaning). We THROW
# IT AWAY and speak the neutral fallback instead. The cautious path always wins.
# =============================================================================
def make_safe(message: str) -> tuple[str, list[str]]:
    problems = find_violations(message)
    # "if problems:" is true when the basket is NOT empty (something was found).
    if problems:
        return SAFE_FALLBACK_MESSAGE, problems   # unsafe -> swap in the safe line
    return message, []                           # safe -> keep the original, no problems
