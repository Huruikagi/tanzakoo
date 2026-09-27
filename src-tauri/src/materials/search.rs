//! Bounded traversal and literal text search through the shared access layer.
use super::{
    MAX_ENTRIES, MAX_OUTPUT_BYTES, SearchFiles, SearchHit, SearchResult,
    access::{Opened, open_material, read_open_file, read_text},
    access_error, display_path, invalid, joined,
    policy::{safe_name, text_file},
    source_line,
};
use crate::store::{Result, Store};
use cap_fs_ext::DirExt;
use cap_std::fs::Dir;

const MAX_SEARCH_BYTES: usize = 16 * 1024 * 1024;
fn search_file(dir: &Dir, name: &str, path: &str, query: &str, result: &mut SearchResult) {
    search_text(read_text(dir, name), path, query, result);
}
fn search_text(text: Result<String>, path: &str, query: &str, result: &mut SearchResult) {
    let Ok(text) = text else {
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
    let _scope = super::scope::acquire(store, &material)?;
    let opened = open_material(&material, &params.source.path)?;
    let mut result = SearchResult::default();
    let query = params.query.to_lowercase();
    if let Opened::File(file) = opened {
        search_text(
            read_open_file(file),
            &display_path(&material, &params.source.path),
            &query,
            &mut result,
        );
    } else if let Opened::Directory(dir) = opened {
        search_dir(&dir, &params.source.path, &query, 0, &mut result)?;
    }
    Ok(result)
}
