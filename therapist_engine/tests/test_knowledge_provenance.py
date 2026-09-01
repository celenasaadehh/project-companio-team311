import json
from pathlib import Path

KB = Path(__file__).resolve().parents[1] / "knowledge" / "va_knowledge.json"
REQUIRED = {
    "knowledge_id", "organization", "title", "url", "retrieval_date",
    "source_type", "exact_source_text", "structured_interpretation",
    "restrictions", "evidence_level", "review_status"
}


def test_every_knowledge_record_has_provenance_contract():
    records = json.loads(KB.read_text())
    assert records
    ids = set()
    for i, record in enumerate(records):
        missing = REQUIRED - set(record)
        assert not missing, f"record {i} missing {missing}"
        assert record["knowledge_id"] not in ids
        ids.add(record["knowledge_id"])
        assert str(record["organization"]).strip()
        assert str(record["title"]).strip()
        assert str(record["url"]).startswith("https://")
        assert str(record["retrieval_date"]).strip()
        assert str(record["exact_source_text"]).strip()
        assert str(record["structured_interpretation"]).strip()
        assert record["review_status"] == "approved"


def test_knowledge_is_general_not_patient_identified():
    records = json.loads(KB.read_text())
    for record in records:
        assert "patient_id" not in record
        assert "email" not in record
        assert "cognito_user_id" not in record
