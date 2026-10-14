fn main() {
    if std::env::var_os("CARGO_FEATURE_PERSONAL_CLAUDE").is_some() {
        assert!(
            std::env::var_os("CARGO_FEATURE_PUBLIC_DISTRIBUTION").is_none()
                && std::env::var_os("CARGO_FEATURE_APP_SANDBOX").is_none(),
            "personal-claude cannot be included in public-distribution or app-sandbox builds"
        );
    }
    println!("cargo:rerun-if-env-changed=TANZAKOO_REVIEW_URL");
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run Tauri build script");
}
