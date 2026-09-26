use super::*;

#[test]
fn identical_retry_is_idempotent_and_empty_title_rejected() {
    let f = Fixture::new();
    let a = f
        .store
        .create_card("環境".into(), "Web?".into(), "codex")
        .unwrap();
    let b = f
        .store
        .create_card("環境".into(), "Web?".into(), "codex")
        .unwrap();
    assert_eq!(a.id, b.id);
    assert!(f.store.create_card(" ".into(), "".into(), "user").is_err());
}
