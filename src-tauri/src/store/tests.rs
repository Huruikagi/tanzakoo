mod cards;
mod discussion;
mod project;
mod proposals;
mod questions;

use super::*;
struct Fixture {
    store: Store,
    dir: PathBuf,
}
static NEXT_FIXTURE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "tanzakoo-test-{}-{}-{}",
            std::process::id(),
            now(),
            NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Self {
            store: Store::open(dir.join("board.db")).unwrap(),
            dir,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn reference_bookmarks_are_private_and_removed_with_the_material() {
    let fixture = Fixture::new();
    let material = ReferenceMaterial {
        id: "fixture".into(),
        path: "/fixture.md".into(),
        kind: MaterialKind::File,
    };
    let db = fixture.store.connect().unwrap();
    put(&db, "material", &material.id, &material).unwrap();
    put(
        &db,
        "material_access",
        &material.id,
        &serde_json::json!({"private": "bookmark-secret"}),
    )
    .unwrap();
    let snapshot = serde_json::to_string(&fixture.store.snapshot().unwrap()).unwrap();
    assert!(!snapshot.contains("bookmark-secret"));
    assert!(!snapshot.contains("material_access"));
    fixture.store.remove_material(&material.id).unwrap();
    let remaining: i64 = db
        .query_row(
            "SELECT count(*) FROM records WHERE id=?1 AND kind IN ('material', 'material_access')",
            [&material.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(remaining, 0);
}
