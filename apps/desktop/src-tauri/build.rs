fn main() {
    // The build the About panel reports. Outside a git checkout (a source tarball) it says "dev".
    let commit = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "dev".to_string());
    println!("cargo:rustc-env=IMBOX_COMMIT={commit}");
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    // Every app command is listed here so the capabilities in capabilities/ can allow them one by one.
    // The picker page may call the first six; the remote server page may call the rest.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "probe_server",
        "save_server",
        "get_server",
        "sign_in",
        "sign_in_code",
        "open_web_login",
        "set_badge",
        "notify",
        "take_pending_url",
        "open_external",
        "check_update",
        "install_update",
    ])))
    .expect("failed to run tauri-build");
}
