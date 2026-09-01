"""Conditional forbidden interventions.

A blanket ban is a blunt instrument. Clinically, most contraindications are
situational rather than absolute: a countdown exercise may help this patient
normally but be a poor choice when they are already dissociating; paced
breathing may be fine except after exertion; an imagery technique may be unsafe
only when the trigger is the one it evokes.

Forcing a therapist to choose between "always allowed" and "never allowed"
pushes them toward banning outright, which removes a technique that would have
helped in most situations.

A condition is evaluated against the moment. If it does not hold, the
intervention stays available. If it does, the intervention is treated exactly
like a forbidden one for that moment only, and the reason is recorded so the
therapist can see which ban fired and why.

Supported conditions map to context the engine actually has. Anything it cannot
evaluate is treated as NOT met, so an unrecognised condition can never silently
remove a clinician's approved intervention.
"""
from __future__ import annotations

from typing import Optional

RISK_ORDER = {"baseline": 0, "elevated": 1, "high": 2, "critical": 3}

CONDITION_TYPES = (
    "risk_at_least",      # value: baseline|elevated|high|critical
    "trigger_present",    # value: a trigger name
    "context_declared",   # value: a declared-context id, e.g. "exercise"
    "after_failed",       # value: another intervention that already failed
    "always",             # an unconditional ban expressed in the same shape
)


def _risk_at_least(current: Optional[str], minimum: Optional[str]) -> bool:
    if not minimum:
        return True
    return (RISK_ORDER.get(str(current or "baseline").strip().lower(), 0)
            >= RISK_ORDER.get(str(minimum).strip().lower(), 0))


def condition_holds(cond: dict, moment: dict) -> bool:
    """Does this condition apply to the moment in front of us?

    Unknown condition types return False: a ban we cannot evaluate must not
    remove an intervention the clinician approved.
    """
    ctype = str(cond.get("condition_type") or "").strip().lower()
    value = cond.get("value")

    if ctype == "always":
        return True

    if ctype == "risk_at_least":
        return _risk_at_least(moment.get("risk_level"), value)

    if ctype == "trigger_present":
        observed = {str(t).strip().lower() for t in (moment.get("observed_triggers") or [])}
        return str(value or "").strip().lower() in observed

    if ctype == "context_declared":
        declared = {str(c).strip().lower() for c in (moment.get("declared_context") or [])}
        return str(value or "").strip().lower() in declared

    if ctype == "after_failed":
        tried = {str(a).strip().lower() for a in (moment.get("already_tried") or [])}
        return str(value or "").strip().lower() in tried

    return False


def apply_conditional_bans(approved: list, conditional: list, moment: dict):
    """Remove interventions whose ban condition holds for this moment.

    Returns (allowed, blocked) where blocked is a list of
    {action, reason} so the decision record can say which ban fired.
    """
    if not conditional:
        return list(approved or []), []

    blocked = []
    banned_now = set()

    for ban in conditional:
        action = str(ban.get("action") or "").strip()
        if not action:
            continue
        if condition_holds(ban, moment):
            banned_now.add(action.lower())
            blocked.append({
                "action": action,
                "reason": ban.get("reason")
                          or f"{ban.get('condition_type')}={ban.get('value')}",
            })

    allowed = [a for a in (approved or []) if str(a).strip().lower() not in banned_now]
    return allowed, blocked
