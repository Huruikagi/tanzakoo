//! Capability-relative access to registered sources without following links.
use super::{
    access_error, invalid,
    policy::{relative_parts, safe_name, text_file},
};
use crate::{
    model::{MaterialKind, ReferenceMaterial},
    store::Result,
};
use cap_fs_ext::{DirExt, FollowSymlinks, MetadataExt, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, File, OpenOptions};
use std::{
    ffi::OsStr,
    io::Read,
    path::{Component, Path},
};

pub(super) const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// Open canonical absolute paths component by component. Replacing a parent with a
/// symlink/junction after registration must not grant access to the replacement target.
fn absolute_dir(path: &Path) -> Result<Dir> {
    #[cfg(target_os = "macos")]
    {
        // Opening ancestors requests more access than a Powerbox selection grants.
        // Darwin checks every component atomically without following any symlink.
        open_absolute(path, true).map(|file| Dir::from_std_file(file.into_std()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        use cap_std::ambient_authority;
        use std::path::PathBuf;
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
}

#[cfg(target_os = "macos")]
fn open_absolute(path: &Path, directory: bool) -> Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(invalid("参照資料の保存パスが不正です。"));
    }
    let flags =
        libc::O_NOFOLLOW_ANY | libc::O_NONBLOCK | if directory { libc::O_DIRECTORY } else { 0 };
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(flags)
        .open(path)
        .map(File::from_std)
        .map_err(access_error)
}

pub(super) enum Opened {
    Directory(Dir),
    File(File),
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
        if let Opened::File(file) = open_material(&material, "")? {
            read_open_file(file)?;
        }
        Ok(value)
    };
    check().map_err(|e| e.to_string())
}

/// Open exactly the selected root, then traverse only relative to that capability.
pub(super) fn open_material(material: &ReferenceMaterial, relative: &str) -> Result<Opened> {
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
        #[cfg(target_os = "macos")]
        let file = open_absolute(root, false)?;
        #[cfg(not(target_os = "macos"))]
        let file = open_file(
            &absolute_dir(
                root.parent()
                    .ok_or_else(|| invalid("保存パスが不正です。"))?,
            )?,
            name,
        )?;
        return Ok(Opened::File(file));
    }
    let mut dir = absolute_dir(root)?;
    for (index, part) in parts.iter().enumerate() {
        let metadata = dir.symlink_metadata(part).map_err(access_error)?;
        if metadata.is_file() && index + 1 == parts.len() {
            if !text_file(part) {
                return Err(invalid("このファイル形式は参照対象外です。"));
            }
            return open_file(&dir, part).map(Opened::File);
        }
        dir = dir.open_dir_nofollow(part).map_err(access_error)?;
    }
    Ok(Opened::Directory(dir))
}

fn open_file(dir: &Dir, name: &str) -> Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    dir.open_with(name, &options).map_err(access_error)
}

pub(super) fn read_text(dir: &Dir, name: &str) -> Result<String> {
    read_open_file(open_file(dir, name)?)
}

pub(super) fn read_open_file(file: File) -> Result<String> {
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
