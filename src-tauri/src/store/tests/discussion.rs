use super::*;

fn discussion_fixture(status: CardStatus) -> (Fixture, Card, Conversation, Message) {
    let f = Fixture::new();
    let mut card = f
        .store
        .create_card("通知のタイミング".into(), "いつ通知する？".into(), "user")
        .unwrap();
    if status != card.status {
        card = f.store.update_card(Card { status, ..card }).unwrap();
    }
    let conversation = f.store.create_conversation("codex").unwrap();
    let message = f
        .store
        .append_message(&conversation.id, "user", "通知は朝に欲しい".into(), vec![])
        .unwrap();
    (f, card, conversation, message)
}
fn report(
    f: &Fixture,
    card: &Card,
    c: &Conversation,
    m: &Message,
    suggest: bool,
) -> Result<Option<Discussion>> {
    f.store.report_discussion(
        &c.id,
        &m.id,
        &card.id,
        card.revision,
        "通知の具体的な希望を話している".into(),
        suggest,
    )
}
#[test]
fn discussion_move_and_undo_persist_without_changing_content_or_approving_proposals() {
    let (f, card, c, m) = discussion_fixture(CardStatus::Idea);
    let p = f
        .store
        .propose(
            &card.id,
            card.revision,
            card.title.clone(),
            "朝に通知する".into(),
            "希望を反映".into(),
        )
        .unwrap();
    let d = report(&f, &card, &c, &m, false).unwrap().unwrap();
    assert_eq!(d.state, DiscussionState::Moved);
    assert!(d.automatic);
    assert_eq!(report(&f, &card, &c, &m, false).unwrap().unwrap().id, d.id);
    let reopened = Store::open(f.store.path()).unwrap();
    let s = reopened.snapshot().unwrap();
    assert_eq!(s.discussions.len(), 1);
    assert_eq!(s.cards[0].status, CardStatus::Discuss);
    assert_eq!(s.cards[0].body, card.body);
    assert_eq!(s.proposals[0].state, "pending");
    assert_eq!(s.proposals[0].base_revision, s.cards[0].revision);
    reopened
        .resolve_discussion(&d.id, DiscussionResolution::Undo)
        .unwrap();
    let s = reopened.snapshot().unwrap();
    assert_eq!(s.cards[0].status, card.status);
    assert_eq!(s.cards[0].position, card.position);
    assert_eq!(s.discussions[0].state, DiscussionState::Undone);
    assert!(
        reopened
            .resolve_discussion(&d.id, DiscussionResolution::Undo)
            .is_err()
    );
    // Suppression survives restart and further user turns in this conversation.
    let next = reopened
        .append_message(&c.id, "user", "朝の通知の続き".into(), vec![])
        .unwrap();
    assert!(
        reopened
            .report_discussion(
                &c.id,
                &next.id,
                &card.id,
                s.cards[0].revision,
                "続き".into(),
                false
            )
            .is_err()
    );
    reopened.resolve(&p.id, true).unwrap();
    assert_eq!(reopened.snapshot().unwrap().cards[0].body, "朝に通知する");
    let other = reopened.create_conversation("codex").unwrap();
    let next = reopened
        .append_message(&other.id, "user", "通知を検討したい".into(), vec![])
        .unwrap();
    assert!(
        reopened
            .report_discussion(
                &other.id,
                &next.id,
                &card.id,
                reopened.snapshot().unwrap().cards[0].revision,
                "新しい議論".into(),
                false
            )
            .unwrap()
            .is_some()
    );
}
#[test]
fn uncertain_and_decided_cards_require_an_explicit_ui_choice() {
    for (status, suggest) in [(CardStatus::Explore, true), (CardStatus::Decided, false)] {
        let (f, card, c, m) = discussion_fixture(status.clone());
        let d = report(&f, &card, &c, &m, suggest).unwrap().unwrap();
        assert_eq!(d.state, DiscussionState::Suggested);
        assert_eq!(f.store.snapshot().unwrap().cards[0].status, status);
        assert!(!d.automatic);
        f.store
            .resolve_discussion(&d.id, DiscussionResolution::Accept)
            .unwrap();
        assert_eq!(
            f.store.snapshot().unwrap().cards[0].status,
            CardStatus::Discuss
        );
        assert!(
            f.store
                .resolve_discussion(&d.id, DiscussionResolution::Accept)
                .is_err()
        );
        f.store
            .resolve_discussion(&d.id, DiscussionResolution::Undo)
            .unwrap();
        assert_eq!(f.store.snapshot().unwrap().cards[0].status, status);
    }
}
#[test]
fn references_alone_do_not_move_cards_and_clear_followup_can_replace_a_suggestion() {
    let (f, card, c, _) = discussion_fixture(CardStatus::Explore);
    let m = f
        .store
        .append_message(
            &c.id,
            "user",
            "比較の参考です".into(),
            vec![CardReference {
                card_id: card.id.clone(),
                title: card.title.clone(),
                revision: card.revision,
                quote: String::new(),
            }],
        )
        .unwrap();
    assert_eq!(
        f.store.snapshot().unwrap().cards[0].status,
        CardStatus::Explore
    );
    assert!(f.store.snapshot().unwrap().discussions.is_empty());
    let suggested = report(&f, &card, &c, &m, true).unwrap().unwrap();
    let next = f
        .store
        .append_message(&c.id, "user", "このカードを掘り下げたい".into(), vec![])
        .unwrap();
    let moved = report(&f, &card, &c, &next, false).unwrap().unwrap();
    assert_eq!(moved.state, DiscussionState::Moved);
    let s = f.store.snapshot().unwrap();
    assert_eq!(
        s.discussions
            .iter()
            .find(|d| d.id == suggested.id)
            .unwrap()
            .state,
        DiscussionState::Superseded
    );
    // A topic change does not revert the card.
    f.store
        .append_message(&c.id, "user", "色の話に移ろう".into(), vec![])
        .unwrap();
    assert_eq!(
        f.store.snapshot().unwrap().cards[0].status,
        CardStatus::Discuss
    );
}
#[test]
fn dismissal_and_manual_column_changes_stop_repeated_agent_moves() {
    let (f, card, c, m) = discussion_fixture(CardStatus::Idea);
    let d = report(&f, &card, &c, &m, true).unwrap().unwrap();
    f.store
        .resolve_discussion(&d.id, DiscussionResolution::Dismiss)
        .unwrap();
    assert!(report(&f, &card, &c, &m, false).is_err());
    assert!(report(&f, &card, &c, &m, true).is_err());
    let (f, card, c, m) = discussion_fixture(CardStatus::Idea);
    let d = report(&f, &card, &c, &m, false).unwrap().unwrap();
    let moved = f.store.snapshot().unwrap().cards[0].clone();
    let manual = f
        .store
        .update_card(Card {
            status: CardStatus::Explore,
            ..moved
        })
        .unwrap();
    assert!(report(&f, &manual, &c, &m, false).is_err());
    assert!(
        f.store
            .resolve_discussion(&d.id, DiscussionResolution::Undo)
            .is_err()
    );
    assert_eq!(
        f.store.snapshot().unwrap().cards[0].status,
        CardStatus::Explore
    );
}
#[test]
fn stale_actions_cannot_overwrite_later_edits_or_deleted_cards() {
    let (f, card, c, m) = discussion_fixture(CardStatus::Idea);
    let d = report(&f, &card, &c, &m, false).unwrap().unwrap();
    let moved = f.store.snapshot().unwrap().cards[0].clone();
    f.store
        .update_card(Card {
            body: "手動で編集した本文".into(),
            ..moved
        })
        .unwrap();
    assert!(
        f.store
            .resolve_discussion(&d.id, DiscussionResolution::Undo)
            .is_err()
    );
    assert_eq!(
        f.store.snapshot().unwrap().cards[0].body,
        "手動で編集した本文"
    );
    let (f, card, c, m) = discussion_fixture(CardStatus::Decided);
    let d = report(&f, &card, &c, &m, false).unwrap().unwrap();
    let edited = f
        .store
        .update_card(Card {
            body: "新しい結論".into(),
            ..card.clone()
        })
        .unwrap();
    assert!(
        f.store
            .resolve_discussion(&d.id, DiscussionResolution::Accept)
            .is_err()
    );
    assert_eq!(
        f.store.snapshot().unwrap().cards[0].status,
        CardStatus::Decided
    );
    let deleted = f
        .store
        .update_card(Card {
            deleted: true,
            ..edited
        })
        .unwrap();
    assert!(report(&f, &deleted, &c, &m, false).is_err());
}
#[test]
fn discussion_reports_validate_the_turn_and_card_revision() {
    let (f, card, c, m) = discussion_fixture(CardStatus::Idea);
    let other = f.store.create_conversation("codex").unwrap();
    assert!(report(&f, &card, &other, &m, false).is_err());
    let next = f
        .store
        .append_message(&c.id, "user", "別の発言".into(), vec![])
        .unwrap();
    assert!(report(&f, &card, &c, &m, false).is_err());
    let edited = f
        .store
        .update_card(Card {
            body: "更新済み".into(),
            ..card.clone()
        })
        .unwrap();
    assert!(report(&f, &card, &c, &next, false).is_err());
    assert!(f.store.snapshot().unwrap().discussions.is_empty());
    assert_eq!(
        report(&f, &edited, &c, &next, false)
            .unwrap()
            .unwrap()
            .state,
        DiscussionState::Moved
    );
}
