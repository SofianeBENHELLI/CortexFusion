"""Bounded text extraction subprocess. No URLs, macros or external tools are opened."""

import io
import json
import sys
import zipfile
from xml.etree import ElementTree


class ParseFailure(Exception):
    pass


def extract(raw, extension):
    pieces = []
    if extension in ("txt", "md", "markdown"):
        try:
            pieces = [(raw.decode("utf-8-sig"), {"section": 1})]
        except UnicodeDecodeError as exc:
            raise ParseFailure("INVALID_ENCODING") from exc
    elif extension == "pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw), strict=True)
        if reader.is_encrypted:
            raise ParseFailure("ENCRYPTED_DOCUMENT")
        if len(reader.pages) > 100:
            raise ParseFailure("DOCUMENT_LIMIT")
        for index, page in enumerate(reader.pages):
            pieces.append((page.extract_text() or "", {"page": index + 1}))
    elif extension == "docx":
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if len(infos) > 2000 or sum(i.file_size for i in infos) > 8_000_000:
                raise ParseFailure("DOCUMENT_LIMIT")
            if any(i.file_size > max(i.compress_size, 1) * 200 for i in infos):
                raise ParseFailure("DOCUMENT_LIMIT")
            xml = archive.read("word/document.xml")
            if b"<!DOCTYPE" in xml.upper() or b"<!ENTITY" in xml.upper():
                raise ParseFailure("UNSAFE_XML")
            root = ElementTree.fromstring(xml)
            ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
            for index, paragraph in enumerate(root.iter(ns + "p")):
                parts = []
                for node in paragraph.iter():
                    if node.tag == ns + "t":
                        parts.append(node.text or "")
                    elif node.tag == ns + "tab":
                        parts.append("\t")
                    elif node.tag in (ns + "br", ns + "cr"):
                        parts.append("\n")
                pieces.append(("".join(parts), {"paragraph": index + 1}))
    else:
        raise ParseFailure("UNSUPPORTED_FORMAT")
    content, spans = "", []
    for piece, locator in pieces:
        if not piece.strip():
            continue
        if content:
            content += "\n\n"
        start = len(content)
        content += piece
        if len(content) > 30000:
            raise ParseFailure("TEXT_REQUIRES_SPLITTING")
        spans.append({**locator, "start": start, "end": len(content)})
    if not content.strip():
        raise ParseFailure("NO_EXTRACTABLE_TEXT")
    if "\x00" in content:
        raise ParseFailure("INVALID_TEXT")
    return {"content": content, "spans": spans}


def main():
    # CPU bound on supported POSIX runtimes; Linux additionally bounds virtual memory.
    import resource

    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    raw = sys.stdin.buffer.read(500001)
    try:
        if len(raw) > 500000:
            raise ParseFailure("DOCUMENT_LIMIT")
        result = extract(raw, sys.argv[1])
    except ParseFailure as exc:
        result = {"error_code": str(exc)}
    except Exception:
        result = {"error_code": "PARSE_FAILED"}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
