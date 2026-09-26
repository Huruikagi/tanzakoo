//! File selection policy shared by registration, listing, reading, and search.
use super::invalid;
use crate::store::Result;
use std::{ffi::OsStr, path::Path};
pub(super) fn excluded(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    matches!(
        name.as_str(),
        ".git"
            | ".hg"
            | ".svn"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | "out"
            | "coverage"
            | ".next"
            | ".nuxt"
            | ".cache"
            | ".venv"
            | "venv"
            | "__pycache__"
            | ".ssh"
            | ".aws"
            | ".gnupg"
            | ".npmrc"
            | ".pypirc"
            | "credentials"
            | "id_rsa"
            | "id_ed25519"
    ) || name.starts_with(".env")
        || [".pem", ".key", ".p12", ".pfx"]
            .iter()
            .any(|ext| name.ends_with(ext))
}
pub(super) fn text_file(name: &str) -> bool {
    if excluded(name) {
        return false;
    }
    let name = name.to_ascii_lowercase();
    if matches!(
        name.as_str(),
        "dockerfile"
            | "makefile"
            | "justfile"
            | "license"
            | "readme"
            | ".gitignore"
            | ".gitattributes"
            | ".editorconfig"
    ) {
        return true;
    }
    matches!(
        Path::new(&name).extension().and_then(OsStr::to_str),
        Some(
            "md" | "markdown"
                | "mdx"
                | "txt"
                | "rst"
                | "adoc"
                | "rs"
                | "js"
                | "jsx"
                | "ts"
                | "tsx"
                | "mjs"
                | "cjs"
                | "mts"
                | "cts"
                | "py"
                | "pyi"
                | "go"
                | "java"
                | "kt"
                | "kts"
                | "swift"
                | "c"
                | "h"
                | "cc"
                | "cpp"
                | "hpp"
                | "cs"
                | "fs"
                | "fsx"
                | "rb"
                | "php"
                | "sh"
                | "bash"
                | "zsh"
                | "ps1"
                | "psm1"
                | "bat"
                | "cmd"
                | "sql"
                | "json"
                | "jsonc"
                | "toml"
                | "yaml"
                | "yml"
                | "xml"
                | "html"
                | "htm"
                | "css"
                | "scss"
                | "sass"
                | "less"
                | "vue"
                | "svelte"
                | "astro"
                | "graphql"
                | "gql"
                | "proto"
                | "lua"
                | "ex"
                | "exs"
                | "erl"
                | "hrl"
                | "dart"
                | "r"
                | "jl"
                | "clj"
                | "cljs"
                | "scala"
                | "ini"
                | "cfg"
                | "conf"
        )
    )
}
pub(super) fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains([':', '\\', '/', '\0'])
        && !name.ends_with(['.', ' '])
        && !excluded(name)
        && !(cfg!(windows) && name.contains('~'))
}
pub(super) fn relative_parts(path: &str) -> Result<Vec<String>> {
    if path.is_empty() {
        return Ok(vec![]);
    }
    let path = path.replace('\\', "/");
    let parts: Vec<_> = path.split('/').collect();
    if path.len() > 4096 || parts.len() > 64 || parts.iter().any(|part| !safe_name(part)) {
        return Err(invalid(
            "登録範囲内の相対パスを指定してください。除外対象や親フォルダーは参照できません。",
        ));
    }
    Ok(parts.into_iter().map(str::to_owned).collect())
}
