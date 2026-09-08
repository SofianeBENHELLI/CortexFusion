//! Opt-in allocation measurement of the actual native source excerpt implementation.
use std::{
    alloc::{GlobalAlloc, Layout, System},
    hint::black_box,
    sync::atomic::{AtomicUsize, Ordering},
    time::Instant,
};
struct Count;
static BYTES: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Count {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        BYTES.fetch_add(layout.size(), Ordering::Relaxed);
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        BYTES.fetch_add(size, Ordering::Relaxed);
        unsafe { System.realloc(ptr, layout, size) }
    }
}
#[global_allocator]
static ALLOC: Count = Count;
fn baseline(source: &str, start: usize, end: usize) -> Option<String> {
    let chars: Vec<char> = source.chars().collect();
    if start >= end || end > chars.len() {
        return None;
    }
    Some(chars[start..end].iter().collect())
}
fn runtime(source: &str, start: usize, end: usize) -> Option<String> {
    cortex_rust_core::knowledge::SourceRef {
        source_id: uuid::Uuid::nil(),
        start,
        end,
    }
    .excerpt(source)
    .ok()
}
fn main() {
    for source in ["", "a", "a🧠e\u{301}z", "\r\n你好אב🙂"] {
        let count = source.chars().count();
        for start in 0..count + 3 {
            for end in 0..count + 3 {
                assert_eq!(baseline(source, start, end), runtime(source, start, end));
            }
        }
        for (start, end) in [
            (usize::MAX, usize::MAX),
            (0, usize::MAX),
            (usize::MAX - 1, usize::MAX),
        ] {
            assert_eq!(baseline(source, start, end), runtime(source, start, end));
        }
    }
    let source = "a🧠e\u{301}z".repeat(40_000);
    let mut results = Vec::new();
    for (name, range) in [
        ("early", (10, 110)),
        ("late", (199_800, 199_900)),
        ("full", (0, 200_000)),
    ] {
        for (method, f) in [
            (
                "baseline",
                baseline as fn(&str, usize, usize) -> Option<String>,
            ),
            (
                "runtime",
                runtime as fn(&str, usize, usize) -> Option<String>,
            ),
        ] {
            let calls = if name == "full" { 100 } else { 1000 };
            BYTES.store(0, Ordering::SeqCst);
            let started = Instant::now();
            let mut checksum = 0;
            for _ in 0..calls {
                checksum += black_box(f(black_box(&source), range.0, range.1).unwrap()).len();
            }
            let seconds = started.elapsed().as_secs_f64();
            let bytes = BYTES.load(Ordering::SeqCst);
            results.push(format!("{{\"profile\":\"{}\",\"method\":\"{}\",\"calls\":{},\"seconds\":{},\"requested_allocation_bytes\":{},\"checksum\":{}}}",name,method,calls,seconds,bytes,checksum));
        }
    }
    println!(
        "{{\"status\":\"passed\",\"source_codepoints\":200000,\"source_utf8_bytes\":{},\"method\":\"native library compared with former Vec<char> algorithm; allocation requests, not peak RSS\",\"results\":[{}]}}",
        source.len(),
        results.join(",")
    );
}
