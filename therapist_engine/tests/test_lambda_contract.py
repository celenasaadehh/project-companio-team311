"""Contract tests for the AWS Lambda backend.

The Lambda is the only path a patient's data takes to storage, and it is
also the fallback decision layer when the inference service is unreachable.
These tests cover the guarantees that matter clinically: who may read what,
that a real name never reaches a clinical table, and that a therapist rule
is selected by exactly the documented conditions.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "aws"))
import lambda_function as L  # noqa: E402


def event(groups=None, sub="sub-1", username="user-1"):
    """A minimal API Gateway event carrying Cognito JWT claims."""
    claims = {"sub": sub, "cognito:username": username}
    if groups is not None:
        claims["cognito:groups"] = groups
    return {"requestContext": {"authorizer": {"jwt": {"claims": claims}}}}


# --------------------------------------------------------------------------
# Identity separation: a real name must never reach a clinical table
# --------------------------------------------------------------------------

def test_name_is_stripped_from_a_clinical_profile():
    item = L.build_item("clinical-profile", {"patient_id": "p1", "name": "Real Name",
                                             "known_triggers": ["trash bag"]})
    assert "name" not in item
    assert item["known_triggers"] == ["trash bag"]


def test_every_identity_field_is_stripped_from_clinical_tables():
    body = {"patient_id": "p1", "name": "A", "username": "b", "display_name": "c",
            "full_name": "d", "real_name": "e", "first_name": "f", "last_name": "g"}
    for resource in ("clinical-profile", "session", "decision", "note"):
        item = L.build_item(resource, dict(body))
        leaked = L.IDENTITY_ONLY_FIELDS & set(item)
        assert not leaked, f"{resource} leaked {leaked}"


def test_the_identity_table_keeps_the_name():
    item = L.build_item("identity", {"patient_id": "p1", "display_name": "Real Name"})
    assert item["display_name"] == "Real Name"


def test_identity_records_require_a_patient_id():
    with pytest.raises(ValueError):
        L.build_item("identity", {"display_name": "no id"})


def test_clinical_profiles_require_a_patient_id():
    with pytest.raises(ValueError):
        L.build_item("clinical-profile", {"known_triggers": []})


def test_records_are_given_an_id_and_timestamps():
    item = L.build_item("session", {"patient_id": "p1", "type": "trigger_event"})
    assert item["session_id"].startswith("S-")
    assert item["created_at"] and item["updated_at"]


def test_a_caller_supplied_id_and_creation_time_are_preserved():
    item = L.build_item("session", {"session_id": "S-fixed", "patient_id": "p1",
                                    "created_at": "2026-09-01T20:04:30Z"})
    assert item["session_id"] == "S-fixed"
    assert item["created_at"] == "2026-09-01T20:04:30Z"


def test_generated_ids_are_prefixed_per_resource():
    assert L.make_id("decision").startswith("D-")
    assert L.make_id("note").startswith("N-")
    assert L.make_id("therapist-rule").startswith("TR-")


# --------------------------------------------------------------------------
# Roles and route parsing
# --------------------------------------------------------------------------

def test_roles_are_read_from_a_group_list():
    assert L.is_therapist(event(["THERAPIST"])) is True
    assert L.is_patient(event(["THERAPIST"])) is False
    assert L.is_patient(event(["PATIENT"])) is True


def test_roles_survive_the_json_string_encoding_of_groups():
    assert L.is_therapist(event('["THERAPIST"]')) is True


def test_roles_survive_the_bracketed_string_encoding_of_groups():
    assert L.is_patient(event("[PATIENT]")) is True


def test_a_caller_with_no_groups_holds_no_role():
    e = event()
    assert L.is_patient(e) is False
    assert L.is_therapist(e) is False
    assert L.is_admin(e) is False


def test_an_unauthenticated_caller_is_recognised_as_such():
    assert L.is_authenticated({"requestContext": {}}) is False
    assert L.is_authenticated(event(["PATIENT"])) is True


def test_plural_and_singular_routes_reach_the_same_resource():
    assert L.normalize_resource("/clinical-profiles/p1")[0] == "clinical-profile"
    assert L.normalize_resource("/clinical-profile/p1")[0] == "clinical-profile"
    assert L.normalize_resource("/sessions")[0] == "session"
    assert L.normalize_resource("/therapist-rules/r1")[0] == "therapist-rule"


def test_an_unknown_route_resolves_to_no_resource():
    assert L.normalize_resource("/not-a-resource")[0] is None


def test_the_path_remainder_is_returned_for_lookups():
    resource, rest = L.normalize_resource("/session/S-123")
    assert resource == "session"
    assert rest == ["S-123"]


# --------------------------------------------------------------------------
# Trigger vocabulary
# --------------------------------------------------------------------------

def test_a_specific_label_identifies_its_trigger():
    assert "trash bag" in L.detect_trigger_candidates([{"name": "garbage"}])


def test_generic_scene_labels_identify_nothing():
    assert L.detect_trigger_candidates([{"name": "person"}]) == []


def test_the_vocabulary_is_versioned_for_cross_component_agreement():
    assert L.TRIGGER_VOCABULARY_VERSION >= 2
    assert 0 < L.WEAK_MATCH_FACTOR < 1


def test_acoustic_concepts_are_present_in_the_vocabulary():
    assert "loud noise" in L.TRIGGER_ALIASES


# --------------------------------------------------------------------------
# Therapist rule selection (the layer that outranks every model)
# --------------------------------------------------------------------------

@pytest.fixture
def rules(monkeypatch):
    """Control the rules and profile the matcher reads."""
    store = {"rules": [], "profile": {}}
    monkeypatch.setattr(L, "get_patient_rules", lambda pid: store["rules"])
    monkeypatch.setattr(L, "get_clinical_profile_item", lambda pid: store["profile"])
    return store


def rule(**kw):
    base = {"rule_id": "TR-1", "trigger": "trash bag", "approved_action": "grounding",
            "priority": 1, "active": True}
    base.update(kw)
    return base


def test_a_matching_rule_is_selected(rules):
    rules["rules"] = [rule()]
    got = L.find_best_matching_rule("p1", ["trash bag"], "elevated")
    assert got and got["rule_id"] == "TR-1"


def test_a_rule_for_another_trigger_is_not_selected(rules):
    rules["rules"] = [rule(trigger="fireworks")]
    assert L.find_best_matching_rule("p1", ["trash bag"], "elevated") is None


def test_an_inactive_rule_is_never_selected(rules):
    rules["rules"] = [rule(active=False)]
    assert L.find_best_matching_rule("p1", ["trash bag"], "elevated") is None


def test_a_rule_below_its_own_minimum_risk_does_not_fire(rules):
    rules["rules"] = [rule(min_risk_level="high")]
    assert L.find_best_matching_rule("p1", ["trash bag"], "elevated") is None


def test_a_rule_at_its_minimum_risk_fires(rules):
    rules["rules"] = [rule(min_risk_level="elevated")]
    assert L.find_best_matching_rule("p1", ["trash bag"], "high") is not None


def test_a_forbidden_action_is_refused_even_from_a_therapist_rule(rules):
    rules["rules"] = [rule(approved_action="body scan")]
    profile = {"forbidden_interventions": ["body scan"]}
    assert L.find_best_matching_rule("p1", ["trash bag"], "elevated", profile) is None


def test_an_action_outside_the_care_plan_is_refused(rules):
    rules["rules"] = [rule(approved_action="something new")]
    profile = {"approved_interventions": ["grounding"]}
    assert L.find_best_matching_rule("p1", ["trash bag"], "elevated", profile) is None


def test_the_highest_priority_valid_rule_wins(rules):
    rules["rules"] = [rule(rule_id="TR-low", priority=1),
                      rule(rule_id="TR-high", priority=9)]
    assert L.find_best_matching_rule("p1", ["trash bag"], "elevated")["rule_id"] == "TR-high"


def test_a_stale_high_priority_rule_cannot_block_a_valid_one(rules):
    rules["rules"] = [rule(rule_id="TR-stale", priority=9, approved_action="removed"),
                      rule(rule_id="TR-valid", priority=1, approved_action="grounding")]
    profile = {"approved_interventions": ["grounding"]}
    got = L.find_best_matching_rule("p1", ["trash bag"], "elevated", profile)
    assert got["rule_id"] == "TR-valid"


def test_priority_ties_are_broken_deterministically(rules):
    rules["rules"] = [rule(rule_id="TR-b", priority=5), rule(rule_id="TR-a", priority=5)]
    first = L.find_best_matching_rule("p1", ["trash bag"], "elevated")["rule_id"]
    rules["rules"].reverse()
    second = L.find_best_matching_rule("p1", ["trash bag"], "elevated")["rule_id"]
    assert first == second == "TR-a"


def test_no_observed_trigger_matches_no_rule(rules):
    rules["rules"] = [rule()]
    assert L.find_best_matching_rule("p1", [], "elevated") is None
