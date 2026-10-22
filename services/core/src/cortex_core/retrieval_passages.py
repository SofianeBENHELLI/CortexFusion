"""Literal, whole-unit passages with Unicode offsets; no model or source mutation."""

import re


def words(value):
    return set(re.findall(r"\w{3,}", value.casefold()))


def passage_range(body, title, terms, budget):
    """Select complete lines/sentences covering query terms absent from the title.

    An indivisible oversized unit is not silently truncated. Returning None means
    a context limit, not missing knowledge. Offsets are Unicode code points.
    """
    if not terms or not terms <= words(title) | words(body):
        return None
    if len(body) <= budget:
        return 0, len(body)
    required = terms - words(title)
    units, start = [], 0
    for i, char in enumerate(body):
        if char == "\n" or (char in ".!?。！？" and (i + 1 == len(body) or body[i + 1].isspace())):
            units.append((start, i + 1))
            start = i + 1
    if start < len(body):
        units.append((start, len(body)))
    left, counts = 0, {}
    hits = [words(body[a:b]) & required for a, b in units]
    for right, (_, end) in enumerate(units):
        for word in hits[right]:
            counts[word] = counts.get(word, 0) + 1
        while left <= right and end - units[left][0] > budget:
            for word in hits[left]:
                counts[word] -= 1
                if not counts[word]:
                    del counts[word]
            left += 1
        if left <= right and required <= counts.keys():
            # Remove irrelevant leading units, then retain one neighbouring
            # non-empty unit on each side when the caller's budget allows it.
            while left < right and all(counts[w] > 1 for w in hits[left]):
                for word in hits[left]:
                    counts[word] -= 1
                left += 1
            a = units[left][0]
            if body[a:end].strip():
                previous = left - 1
                while previous >= 0 and not body[slice(*units[previous])].strip():
                    previous -= 1
                if previous >= 0 and end - units[previous][0] <= budget:
                    a = units[previous][0]
                following = right + 1
                while following < len(units) and not body[slice(*units[following])].strip():
                    following += 1
                if following < len(units) and units[following][1] - a <= budget:
                    end = units[following][1]
                return a, end
    return None


def select_context(concept, terms, budget):
    """Return a passage and its source mapping, never a truncated Concept object.

    Published verbatim bodies are source spans joined by two newlines. A long
    body's selected passage stays within one span; the whole body remains
    available from the concept endpoint and is not overwritten by this view.
    """
    body = concept["body"]
    if len(body) <= budget:
        start, end, refs = 0, len(body), concept["sources"]
    else:
        offset = 0
        for ref in concept["sources"]:
            length = ref["end"] - ref["start"]
            selected = passage_range(
                body[offset : offset + length], concept["title"], terms, budget
            )
            if selected:
                a, b = selected
                start, end = offset + a, offset + b
                refs = [{**ref, "start": ref["start"] + a, "end": ref["start"] + b}]
                break
            offset += length + 2
        else:
            return None
    return {
        "concept_id": concept["concept_id"],
        "title": concept["title"],
        "maturity": concept["maturity"],
        "body_start": start,
        "body_end": end,
        "body_total_chars": len(body),
        "text": body[start:end],
        "sources": refs,
    }
