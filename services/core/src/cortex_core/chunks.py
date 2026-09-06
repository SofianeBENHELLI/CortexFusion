"""Lossless deterministic Unicode spans, bounded for model passage selection."""

from hashlib import sha256


def source_chunks(content):
    start = 0
    while start < len(content):
        end, size = start, 0
        while end < len(content) and end - start < 2000:
            width = len(content[end].encode("utf-8"))
            if size + width > 6000:
                break
            size += width
            end += 1
        # Prefer a nearby whitespace boundary without dropping any characters.
        if end < len(content):
            for candidate in range(end, max(start, end - 200), -1):
                if content[candidate - 1].isspace():
                    end = candidate
                    break
        text = content[start:end]
        yield {
            "start": start,
            "end": end,
            "content": text,
            "sha256": sha256(text.encode("utf-8")).hexdigest(),
        }
        start = end
