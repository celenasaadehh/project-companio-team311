# =============================================================================
# build_knowledge_base.py  -  USE THE VA DATA (the start of your RAG)
# =============================================================================
# THE STORY (read this first):
#   This does NOT train a model. It builds the AI's LIBRARY - the official facts
#   it is allowed to look up and quote (this is "RAG": Retrieval-Augmented
#   Generation = look it up, then answer).
#
#   WHERE the facts come from: the real U.S. Dept. of Veterans Affairs "PTSD
#   Repository" - a database of 601 PTSD treatment clinical trials. We pull real
#   rows from it over the internet.
#
#   WHAT we do with each row:
#     1. wrap it in a KnowledgeRecord (the Phase-1 form YOU designed) - so every
#        fact keeps its SOURCE (organization, citation, evidence rating).
#     2. build a simple SEARCH INDEX over all the records (TF-IDF vectors), so we
#        can RETRIEVE the most relevant facts for any question.
#   Later, we swap TF-IDF for neural embeddings + Amazon Bedrock - same idea.
#
# HOW TO RUN (from the therapist_engine folder):
#   python3 knowledge/build_knowledge_base.py
# =============================================================================

# This line lets us write modern type hints like "X | None" even on Python 3.9
# (it makes Python treat all type hints as text instead of running them).
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

# Make sure Python can find your "src" folder no matter where we run this from:
# add the therapist_engine root (this file's parent's parent) to the import path.
sys.path.insert(0, str(Path(__file__).parent.parent))

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Borrow your Phase-1 forms (the KnowledgeRecord + its menus).
from src.models.knowledge_record import KnowledgeRecord
from src.models.enums import SourceType, ReviewStatus


HERE = Path(__file__).parent
OUT_FILE = HERE / "va_knowledge.json"

# The VA PTSD Repository "Study Interventions" table, via its public API.
VA_API = "https://ptsd-va.data.socrata.com/resource/jckr-i5ky.json?$limit=150"
VA_SOURCE_URL = "https://www.ptsd.va.gov/ptsdrepository/index.asp"


def fetch_va_rows():
    """Download real rows from the VA PTSD Repository (public Socrata API)."""
    with urllib.request.urlopen(VA_API, timeout=30) as resp:
        return json.load(resp)


def row_to_record(row: dict) -> KnowledgeRecord | None:
    """
    Turn ONE VA trial row into a KnowledgeRecord (your Phase-1 form).
    We keep the SOURCE (that is the whole point of provenance).
    """
    treatment = row.get("ncptsd_treatment_name") or row.get("treatment_name")
    desc = row.get("treatment_desc")
    citation = row.get("citation")
    # Skip rows with no usable description (we need real source text).
    if not treatment or not desc:
        return None

    return KnowledgeRecord(
        organization="U.S. Department of Veterans Affairs - National Center for PTSD",
        title=f"{treatment} for PTSD ({row.get('author_year','')})",
        url=VA_SOURCE_URL,
        source_type=SourceType.RESEARCH_SUMMARY,   # it's clinical-trial evidence
        # exact_source_text = the VA's own words (never edited).
        exact_source_text=desc,
        # structured_interpretation = OUR short machine-friendly summary.
        structured_interpretation=(
            f"{treatment} ({row.get('study_class','')}) was studied for PTSD; "
            f"n={row.get('total_n_randomized','?')} randomized."
        ),
        section=citation[:120] if citation else None,
        evidence_level=row.get("risk_of_bias_rating_study_level"),
        restrictions=["clinical trial evidence", "not individualized treatment advice"],
        # It comes from an authoritative source, so we mark it approved + who by.
        review_status=ReviewStatus.APPROVED,
        reviewer="VA National Center for PTSD (source-trusted)",
    )


def main():
    print("Downloading real VA PTSD Repository rows...")
    rows = fetch_va_rows()
    print("  got", len(rows), "trial rows")

    # Build KnowledgeRecords (Pydantic validates each one - bad data is rejected).
    records = []
    for row in rows:
        rec = row_to_record(row)
        if rec is not None:
            records.append(rec)
    print("  built", len(records), "KnowledgeRecords (with full source provenance)")

    # Save them to a file (later this becomes a real database / vector store).
    OUT_FILE.write_text(json.dumps([r.model_dump(mode="json") for r in records], indent=2))
    print("  saved to", OUT_FILE)

    # --- Build a simple SEARCH INDEX (TF-IDF) so we can RETRIEVE facts ---
    # Each record's searchable text = its title + our summary + the source text.
    texts = [f"{r.title}. {r.structured_interpretation} {r.exact_source_text}" for r in records]
    vectorizer = TfidfVectorizer(stop_words="english")
    matrix = vectorizer.fit_transform(texts)

    def retrieve(question: str, k: int = 3):
        # Turn the question into the same kind of vector, then find the closest records.
        q_vec = vectorizer.transform([question])
        scores = cosine_similarity(q_vec, matrix)[0]
        top = scores.argsort()[::-1][:k]
        return [(records[i], float(scores[i])) for i in top]

    # --- Demo the retrieval (this is the "R" in RAG) ---
    for question in ["medication for PTSD", "talk therapy trauma", "ketamine infusion"]:
        print(f"\nQ: '{question}'  -> top matches:")
        for rec, score in retrieve(question):
            print(f"   [{score:.2f}] {rec.title}")

    print(
        "\nDONE. This is your RAG knowledge base: real VA facts, each with its "
        "source, retrievable by meaning. Next step (Phase 4): hand the retrieved "
        "facts to Bedrock so the AI quotes them instead of inventing."
    )


if __name__ == "__main__":
    main()
