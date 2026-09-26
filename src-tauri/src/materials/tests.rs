use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture {
    dir: PathBuf,
    store: Store,
    id: String,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "tanzakoo-material-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(dir.join("source/src")).unwrap();
        std::fs::write(
            dir.join("source/README.md"),
            "# Product\nこんにちは\nSettings are hard\n",
        )
        .unwrap();
        std::fs::write(dir.join("source/src/app.ts"), "const settings = true;\n").unwrap();
        let store = Store::open(dir.join("board.db")).unwrap();
        store
            .add_materials(&[dir.join("source")], MaterialKind::Folder)
            .unwrap();
        let id = store.materials().unwrap()[0].id.clone();
        Self { dir, store, id }
    }
    fn path(&self, path: &str) -> MaterialPath {
        MaterialPath {
            material_id: self.id.clone(),
            path: path.into(),
        }
    }
    fn read(&self, path: &str) -> Result<FileExcerpt> {
        read_file(
            &self.store,
            ReadFile {
                source: self.path(path),
                start_line: None,
                line_count: None,
            },
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn persists_scoped_grants_reads_latest_and_revokes_without_deleting_source() {
    let f = Fixture::new();
    let reopened = Store::open(f.store.path()).unwrap();
    assert_eq!(reopened.snapshot().unwrap().materials[0].id, f.id);
    assert_eq!(f.read("README.md").unwrap().lines[1].text, "こんにちは");
    std::fs::write(f.dir.join("source/README.md"), "updated\n").unwrap();
    assert_eq!(f.read("README.md").unwrap().lines[0].text, "updated");
    f.store
        .add_materials(&[f.dir.join("source")], MaterialKind::Folder)
        .unwrap();
    assert_eq!(f.store.materials().unwrap().len(), 1);
    let other = Store::open(f.dir.join("other.db")).unwrap();
    assert!(other.material(&f.id).is_err());
    f.store.remove_material(&f.id).unwrap();
    assert!(f.read("README.md").is_err());
    assert!(reopened.materials().unwrap().is_empty());
    assert!(f.dir.join("source/README.md").exists());
}

#[test]
fn file_grants_do_not_allow_siblings_or_descendants_and_add_is_atomic() {
    let f = Fixture::new();
    f.store
        .add_materials(&[f.dir.join("source/README.md")], MaterialKind::File)
        .unwrap();
    let id = f.store.materials().unwrap()[1].id.clone();
    let params = |path: &str| ReadFile {
        source: MaterialPath {
            material_id: id.clone(),
            path: path.into(),
        },
        start_line: None,
        line_count: None,
    };
    assert_eq!(read_file(&f.store, params("")).unwrap().path, "README.md");
    assert!(read_file(&f.store, params("src/app.ts")).is_err());
    std::fs::write(f.dir.join("source/.env"), "TOKEN=secret").unwrap();
    assert!(
        f.store
            .add_materials(
                &[f.dir.join("source/src/app.ts"), f.dir.join("source/.env")],
                MaterialKind::File
            )
            .is_err()
    );
    assert_eq!(f.store.materials().unwrap().len(), 2);
}

#[test]
fn traversal_absolute_paths_secrets_binary_and_oversize_are_rejected() {
    let f = Fixture::new();
    for path in [
        "../README.md",
        "src/../../board.db",
        "/etc/passwd",
        "C:\\secret.txt",
        "\\\\server\\file",
        "README.md:secret",
        "src/./app.ts",
        "src//app.ts",
        ".env",
        ".env.local",
        ".git/config",
        "node_modules/a.js",
        "dist/a.js",
        "src/key.pem",
    ] {
        assert!(f.read(path).is_err(), "{path}");
    }
    for dir in [".git", "node_modules", "dist", "target"] {
        std::fs::create_dir(f.dir.join("source").join(dir)).unwrap();
        std::fs::write(f.dir.join("source").join(dir).join("secret.md"), "secret").unwrap();
    }
    std::fs::write(f.dir.join("source/.env.local"), "secret").unwrap();
    std::fs::write(f.dir.join("source/binary.md"), [0, 1, 2]).unwrap();
    std::fs::write(f.dir.join("source/legacy.md"), [0xff, 0xfe]).unwrap();
    std::fs::write(
        f.dir.join("source/large.md"),
        vec![b'a'; MAX_FILE_BYTES as usize + 1],
    )
    .unwrap();
    for name in ["binary.md", "legacy.md", "large.md"] {
        assert!(f.read(name).is_err());
    }
    let result = search_files(
        &f.store,
        SearchFiles {
            source: f.path(""),
            query: "secret".into(),
        },
    )
    .unwrap();
    assert!(result.matches.is_empty());
    assert_eq!(result.skipped_files, 3);
    let listed = list_files(
        &f.store,
        ListFiles {
            source: f.path(""),
            offset: 0,
        },
    )
    .unwrap();
    assert!(!listed.entries.iter().any(|entry| excluded(&entry.path)));
}

#[test]
fn searches_nested_sources_with_line_citations_and_reads_pages() {
    let f = Fixture::new();
    let result = search_files(
        &f.store,
        SearchFiles {
            source: f.path(""),
            query: "SETTINGS".into(),
        },
    )
    .unwrap();
    assert_eq!(result.matches.len(), 2);
    assert!(
        result
            .matches
            .iter()
            .any(|hit| hit.path == "src/app.ts" && hit.line.line == 1)
    );
    assert!(
        result
            .matches
            .iter()
            .any(|hit| hit.path == "README.md" && hit.line.line == 3)
    );
    let excerpt = read_file(
        &f.store,
        ReadFile {
            source: f.path("README.md"),
            start_line: Some(2),
            line_count: Some(1),
        },
    )
    .unwrap();
    assert_eq!(excerpt.lines[0].text, "こんにちは");
    assert_eq!(excerpt.lines[0].line, 2);
    assert_eq!(excerpt.next_line, Some(3));
    assert!(!result.truncated);
}

#[test]
fn hardlinks_cannot_alias_unregistered_or_excluded_files() {
    let f = Fixture::new();
    std::fs::write(f.dir.join("outside.md"), "private").unwrap();
    std::fs::hard_link(f.dir.join("outside.md"), f.dir.join("source/alias.md")).unwrap();
    assert!(f.read("alias.md").is_err());
    assert!(
        f.store
            .add_materials(&[f.dir.join("source/alias.md")], MaterialKind::File)
            .is_err()
    );
}

#[test]
fn output_and_work_are_bounded() {
    let f = Fixture::new();
    std::fs::write(f.dir.join("source/README.md"), "match\n".repeat(600)).unwrap();
    let result = search_files(
        &f.store,
        SearchFiles {
            source: f.path("README.md"),
            query: "match".into(),
        },
    )
    .unwrap();
    assert_eq!(result.matches.len(), 100);
    assert!(result.truncated);
    let excerpt = f.read("README.md").unwrap();
    assert_eq!(excerpt.lines.len(), 200);
    assert_eq!(excerpt.next_line, Some(201));
    std::fs::write(f.dir.join("source/README.md"), "あ".repeat(2000)).unwrap();
    assert!(f.read("README.md").unwrap().lines[0].truncated);
    for index in 0..205 {
        std::fs::write(f.dir.join("source/src").join(format!("{index}.md")), "").unwrap();
    }
    let first = list_files(
        &f.store,
        ListFiles {
            source: f.path("src"),
            offset: 0,
        },
    )
    .unwrap();
    let second = list_files(
        &f.store,
        ListFiles {
            source: f.path("src"),
            offset: first.next_offset.unwrap(),
        },
    )
    .unwrap();
    assert_eq!(first.entries.len(), 200);
    assert_eq!(second.entries.len(), 6);
    assert!(second.next_offset.is_none());
}

#[cfg(unix)]
#[test]
fn symlinks_and_replaced_roots_cannot_escape_or_bypass_exclusions() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    std::fs::write(f.dir.join("outside.md"), "private").unwrap();
    std::fs::write(f.dir.join("source/.env"), "secret").unwrap();
    symlink(f.dir.join("outside.md"), f.dir.join("source/link.md")).unwrap();
    symlink(".env", f.dir.join("source/alias.md")).unwrap();
    symlink(&f.dir, f.dir.join("source/escape")).unwrap();
    assert!(f.read("link.md").is_err());
    assert!(f.read("alias.md").is_err());
    assert!(f.read("escape/outside.md").is_err());
    let list = list_files(
        &f.store,
        ListFiles {
            source: f.path(""),
            offset: 0,
        },
    )
    .unwrap();
    assert!(
        !list
            .entries
            .iter()
            .any(|entry| entry.path == "link.md" || entry.path == "escape")
    );
    std::fs::rename(f.dir.join("source"), f.dir.join("original")).unwrap();
    symlink(&f.dir, f.dir.join("source")).unwrap();
    assert!(f.read("outside.md").is_err());
}

#[cfg(windows)]
#[test]
fn junctions_and_replaced_roots_are_not_followed() {
    let f = Fixture::new();
    std::fs::write(f.dir.join("outside.md"), "private").unwrap();
    let junction = |link: &Path, target: &Path| {
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:TANZAKOO_TEST_LINK -Target $env:TANZAKOO_TEST_TARGET | Out-Null"])
            .env("TANZAKOO_TEST_LINK", link).env("TANZAKOO_TEST_TARGET", target).output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    let link = f.dir.join("source/escape");
    junction(&link, &f.dir);
    assert!(f.read("escape/outside.md").is_err());
    // Remove the link itself before fixture cleanup; never recursively follow it.
    std::fs::remove_dir(&link).unwrap();
    std::fs::rename(f.dir.join("source"), f.dir.join("original")).unwrap();
    junction(&f.dir.join("source"), &f.dir);
    assert!(f.read("outside.md").is_err());
    std::fs::remove_dir(f.dir.join("source")).unwrap();
}
