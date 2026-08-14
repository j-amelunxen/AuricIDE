fn main() {
    tauri_build::build();

    // `tauri dev` runs the bare debug binary, which otherwise has no Info.plist
    // and shows up to Accessibility as `unknown.<pid>`. Embedding the same
    // identifier the packaged app uses (`com.auricide.ide`) makes
    // `axbridge menu com.auricide.ide "…"` work against the developer build.
    if std::env::var("CARGO_CFG_TARGET_OS").ok().as_deref() == Some("macos") {
        let plist =
            std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("Info.plist");
        println!("cargo:rerun-if-changed=Info.plist");
        println!(
            "cargo:rustc-link-arg-bins=-Wl,-sectcreate,__TEXT,__info_plist,{}",
            plist.display()
        );
    }
}
