fn main() {
    println!("cargo:rerun-if-env-changed=TANZAKOO_REVIEW_URL");
    tauri_build::build()
}
