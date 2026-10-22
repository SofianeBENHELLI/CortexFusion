from uuid import uuid4

import pytest
from cortex_core.retrieval_passages import passage_range, select_context, words


@pytest.mark.parametrize("position", [0, 100_000, 199_900])
def test_long_body_returns_exact_unicode_evidence_near_question(position):
    target = "La constellation violette contient 🧠 sept étoiles.\n"
    prefix = "Bruit.\n" * (position // 7)
    body = prefix + target
    body += ("Bruit.\n" * 30_000)[: 200_000 - len(body)]
    concept = {
        "concept_id": str(uuid4()),
        "title": "Astronomie",
        "maturity": "emerging",
        "body": body,
        "links": [],
        "sources": [{"source_id": str(uuid4()), "start": 13, "end": 13 + len(body)}],
    }
    passage = select_context(concept, words("constellation violette"), 100)
    assert passage and len(passage["text"]) <= 100
    assert target.rstrip() in passage["text"]
    assert body[passage["body_start"] : passage["body_end"]] == passage["text"]
    ref = passage["sources"][0]
    assert ("🧠" * 13 + body)[ref["start"] : ref["end"]] == passage["text"]
    assert concept["body"] == body and passage["body_total_chars"] == 200_000


def test_casefold_does_not_shift_source_offsets():
    body = "Divers.\n" * 30 + "La Straße possède une entrée 🧠.\n" + "Divers.\n" * 30
    a, b = passage_range(body, "Guide", words("strasse entrée"), 100)
    assert "Straße" in body[a:b] and "entrée" in body[a:b]


def test_generous_budget_does_not_bury_evidence_under_irrelevant_units():
    body = "Divers.\n" * 20_000 + "Le zircon possède sept faces.\n" + "Divers.\n" * 20_000
    a, b = passage_range(body, "Guide", words("zircon sept"), 8000)
    assert "Le zircon possède sept faces." in body[a:b]
    assert b - a < 100 and body[a:b].count("Divers.") == 2


def test_oversized_indivisible_text_is_not_silently_cut():
    assert passage_range("quartz " * 100, "Quartz", words("quartz"), 100) is None


def test_terms_far_apart_are_not_combined_into_an_unsupported_excerpt():
    body = "Premier quartz.\n" + "Intermédiaire.\n" * 100 + "Dernier saphir."
    assert passage_range(body, "Géologie", words("quartz saphir"), 100) is None


def test_mapping_a_later_source_span_preserves_body_and_source_coordinates():
    first = "Introduction.\n" * 20
    second = "Contexte.\n" * 20 + "Le zircon possède sept faces.\n"
    concept = {
        "concept_id": str(uuid4()),
        "title": "Géologie",
        "maturity": "observed",
        "body": first + "\n\n" + second,
        "sources": [
            {"source_id": "first", "start": 50, "end": 50 + len(first)},
            {"source_id": "second", "start": 17, "end": 17 + len(second)},
        ],
    }
    p = select_context(concept, words("zircon sept"), 100)
    assert p["body_start"] >= len(first) + 2
    assert p["sources"][0]["source_id"] == "second"
    a, b = p["sources"][0]["start"], p["sources"][0]["end"]
    assert ("x" * 17 + second)[a:b] == p["text"]
    assert concept["body"][p["body_start"] : p["body_end"]] == p["text"]


def test_zero_budget_and_absent_words_do_not_produce_fragments():
    assert passage_range("Quartz.\n" * 100, "Guide", words("quartz"), 0) is None
    assert passage_range("Quartz.\n" * 100, "Guide", words("saphir"), 100) is None
