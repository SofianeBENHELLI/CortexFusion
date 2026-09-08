fn main() {
    let result = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|_| "Worker runtime initialization failed")
        .and_then(|runtime| runtime.block_on(cortex_rust_core::corpus_worker::run()));
    if let Err(message) = result {
        eprintln!("{message}");
        std::process::exit(1);
    }
}
