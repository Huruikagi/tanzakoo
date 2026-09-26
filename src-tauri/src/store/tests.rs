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
