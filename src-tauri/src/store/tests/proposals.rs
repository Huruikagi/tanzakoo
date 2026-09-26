use super::*;

#[test]
fn batch_approval_is_atomic_and_survives_reopen() {
    for conflict in [
        "none",
        "outdated",
        "archived",
        "replaced",
        "resolved",
        "missing",
        "duplicate",
    ] {
        let f = Fixture::new();
        let first = f
            .store
            .create_card("通知".into(), "元の本文".into(), "user")
            .unwrap();
        let second = f
            .store
            .create_card("表示".into(), "元の本文".into(), "user")
            .unwrap();
        let a = f
            .store
            .propose(
                &first.id,
                1,
                "通知案".into(),
                "変更後".into(),
                "理由".into(),
            )
            .unwrap();
        let b = f
            .store
            .propose(
                &second.id,
                1,
                "表示案".into(),
                "変更後".into(),
                "理由".into(),
            )
            .unwrap();
        let mut ids = vec![a.id.clone(), b.id.clone()];
        match conflict {
            "outdated" => {
                f.store
                    .update_card(Card {
                        body: "手動編集".into(),
                        ..second
                    })
                    .unwrap();
            }
            "archived" => {
                f.store
                    .update_card(Card {
                        deleted: true,
                        ..second
                    })
                    .unwrap();
            }
            "replaced" => {
                f.store
                    .propose(
                        &second.id,
                        1,
                        "最新の案".into(),
                        "新しい本文".into(),
                        "理由".into(),
                    )
                    .unwrap();
            }
            "resolved" => {
                f.store.resolve(&b.id, false).unwrap();
            }
            "missing" => {
                ids[1] = "missing".into();
            }
            "duplicate" => {
                ids[1] = a.id.clone();
            }
            _ => {}
        }
        let before = serde_json::to_value(f.store.snapshot().unwrap()).unwrap();
        let result = f.store.apply_proposals(&ids);
        let reopened = Store::open(f.store.path()).unwrap();
        let snapshot = reopened.snapshot().unwrap();
        if conflict == "none" {
            result.unwrap();
            assert!(
                snapshot
                    .cards
                    .iter()
                    .all(|c| c.body == "変更後" && c.revision == 2)
            );
            assert!(snapshot.proposals.iter().all(|p| p.state == "applied"));
        } else {
            assert!(result.is_err(), "{conflict}");
            assert_eq!(
                before,
                serde_json::to_value(snapshot).unwrap(),
                "{conflict}"
            );
        }
        assert!(reopened.apply_proposals(&[]).is_err());
    }
}
#[test]
fn proposal_requires_apply_and_survives_reopen() {
    let f = Fixture::new();
    let c = f
        .store
        .create_card("通知".into(), "毎朝".into(), "codex")
        .unwrap();
    let p = f
        .store
        .propose(
            &c.id,
            1,
            "通知".into(),
            "毎夕".into(),
            "利用時間に合わせる".into(),
        )
        .unwrap();
    assert_eq!(f.store.snapshot().unwrap().cards[0].body, "毎朝");
    Store::open(f.store.path())
        .unwrap()
        .resolve(&p.id, true)
        .unwrap();
    let s = f.store.snapshot().unwrap();
    assert_eq!(s.cards[0].body, "毎夕");
    assert_eq!(s.proposals[0].state, "applied");
    assert!(f.store.resolve(&p.id, true).is_err());
}
#[test]
fn replacing_a_proposal_preserves_the_card_and_rejects_old_ui_actions() {
    let f = Fixture::new();
    let card = f
        .store
        .create_card("通知".into(), "毎朝".into(), "user")
        .unwrap();
    let other = f
        .store
        .create_card("表示".into(), "一覧".into(), "user")
        .unwrap();
    let old = f
        .store
        .propose(&card.id, 1, "通知".into(), "毎夕".into(), "時間変更".into())
        .unwrap();
    let unrelated = f
        .store
        .propose(
            &other.id,
            1,
            "表示".into(),
            "カレンダー".into(),
            "表示変更".into(),
        )
        .unwrap();
    let latest = f
        .store
        .propose(
            &card.id,
            1,
            "平日の通知".into(),
            "平日の毎夕".into(),
            "曜日も指定".into(),
        )
        .unwrap();
    assert_ne!(old.id, latest.id);
    assert_eq!(latest.before_title, card.title);
    assert_eq!(latest.before_body, card.body);
    let reopened = Store::open(f.store.path()).unwrap();
    let s = reopened.snapshot().unwrap();
    assert_eq!(s.cards[0].body, card.body);
    assert_eq!(s.cards[0].revision, 1);
    assert_eq!(
        s.proposals
            .iter()
            .filter(|p| p.card_id == card.id && p.state == "pending")
            .count(),
        1
    );
    assert_eq!(
        s.proposals.iter().find(|p| p.id == old.id).unwrap().state,
        "superseded"
    );
    assert_eq!(
        s.proposals.iter().find(|p| p.id == old.id).unwrap().body,
        "毎夕"
    );
    assert_eq!(
        s.proposals
            .iter()
            .find(|p| p.id == unrelated.id)
            .unwrap()
            .state,
        "pending"
    );
    for apply in [true, false] {
        assert!(
            reopened
                .resolve(&old.id, apply)
                .unwrap_err()
                .to_string()
                .contains("置き換わっています")
        );
    }
    reopened.resolve(&latest.id, true).unwrap();
    let s = reopened.snapshot().unwrap();
    assert_eq!(s.cards[0].title, latest.title);
    assert_eq!(s.cards[0].body, latest.body);
    assert_eq!(s.cards[0].revision, 2);
}
#[test]
fn proposal_retries_and_invalid_replacements_preserve_the_pending_proposal() {
    let f = Fixture::new();
    let card = f
        .store
        .create_card("通知".into(), "毎朝".into(), "user")
        .unwrap();
    let old = f
        .store
        .propose(&card.id, 1, "通知".into(), "毎夕".into(), "時間変更".into())
        .unwrap();
    assert_eq!(
        f.store
            .propose(
                &card.id,
                1,
                old.title.clone(),
                old.body.clone(),
                old.reason.clone()
            )
            .unwrap()
            .id,
        old.id
    );
    assert!(
        f.store
            .propose(&card.id, 1, " ".into(), "無効".into(), "理由".into())
            .is_err()
    );
    assert!(
        f.store
            .propose(&card.id, 0, "通知".into(), "古い版".into(), "理由".into())
            .is_err()
    );
    let s = f.store.snapshot().unwrap();
    assert_eq!(s.proposals.len(), 1);
    assert_eq!(s.proposals[0].state, "pending");
    // A changed reason is also new content that the user must review.
    let revised = f
        .store
        .propose(&card.id, 1, old.title, old.body, "新しい理由".into())
        .unwrap();
    assert_ne!(revised.id, old.id);
    let edited = f
        .store
        .update_card(Card {
            body: "手動編集".into(),
            ..card
        })
        .unwrap();
    assert!(f.store.resolve(&revised.id, true).is_err());
    assert!(
        f.store
            .propose(&edited.id, 1, "通知".into(), "古い版".into(), "理由".into())
            .is_err()
    );
    let latest = f
        .store
        .propose(
            &edited.id,
            edited.revision,
            "通知".into(),
            "最新案".into(),
            "再検討".into(),
        )
        .unwrap();
    assert_eq!(latest.before_body, "手動編集");
    assert_eq!(
        f.store
            .snapshot()
            .unwrap()
            .proposals
            .iter()
            .filter(|p| p.state == "pending")
            .count(),
        1
    );
    f.store.resolve(&latest.id, false).unwrap();
    assert_eq!(f.store.snapshot().unwrap().cards[0].body, "手動編集");
}
#[test]
fn simultaneous_proposals_leave_only_one_pending() {
    let f = Fixture::new();
    let card = f
        .store
        .create_card("通知".into(), "毎朝".into(), "user")
        .unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|i| {
            let store = f.store.clone();
            let card_id = card.id.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                store
                    .propose(&card_id, 1, "通知".into(), format!("案{i}"), "変更".into())
                    .unwrap()
            })
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }
    let s = f.store.snapshot().unwrap();
    assert_eq!(s.proposals.len(), 2);
    assert_eq!(
        s.proposals.iter().filter(|p| p.state == "pending").count(),
        1
    );
    assert_eq!(
        s.proposals
            .iter()
            .filter(|p| p.state == "superseded")
            .count(),
        1
    );
    f.store
        .resolve(
            &s.proposals
                .iter()
                .find(|p| p.state == "pending")
                .unwrap()
                .id,
            true,
        )
        .unwrap();
}
#[test]
fn stale_or_deleted_card_cannot_apply() {
    let f = Fixture::new();
    let c = f
        .store
        .create_card("通知".into(), "毎朝".into(), "user")
        .unwrap();
    let p = f
        .store
        .propose(&c.id, 1, "通知".into(), "毎夕".into(), "変更".into())
        .unwrap();
    f.store.update_card(Card { deleted: true, ..c }).unwrap();
    assert!(f.store.resolve(&p.id, true).is_err());
    assert_eq!(f.store.snapshot().unwrap().proposals[0].state, "pending");
    f.store.resolve(&p.id, false).unwrap();
}
