//! Read-only access to user-selected sources. The model never supplies an absolute path.
mod access;
mod policy;
mod search;

pub use access::validate_selection;
pub use search::search_files;

use crate::{
    model::{MaterialKind, ReferenceMaterial},
    store::{Result, Store, StoreError},
};
use access::{open_material, read_text};
use policy::{safe_name, text_file};
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use std::path::Path;

const MAX_ENTRIES: usize = 4000;
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
#[cfg(test)]
mod tests;
