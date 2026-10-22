//! The parser child cannot inflate a small PDF past its heap cap, on any platform.
use base64::Engine;
use pdf_extract::{Dictionary, Document, Object, Stream};
use std::{
    io::Write,
    process::{Command, ExitStatus, Stdio},
};

// Two FlateDecode layers over 512 MiB of zeros, 958 bytes. Generated with Python:
// c = zlib.compressobj(9)
// zlib.compress(b"".join(c.compress(bytes(1 << 20)) for _ in range(512)) + c.flush(), 9)
const INFLATING: [&str; 15] = [
    "eNrt3D0uRAEYRuE7MYUoDIVKYxkaCY1aQS0WoNeZRPQ2oVZZgM4O/FSzAFEoVIKYNajueZ4lvOWXL+fi9e1hMhmG",
    "YX7zffe+ujYAAAAAIzd/uVr5OwYMOz9Ph0cnAAAAwNidzdany6PA1+n2gTkAAABg9K73djeWHwIfl+dTcwAAAMDo",
    "bX0u9pe3gMef+81jewAAAMDoPQsGAAAAQIpgAAAAALQIBgAAAECLYAAAAADECAYAAABAi2AAAAAAtAgGAAAAQItg",
    "AAAAAMQIBgAAAECLYAAAAAC0CAYAAABAi2AAAAAAxAgGAAAAQItgAAAAALQIBgAAAECLYAAAAADECAYAAABAi2AA",
    "AAAAtAgGAAAAQItgAAAAAMQIBgAAAECLYAAAAAC0CAYAAABAi2AAAAAAxAgGAAAAQItgAAAAALQIBgAAAECLYAAA",
    "AADECAYAAABAi2AAAAAAtAgGAAAAQItgAAAAAMQIBgAAAECLYAAAAAC0CAYAAABAi2AAAAAAxAgGAAAAQItgAAAA",
    "ALQIBgAAAECLYAAAAADECAYAAABAi2AAAAAAtAgGAAAAQItgAAAAAMQIBgAAAECLYAAAAAC0CAYAAABAi2AAAAAA",
    "xAgGAAAAQItgAAAAALQIBgAAAECLYAAAAADECAYAAABAi2AAAAAAtAgGAAAAQItgAAAAAMQIBgAAAECLYAAAAAC0",
    "CAYAAABAi2AAAAAAxAgGAAAAQItgAAAAALQIBgAAAECLYAAAAADECAYAAABAi2AAAAAAtAgGAAAAQItgAAAAAMQI",
    "BgAAAECLYAAAAAC0CAYAAABAi2AAAAAAxAgGAAAAQItgAAAAALQIBgAAAECLYAAAAADECAYAAABAi2AAAAAAtAgG",
    "AAAAQItgAAAAAMQIBgAAAECLYAAAAAC0CAYAAABAi2AAAAAAxAgGAAAAQItgAAAAALQIBgAAAECLYAAAAADECAYA",
    "AABAi2AAAAAAtAgGAAAAQItgAAAAAMQIBgAAAECLYAAAAAC0CAYAAABAi2AAAAAAxAgGAAAAQItgAAAAALQIBgAA",
    "AECLYAAAAADECAYAAABAi2AAAAAAtAgGAAAAQItgAAAAAMQIBgAAAECLYAAAAAC0CAYAAABAi2AAAAAAxAgGAAAA",
    "QItgAAAAALQIBgAAAECLYAAAAADECAYAAABAi2AAAAAAtAgGAAAAQItgAAAAAMQIBgAAAECLYAAAAAC0CAYAAABA",
    "i2AAAAAAxAgGAAAAQItgAAAAALTc/mcwYFjMhskvY4VJfw==",
];

fn name(value: &str) -> Object {
    Object::Name(value.as_bytes().to_vec())
}

fn pdf(contents: Stream) -> Vec<u8> {
    let mut doc = Document::with_version("1.5");
    let pages = doc.new_object_id();
    let mut font = Dictionary::new();
    font.set("Type", name("Font"));
    font.set("Subtype", name("Type1"));
    font.set("BaseFont", name("Helvetica"));
    let mut fonts = Dictionary::new();
    fonts.set("F1", doc.add_object(font));
    let mut resources = Dictionary::new();
    resources.set("Font", fonts);
    let mut page = Dictionary::new();
    page.set("Type", name("Page"));
    page.set("Parent", pages);
    page.set("MediaBox", vec![0.into(), 0.into(), 600.into(), 800.into()]);
    page.set("Resources", resources);
    page.set("Contents", doc.add_object(contents));
    let page = doc.add_object(page);
    let mut tree = Dictionary::new();
    tree.set("Type", name("Pages"));
    tree.set("Kids", vec![page.into()]);
    tree.set("Count", 1);
    doc.objects.insert(pages, Object::Dictionary(tree));
    let mut catalog = Dictionary::new();
    catalog.set("Type", name("Catalog"));
    catalog.set("Pages", pages);
    let catalog = doc.add_object(catalog);
    doc.trailer.set("Root", catalog);
    let mut raw = vec![];
    doc.save_to(&mut raw).unwrap();
    raw
}

fn parse(raw: &[u8]) -> (ExitStatus, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_cortex-rust-core"))
        .args(["--parse-document", "pdf"])
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(raw).unwrap();
    let output = child.wait_with_output().unwrap();
    (output.status, String::from_utf8(output.stdout).unwrap())
}

#[test]
fn ordinary_pdf_parses_under_the_heap_cap() {
    let text = b"BT /F1 12 Tf 20 700 Td (Call operations for incidents.) Tj ET".to_vec();
    let (status, output) = parse(&pdf(Stream::new(Dictionary::new(), text)));
    assert!(status.success());
    assert!(
        output.contains("Call operations for incidents."),
        "{output}"
    );
}

#[cfg(unix)]
#[test]
fn nested_flate_stream_aborts_at_the_heap_cap() {
    use std::os::unix::process::ExitStatusExt;
    let inflating = base64::engine::general_purpose::STANDARD
        .decode(INFLATING.concat())
        .unwrap();
    let mut dict = Dictionary::new();
    dict.set("Filter", vec![name("FlateDecode"), name("FlateDecode")]);
    let raw = pdf(Stream::new(dict, inflating));
    assert!(raw.len() < 5000);
    // A refused allocation aborts; the CPU limit would end it with SIGXCPU instead.
    let (status, output) = parse(&raw);
    assert_eq!(status.signal(), Some(libc::SIGABRT), "{output}");
}
