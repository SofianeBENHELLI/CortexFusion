//! Resource-bounded Rust child process; never opens document paths, URLs or macros.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::io::Read;
#[derive(Serialize, Deserialize)]
pub struct Parsed {
    pub content: Option<String>,
    #[serde(default)]
    pub spans: Vec<Value>,
    pub error_code: Option<String>,
}
impl Parsed {
    fn error(code: &str) -> Self {
        Self {
            content: None,
            spans: vec![],
            error_code: Some(code.into()),
        }
    }
}
fn blank(s: &str) -> bool {
    s.chars()
        .all(|c| c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c))
}
fn decode_xml(raw: &[u8]) -> Result<String, &'static str> {
    let (little, bytes) = if raw.starts_with(&[0xff, 0xfe]) {
        (true, &raw[2..])
    } else if raw.starts_with(&[0xfe, 0xff]) {
        (false, &raw[2..])
    } else if raw.starts_with(&[b'<', 0, b'?', 0]) {
        (true, raw)
    } else if raw.starts_with(&[0, b'<', 0, b'?']) {
        (false, raw)
    } else {
        return std::str::from_utf8(raw.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(raw))
            .map(str::to_owned)
            .map_err(|_| "PARSE_FAILED");
    };
    if bytes.len() % 2 != 0 {
        return Err("PARSE_FAILED");
    };
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| {
            if little {
                u16::from_le_bytes([b[0], b[1]])
            } else {
                u16::from_be_bytes([b[0], b[1]])
            }
        })
        .collect();
    String::from_utf16(&units).map_err(|_| "PARSE_FAILED")
}
fn extract(raw: &[u8], extension: &str) -> Result<Parsed, &'static str> {
    let pieces: Vec<(String, Value)> = match extension {
        "txt" | "md" | "markdown" => vec![(
            std::str::from_utf8(raw.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(raw))
                .map_err(|_| "INVALID_ENCODING")?
                .into(),
            json!({"section":1}),
        )],
        "pdf" => {
            let doc = pdf_extract::Document::load_mem(raw).map_err(|_| "PARSE_FAILED")?;
            if doc.is_encrypted() {
                return Err("ENCRYPTED_DOCUMENT");
            };
            let pages = doc.get_pages();
            if pages.len() > 100 {
                return Err("DOCUMENT_LIMIT");
            };
            let mut result = vec![];
            for number in pages.keys() {
                let mut text = String::new();
                pdf_extract::output_doc_page(
                    &doc,
                    &mut pdf_extract::PlainTextOutput::new(&mut text),
                    *number,
                )
                .map_err(|_| "PARSE_FAILED")?;
                result.push((text, json!({"page":number})));
            }
            result
        }
        "docx" => {
            let mut zip =
                zip::ZipArchive::new(std::io::Cursor::new(raw)).map_err(|_| "PARSE_FAILED")?;
            if zip.len() > 2000 {
                return Err("DOCUMENT_LIMIT");
            };
            let mut sum = 0u64;
            for index in 0..zip.len() {
                let entry = zip.by_index(index).map_err(|_| "PARSE_FAILED")?;
                sum = sum.checked_add(entry.size()).ok_or("DOCUMENT_LIMIT")?;
                if sum > 8_000_000
                    || entry.size() > entry.compressed_size().max(1).saturating_mul(200)
                {
                    return Err("DOCUMENT_LIMIT");
                }
            }
            let mut xml = Vec::new();
            zip.by_name("word/document.xml")
                .map_err(|_| "PARSE_FAILED")?
                .take(8_000_001)
                .read_to_end(&mut xml)
                .map_err(|_| "PARSE_FAILED")?;
            if xml.len() > 8_000_000 {
                return Err("DOCUMENT_LIMIT");
            };
            let xml = decode_xml(&xml)?;
            let upper = xml.to_ascii_uppercase();
            if upper.contains("<!DOCTYPE") || upper.contains("<!ENTITY") {
                return Err("UNSAFE_XML");
            }
            let doc = roxmltree::Document::parse_with_options(
                &xml,
                roxmltree::ParsingOptions {
                    allow_dtd: false,
                    nodes_limit: 1_000_000,
                    ..Default::default()
                },
            )
            .map_err(|_| "PARSE_FAILED")?;
            let ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
            let mut result = vec![];
            for (index, p) in doc
                .descendants()
                .filter(|n| n.has_tag_name((ns, "p")))
                .enumerate()
            {
                let mut text = String::new();
                for n in p
                    .descendants()
                    .filter(|n| n.is_element() && n.tag_name().namespace() == Some(ns))
                {
                    match n.tag_name().name() {
                        "t" => text.push_str(n.text().unwrap_or("")),
                        "tab" => text.push('\t'),
                        "br" | "cr" => text.push('\n'),
                        _ => {}
                    }
                }
                result.push((text, json!({"paragraph":index+1})));
            }
            result
        }
        _ => return Err("UNSUPPORTED_FORMAT"),
    };
    let mut content = String::new();
    let mut spans = vec![];
    let mut length = 0;
    for (piece, mut locator) in pieces {
        if blank(&piece) {
            continue;
        }
        if !content.is_empty() {
            content.push_str("\n\n");
            length += 2
        }
        let start = length;
        length += piece.chars().count();
        if length > 30000 {
            return Err("TEXT_REQUIRES_SPLITTING");
        };
        content.push_str(&piece);
        locator["start"] = json!(start);
        locator["end"] = json!(length);
        spans.push(locator)
    }
    if blank(&content) {
        return Err("NO_EXTRACTABLE_TEXT");
    };
    if content.contains('\0') {
        return Err("INVALID_TEXT");
    };
    Ok(Parsed {
        content: Some(content),
        spans,
        error_code: None,
    })
}
/// Called before constructing the asynchronous runtime, with no database or provider environment.
pub fn child(extension: &str) {
    #[cfg(unix)]
    unsafe {
        // Fixed resource constants; no file descriptor or caller pointer is passed to the OS.
        let cpu = libc::rlimit {
            rlim_cur: 10,
            rlim_max: 10,
        };
        if libc::setrlimit(libc::RLIMIT_CPU, &cpu) != 0 {
            std::process::exit(70)
        }
        #[cfg(target_os = "linux")]
        {
            let memory = libc::rlimit {
                rlim_cur: 512 * 1024 * 1024,
                rlim_max: 512 * 1024 * 1024,
            };
            if libc::setrlimit(libc::RLIMIT_AS, &memory) != 0 {
                std::process::exit(70)
            }
        }
    }
    let mut raw = vec![];
    let result = if std::io::stdin().take(500001).read_to_end(&mut raw).is_err() {
        Parsed::error("PARSE_FAILED")
    } else if raw.len() > 500000 {
        Parsed::error("DOCUMENT_LIMIT")
    } else {
        extract(&raw, extension).unwrap_or_else(Parsed::error)
    };
    println!(
        "{}",
        serde_json::to_string(&result).unwrap_or_else(|_| "{}".into())
    );
}
pub async fn parse(raw: Vec<u8>, filename: &str) -> Parsed {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let extension = filename
        .rsplit_once('.')
        .map(|(_, x)| x.to_lowercase())
        .unwrap_or_default();
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let executable = std::env::current_exe().map_err(|_| ())?;
        let mut child = tokio::process::Command::new(executable)
            .args(["--parse-document", &extension])
            .env_clear()
            .env("RAYON_NUM_THREADS", "1")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| ())?;
        let mut stdin = child.stdin.take().ok_or(())?;
        stdin.write_all(&raw).await.map_err(|_| ())?;
        drop(stdin);
        let mut out = vec![];
        child
            .stdout
            .take()
            .ok_or(())?
            .take(4_000_001)
            .read_to_end(&mut out)
            .await
            .map_err(|_| ())?;
        if out.len() > 4_000_000 {
            return Err(());
        };
        let status = child.wait().await.map_err(|_| ())?;
        if !status.success() {
            return Err(());
        };
        serde_json::from_slice::<Parsed>(&out).map_err(|_| ())
    })
    .await;
    match result {
        Err(_) => Parsed::error("PARSE_TIMEOUT"),
        Ok(Err(_)) => Parsed::error("PARSE_RESOURCE_FAILURE"),
        Ok(Ok(r)) => r,
    }
}
