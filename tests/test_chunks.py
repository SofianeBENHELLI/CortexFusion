from uuid import uuid4

import pytest
from cortex_core.auth import CoreError
from cortex_core.chunks import source_chunks
from cortex_core.contracts import AccessInput, ExtractionInput
from cortex_core.extraction import ExtractionService


@pytest.mark.parametrize(
    "content", ["😀" * 7000, "école\n" * 2000, "x" * 6001, " \n" * 2000, "短い文", ""]
)
def test_chunks_are_lossless_bounded_and_deterministic(content):
    chunks = list(source_chunks(content))
    assert chunks == list(source_chunks(content))
    assert "".join(c["content"] for c in chunks) == content
    previous = 0
    for chunk in chunks:
        assert chunk["start"] == previous
        assert chunk["content"] == content[chunk["start"] : chunk["end"]]
        assert 0 < len(chunk["content"]) <= 2000
        assert len(chunk["content"].encode()) <= 6000
        previous = chunk["end"]


def test_chunk_pagination_and_revocation(world):
    source = world.source(content="😀" * 7000)
    path = world.prefix + f"/sources/{source['id']}/chunks"
    first = world.client.get(path, headers=world.headers("bob"), params={"limit": 1}).json()
    assert first["next_offset"] == first["items"][0]["end"]
    second = world.client.get(
        path, headers=world.headers("bob"), params={"offset": first["next_offset"]}
    ).json()
    assert second["items"][0]["start"] == first["next_offset"]
    assert world.client.get(path, headers=world.headers(), params={"offset": 1}).status_code == 422
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
    )
    assert world.client.get(path, headers=world.headers("bob")).status_code == 404


def test_extraction_span_offsets_and_retry(world):
    source = world.source(content="😀" * 7000 + "Passage cible.")
    calls = []

    class Model:
        provider = "openrouter"

        def select(self, content):
            calls.append(content)
            return {
                "start": 0,
                "end": len(content),
                "quote": content,
                "model": "synthetic",
                "model_digest": None,
                "prompt_version": "test",
                "input_tokens": None,
                "output_tokens": None,
            }

    service = ExtractionService(world.service, Model())
    data = ExtractionInput(
        processing_destination="openrouter",
        idempotency_key=str(uuid4()),
        span={"source_id": source["id"], "start": 7000, "end": 7014},
    )
    result = service.extract(world.owner, world.domain, source["id"], data, "openrouter")
    assert calls == ["Passage cible."]
    assert result["input_span"] == {"source_id": source["id"], "start": 7000, "end": 7014}
    ref = result["proposal"]["payload"][0]["concept"]["sources"][0]
    assert ref["start"] == 7000 and ref["end"] == 7014
    assert service.extract(world.owner, world.domain, source["id"], data, "openrouter") == result
    assert len(calls) == 1
    world.approve(result["proposal"])


@pytest.mark.parametrize(
    "span", [None, {"source_id": str(uuid4()), "start": 0, "end": 5}, {"start": 0, "end": 20000}]
)
def test_invalid_or_unbounded_extraction_never_calls_model(world, span):
    source = world.source(content="😀" * 7000)

    class Model:
        provider = "openrouter"

        def select(self, content):
            pytest.fail("Invalid span must be rejected before sending data")

    if span is not None:
        span = {"source_id": source["id"], **span}
    data = ExtractionInput(
        processing_destination="openrouter", idempotency_key=str(uuid4()), span=span
    )
    with pytest.raises(CoreError) as caught:
        ExtractionService(world.service, Model()).extract(
            world.owner, world.domain, source["id"], data, "openrouter"
        )
    assert caught.value.code in ("INVALID_SPAN", "EXTRACTION_LIMIT")
