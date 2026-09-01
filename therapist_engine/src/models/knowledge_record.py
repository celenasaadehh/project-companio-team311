# =============================================================================
# knowledge_record.py
# -----------------------------------------------------------------------------
# This file defines ONE form (model): KnowledgeRecord.
#
# A KnowledgeRecord is ONE piece of official PTSD knowledge (e.g. one fact from
# a U.S. Department of Veterans Affairs page) together with PROOF of where it
# came from. This "proof of source" is called PROVENANCE.
#
# Two ideas make this form important:
#   1. NO patient_id. Knowledge is GENERAL — the same VA fact applies to
#      everyone, so it is never tied to a single person.
#   2. We keep the VA's EXACT words separate from OUR summary of them, so our
#      summary can never be mistaken for the official source text.
#
# NOTE: we are only designing the FORM here. We are NOT downloading any real VA
# content yet. All examples are fictional/placeholder.
# =============================================================================


# -----------------------------------------------------------------------------
# IMPORTS
# -----------------------------------------------------------------------------

from datetime import datetime, timezone
from typing import Optional

# uuid4 generates a random, practically-unique value. We use it to AUTO-GENERATE
# the knowledge_id, because knowledge is bulk-ingested (thousands of records at
# once from official sources) — nobody types thousands of ids by hand.
from uuid import uuid4

# HttpUrl is a special type (like EmailStr) that CHECKS the value looks like a
# real web address (starts with http/https, has a domain, etc.). If someone
# passes "not a url", Pydantic rejects it.
from pydantic import BaseModel, Field, HttpUrl

# Reuse two menus: what KIND of source it is, and whether a human reviewed it.
from .enums import SourceType, ReviewStatus


# -----------------------------------------------------------------------------
# THE FORM: KnowledgeRecord
# -----------------------------------------------------------------------------
class KnowledgeRecord(BaseModel):

    # YOUR RULE: a unique id for this fact. This is a RECORD id, and because
    # knowledge is bulk-ingested automatically (thousands at once), we
    # AUTO-GENERATE it like event_id and decision_id. Example: "K-3f9a2b1c".
    knowledge_id: str = Field(default_factory=lambda: f"K-{uuid4().hex[:8]}")

    # --- WHERE it came from (provenance) ---------------------------------

    # YOUR RULE: who published it. Authority matters. e.g. "U.S. Dept. of
    # Veterans Affairs".
    organization: str

    # YOUR RULE: the document/page title. e.g. "PTSD Basics".
    title: str

    # YOUR RULE: the web address it came from. HttpUrl means it is checked to be
    # a valid-looking URL. e.g. "https://www.ptsd.va.gov/...".
    url: HttpUrl

    # YOUR RULE: when the SOURCE was published/updated. Optional — not every
    # page states one.
    publication_date: Optional[datetime] = None

    # YOUR RULE: when WE fetched it. Auto-filled. Sources change over time, so we
    # record the moment we captured this version.
    retrieval_date: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    # YOUR RULE: what KIND of source this is (menu). e.g. clinical_guideline.
    source_type: SourceType

    # --- WHAT it says (the two-part split that matters) ------------------

    # YOUR RULE: the VERBATIM text from the source — the official words, exactly.
    # This box is NEVER edited or paraphrased. Required, because a knowledge
    # record with no source text has no proof behind it.
    exact_source_text: str

    # YOUR RULE: where in the document the quote is. Optional. e.g. "Section 2".
    section: Optional[str] = None

    # YOUR RULE: OUR machine-friendly restatement/summary of the fact.
    # ---------------------------------------------------------------------
    # WHY this is a SEPARATE box from exact_source_text:
    #   exact_source_text = what the VA REALLY said (their words).
    #   structured_interpretation = OUR paraphrase for the machine.
    #   If these were ever merged, our paraphrase (which might contain a subtle
    #   error) could later be quoted as if the VA said it. Keeping them apart
    #   guarantees we can always show the official words, word-for-word,
    #   separate from anything we generated. This is a core trust/safety rule.
    # ---------------------------------------------------------------------
    structured_interpretation: Optional[str] = None

    # YOUR RULE: limits on how this fact may be used. e.g.
    # ["not medication advice", "general information only"].
    restrictions: list[str] = Field(default_factory=list)

    # YOUR RULE: how strong the evidence is, IF the source states it. Optional
    # text. e.g. "strong".
    evidence_level: Optional[str] = None

    # --- REVIEW (a human must approve knowledge before use) --------------

    # YOUR RULE: has a human reviewed this? Menu value. DEFAULT is PENDING, which
    # is the SAFE default: brand-new knowledge is "not yet approved" until a
    # human explicitly approves it. The system should only ever USE knowledge
    # whose status is APPROVED.
    review_status: ReviewStatus = ReviewStatus.PENDING
    #the therapist must review millions of sources? impossible 

    # YOUR RULE: who approved it, for accountability. Optional. e.g.
    # "clinician:C-003".
    reviewer: Optional[str] = None

    # YOUR RULE: when WE created this record in our system. Auto-filled.
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
