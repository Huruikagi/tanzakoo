//! Read-only access to user-selected sources. The model never supplies an absolute path.
//! Each component is opened without following links, using capability-relative handles.
use crate::{
    model::{MaterialKind, ReferenceMaterial},
    store::{Result, Store, StoreError},
};
use cap_fs_ext::{DirExt, FollowSymlinks, MetadataExt, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsStr,
    io::Read,
    path::{Component, Path, PathBuf},
};

const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_ENTRIES: usize = 4000;
const MAX_SEARCH_BYTES: usize = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 24 * 1024;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct MaterialPath {
    pub material_id: String,
    /// Relative path inside the selected folder. Empty for its root or a selected file.
    #[serde(default)]
    pub path: String,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListFiles {
    #[serde(flatten)]
    pub source: MaterialPath,
    /// Pagination offset within this directory (200 entries per page).
    #[serde(default)]
    pub offset: usize,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ReadFile {
    #[serde(flatten)]
    pub source: MaterialPath,
    /// One-based start line; defaults to 1.
    pub start_line: Option<usize>,
    /// Defaults to 200, maximum 500.
    pub line_count: Option<usize>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SearchFiles {
    #[serde(flatten)]
    pub source: MaterialPath,
    /// Case-insensitive literal text, not a regular expression.
    pub query: String,
}
#[derive(Serialize)]
pub struct FileEntry {
    path: String,
    kind: &'static str,
}
#[derive(Serialize)]
pub struct FileList {
    entries: Vec<FileEntry>,
    next_offset: Option<usize>,
    truncated: bool,
}
#[derive(Serialize)]
pub struct SourceLine {
    line: usize,
    text: String,
    truncated: bool,
}
#[derive(Serialize)]
pub struct FileExcerpt {
    material_id: String,
    path: String,
    lines: Vec<SourceLine>,
    next_line: Option<usize>,
}
#[derive(Serialize)]
pub struct SearchHit {
    path: String,
    #[serde(flatten)]
    line: SourceLine,
}
#[derive(Default, Serialize)]
pub struct SearchResult {
    matches: Vec<SearchHit>,
    truncated: bool,
    skipped_files: usize,
    #[serde(skip)]
    entries: usize,
    #[serde(skip)]
    read_bytes: usize,
    #[serde(skip)]
    output_bytes: usize,
}

fn invalid(message: &str) -> StoreError {
    StoreError::Invalid(message.into())
}
fn access_error(_: std::io::Error) -> StoreError {
    invalid(
        "参照資料を開けません。移動・削除・アクセス権と、リンクを含まないパスかを確認してください。",
    )
}
fn excluded(name: &str) -> bool {
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
fn text_file(name: &str) -> bool {
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
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains([':', '\\', '/', '\0'])
        && !name.ends_with(['.', ' '])
        && !excluded(name)
        && !(cfg!(windows) && name.contains('~'))
}
fn relative_parts(path: &str) -> Result<Vec<String>> {
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

/// Open canonical absolute paths component by component. Replacing a parent with a
/// symlink/junction after registration must not grant access to the replacement target.
fn absolute_dir(path: &Path) -> Result<Dir> {
    if !path.is_absolute() {
        return Err(invalid("参照資料の保存パスが不正です。"));
    }
    let mut base = PathBuf::new();
    let mut components = path.components().peekable();
    while components
        .peek()
        .is_some_and(|c| matches!(c, Component::Prefix(_) | Component::RootDir))
    {
        base.push(components.next().unwrap().as_os_str());
    }
    let mut dir = Dir::open_ambient_dir(base, ambient_authority()).map_err(access_error)?;
    for part in components {
        let Component::Normal(name) = part else {
            return Err(invalid("参照資料の保存パスが不正です。"));
        };
        dir = dir.open_dir_nofollow(name).map_err(access_error)?;
    }
    Ok(dir)
}

pub fn validate_selection(path: &Path, kind: &MaterialKind) -> std::result::Result<String, String> {
    let check = || -> Result<String> {
        let metadata = std::fs::symlink_metadata(path).map_err(access_error)?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(invalid(
                    "リンクではなく元のファイル・フォルダーを選んでください。",
                ));
            }
        }
        if metadata.file_type().is_symlink() {
            return Err(invalid(
                "リンクではなく元のファイル・フォルダーを選んでください。",
            ));
        }
        let path = path.canonicalize().map_err(access_error)?;
        if path.components().any(|part| matches!(part, Component::Normal(name) if name.to_str().is_none_or(|s| !safe_name(s)))) {
            return Err(invalid("このパスは標準の除外対象です。参照資料には登録できません。"));
        }
        let value = path
            .to_str()
            .ok_or_else(|| invalid("UTF-8で表せないパスは登録できません。"))?
            .to_owned();
        let material = ReferenceMaterial {
            id: String::new(),
            path: value.clone(),
            kind: kind.clone(),
        };
        let (dir, file) = open_material(&material, "")?;
        if let Some(file) = file {
            read_text(&dir, &file)?;
        }
        Ok(value)
    };
    check().map_err(|e| e.to_string())
}

/// Returns a directory handle and optionally the one file to read inside it.
fn open_material(material: &ReferenceMaterial, relative: &str) -> Result<(Dir, Option<String>)> {
    let parts = relative_parts(relative)?;
    let root = Path::new(&material.path);
    if material.kind == MaterialKind::File {
        if !parts.is_empty() {
            return Err(invalid("単一ファイルの参照ではpathを空にしてください。"));
        }
        let name = root
            .file_name()
            .and_then(OsStr::to_str)
            .ok_or_else(|| invalid("ファイル名が不正です。"))?;
        if !text_file(name) {
            return Err(invalid(
                "ソースコード・Markdownなどの対応するテキストファイルを選んでください。",
            ));
        }
        return Ok((
            absolute_dir(
                root.parent()
                    .ok_or_else(|| invalid("保存パスが不正です。"))?,
            )?,
            Some(name.into()),
        ));
    }
    let mut dir = absolute_dir(root)?;
    for (index, part) in parts.iter().enumerate() {
        let metadata = dir.symlink_metadata(part).map_err(access_error)?;
        if metadata.is_file() && index + 1 == parts.len() {
            if !text_file(part) {
                return Err(invalid("このファイル形式は参照対象外です。"));
            }
            return Ok((dir, Some(part.clone())));
        }
        dir = dir.open_dir_nofollow(part).map_err(access_error)?;
    }
    Ok((dir, None))
}

fn read_text(dir: &Dir, name: &str) -> Result<String> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = dir.open_with(name, &options).map_err(access_error)?;
    let meta = file.metadata().map_err(access_error)?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err(invalid(
            "通常のテキストファイル（1MiB以下）だけを参照できます。",
        ));
    }
    if meta.nlink() != 1 {
        return Err(invalid(
            "ハードリンクは参照できません。独立したファイルを選んでください。",
        ));
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(access_error)?;
    if bytes.len() > MAX_FILE_BYTES as usize || bytes.contains(&0) {
        return Err(invalid("大きすぎるファイル・バイナリは参照できません。"));
    }
    String::from_utf8(bytes)
        .map_err(|_| invalid("初版ではUTF-8のテキストファイルに対応しています。"))
}

fn display_path(material: &ReferenceMaterial, relative: &str) -> String {
    if material.kind == MaterialKind::File {
        Path::new(&material.path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    } else {
        relative.replace('\\', "/")
    }
}
fn source_line(line: usize, text: &str) -> SourceLine {
    let shortened: String = text.chars().take(1000).collect();
    SourceLine {
        line,
        truncated: shortened.len() != text.len(),
        text: shortened,
    }
}

pub fn list_files(store: &Store, params: ListFiles) -> Result<FileList> {
    let material = store.material(&params.source.material_id)?;
    let (dir, file) = open_material(&material, &params.source.path)?;
    let mut entries = vec![];
    let mut truncated = false;
    if let Some(file) = file {
        read_text(&dir, &file)?;
        entries.push(FileEntry {
            path: display_path(&material, &params.source.path),
            kind: "file",
        });
    } else {
        for (index, entry) in dir.entries().map_err(access_error)?.enumerate() {
            if index >= MAX_ENTRIES {
                truncated = true;
                break;
            }
            let entry = entry.map_err(access_error)?;
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !safe_name(&name) {
                continue;
            }
            let kind = entry.file_type().map_err(access_error)?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() || (kind.is_file() && text_file(&name)) {
                entries.push(FileEntry {
                    path: joined(&params.source.path, &name),
                    kind: if kind.is_dir() { "folder" } else { "file" },
                });
            }
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    let count = entries.len();
    let end = params.offset.saturating_add(200).min(count);
    Ok(FileList {
        entries: entries.into_iter().skip(params.offset).take(200).collect(),
        next_offset: (end < count).then_some(end),
        truncated,
    })
}

pub fn read_file(store: &Store, params: ReadFile) -> Result<FileExcerpt> {
    let start = params.start_line.unwrap_or(1);
    let count = params.line_count.unwrap_or(200);
    if start == 0 || count == 0 || count > 500 {
        return Err(invalid("開始行は1以上、行数は1〜500で指定してください。"));
    }
    let material = store.material(&params.source.material_id)?;
    let (dir, file) = open_material(&material, &params.source.path)?;
    let text = read_text(
        &dir,
        &file.ok_or_else(|| invalid("ファイルを指定してください。"))?,
    )?;
    let mut lines = vec![];
    let mut bytes = 0;
    let mut next_line = None;
    for (index, text) in text.lines().enumerate().skip(start - 1) {
        let line = source_line(index + 1, text);
        if lines.len() >= count || bytes + line.text.len() > MAX_OUTPUT_BYTES {
            next_line = Some(index + 1);
            break;
        }
        bytes += line.text.len();
        lines.push(line);
    }
    Ok(FileExcerpt {
        material_id: material.id.clone(),
        path: display_path(&material, &params.source.path),
        lines,
        next_line,
    })
}

fn joined(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.into()
    } else {
        format!("{}/{name}", parent.replace('\\', "/"))
    }
}
fn search_file(dir: &Dir, name: &str, path: &str, query: &str, result: &mut SearchResult) {
    let Ok(text) = read_text(dir, name) else {
        result.skipped_files += 1;
        return;
    };
    result.read_bytes += text.len();
    if result.read_bytes > MAX_SEARCH_BYTES {
        result.truncated = true;
        return;
    }
    for (index, line) in text.lines().enumerate() {
        if !line.to_lowercase().contains(query) {
            continue;
        }
        let line = source_line(index + 1, line);
        if result.matches.len() >= 100
            || result.output_bytes + line.text.len() + path.len() > MAX_OUTPUT_BYTES
        {
            result.truncated = true;
            break;
        }
        result.output_bytes += line.text.len() + path.len();
        result.matches.push(SearchHit {
            path: path.into(),
            line,
        });
    }
}
fn search_dir(
    dir: &Dir,
    parent: &str,
    query: &str,
    depth: usize,
    result: &mut SearchResult,
) -> Result<()> {
    if depth > 32 {
        result.truncated = true;
        return Ok(());
    }
    for entry in dir.entries().map_err(access_error)? {
        result.entries += 1;
        if result.entries > MAX_ENTRIES {
            result.truncated = true;
            break;
        }
        let entry = entry.map_err(access_error)?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !safe_name(&name) {
            continue;
        }
        let kind = entry.file_type().map_err(access_error)?;
        let path = joined(parent, &name);
        if kind.is_dir() {
            match dir.open_dir_nofollow(&name) {
                Ok(child) => {
                    if search_dir(&child, &path, query, depth + 1, result).is_err() {
                        result.skipped_files += 1;
                    }
                }
                Err(_) => result.skipped_files += 1,
            }
        } else if kind.is_file() && text_file(&name) {
            search_file(dir, &name, &path, query, result);
        }
        if result.truncated {
            break;
        }
    }
    Ok(())
}
pub fn search_files(store: &Store, params: SearchFiles) -> Result<SearchResult> {
    if params.query.trim().is_empty() || params.query.len() > 2000 {
        return Err(invalid("検索語は1〜2000バイトで指定してください。"));
    }
    let material = store.material(&params.source.material_id)?;
    let (dir, file) = open_material(&material, &params.source.path)?;
    let mut result = SearchResult::default();
    let query = params.query.to_lowercase();
    if let Some(file) = file {
        search_file(
            &dir,
            &file,
            &display_path(&material, &params.source.path),
            &query,
            &mut result,
        );
    } else {
        search_dir(&dir, &params.source.path, &query, 0, &mut result)?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests;
