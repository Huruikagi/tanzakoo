use super::*;

#[test]
fn memory_changes_require_approval_and_reject_stale_proposals() {
    let f = Fixture::new();
    f.store
        .update_project("アプリA".into(), "個人用".into(), 1)
        .unwrap();
    let p = f
        .store
        .propose_memory(2, "個人用。通知なし".into(), "前提を追加".into())
        .unwrap();
    assert_eq!(f.store.project().unwrap().memory, "個人用");
    assert_eq!(
        f.store
            .propose_memory(2, p.memory.clone(), "再試行".into())
            .unwrap()
            .id,
        p.id
    );
    let reopened = Store::open(f.store.path()).unwrap();
    reopened.resolve_memory(&p.id, true).unwrap();
    assert_eq!(reopened.project().unwrap().memory, "個人用。通知なし");
    assert_eq!(reopened.project().unwrap().revision, 3);
    assert!(reopened.resolve_memory(&p.id, true).is_err());
    let stale = reopened
        .propose_memory(3, "共有用".into(), "用途変更".into())
        .unwrap();
    reopened
        .update_project("新しい名前".into(), "個人用。通知なし".into(), 3)
        .unwrap();
    assert!(reopened.resolve_memory(&stale.id, true).is_err());
    reopened.resolve_memory(&stale.id, false).unwrap();
    assert_eq!(reopened.project().unwrap().memory, "個人用。通知なし");
    assert!(
        reopened
            .update_project("旧データ".into(), "".into(), 1)
            .is_err()
    );
    assert!(reopened.snapshot().unwrap().cards.is_empty());
}
