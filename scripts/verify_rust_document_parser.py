"""Real native child process and durable file processing on synthetic formats."""
import base64
import io
import zipfile
from uuid import uuid4
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject


def docx(text="Call operations 🧠."):
    output=io.BytesIO()
    with zipfile.ZipFile(output,"w") as z:
        z.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>')
    return output.getvalue()


def pdf(encrypted=False, blank=False, pages=1):
    w=PdfWriter()
    for _ in range(pages):
        page=w.add_blank_page(600,800)
        if not blank:
            font=DictionaryObject({NameObject("/Type"):NameObject("/Font"),NameObject("/Subtype"):NameObject("/Type1"),NameObject("/BaseFont"):NameObject("/Helvetica")})
            page[NameObject("/Resources")]=DictionaryObject({NameObject("/Font"):DictionaryObject({NameObject("/F1"):w._add_object(font)})})
            stream=DecodedStreamObject();stream.set_data(b"BT /F1 12 Tf 20 700 Td (Call operations for incidents.) Tj ET")
            page[NameObject("/Contents")]=w._add_object(stream)
    if encrypted:w.encrypt("synthetic-only")
    output=io.BytesIO();w.write(output);return output.getvalue()


def verify_document_parser(client,headers,domain):
    root=f"/v1/domains/{domain}"
    col=client.post(root+"/collections",headers=headers(),json={"name":"Native parsing", "allowed_subjects":["alice","bob"],"idempotency_key":str(uuid4())}).json()["id"]
    def upload(raw,filename):
        r=client.post(root+f"/collections/{col}/files",headers=headers(),json={"filename":filename,"content_base64":base64.b64encode(raw).decode(),"allowed_subjects":["alice","bob"],"idempotency_key":str(uuid4())})
        assert r.status_code==202,r.text
        return root+"/files/"+r.json()["id"]
    for raw,name,locator in [(b'\xef\xbb\xbf'+"Call operations 🧠.".encode(),"native.txt","section"),(docx(),"native.docx","paragraph"),(pdf(),"native.pdf","page")]:
        url=upload(raw,name)
        assert client.post(url+"/process",headers=headers(sub="bob")).status_code==403
        r=client.post(url+"/process",headers=headers());assert r.status_code==200,r.text
        f=r.json();assert f["status"]=="succeeded" and f["attempts"]==1,f
        assert f["spans"][0][locator]==1
        source=client.get(root+"/sources/"+f["source_id"],headers=headers(sub="bob")).json()
        assert "Call operations" in source["content"]
        assert f["spans"][0]["end"]==len(source["content"])
        assert client.post(url+"/process",headers=headers()).json()==f
        assert client.post(url+"/cancel",headers=headers()).json()==f
    for raw,name,error in [(b'\xff',"bad.txt","INVALID_ENCODING"),(b'\x00',"bad.txt","INVALID_TEXT"),(b'  \n',"blank.md","NO_EXTRACTABLE_TEXT"),(b'x'*30001,"big.txt","TEXT_REQUIRES_SPLITTING"),(b'raw',"unknown.bin","UNSUPPORTED_FORMAT"),(b'bad',"bad.pdf","PARSE_FAILED"),(pdf(encrypted=True),"secret.pdf","ENCRYPTED_DOCUMENT"),(pdf(blank=True),"blank.pdf","NO_EXTRACTABLE_TEXT"),(pdf(blank=True,pages=101),"big.pdf","DOCUMENT_LIMIT"),(docx('<!DOCTYPE foo>'),"unsafe.docx","UNSAFE_XML")]:
        url=upload(raw,name);r=client.post(url+"/process",headers=headers());assert r.status_code==200,r.text
        f=r.json();assert f["status"]=="failed" and f["error_code"]==error and f["spans"]==[],(name,f)
        assert client.post(url+"/process",headers=headers()).json()==f
        assert client.post(url+"/retry",headers=headers()).json()["status"]=="pending"
        assert client.post(url+"/process",headers=headers()).json()["attempts"]==2
    url=upload(b'cancelled',"cancel.txt");client.post(url+"/cancel",headers=headers())
    assert client.post(url+"/process",headers=headers()).status_code==409
    return ["native_rust_child_txt_docx_pdf_unicode_spans_and_source_receipts", "native_document_encryption_format_size_encoding_failures_and_retry"]
