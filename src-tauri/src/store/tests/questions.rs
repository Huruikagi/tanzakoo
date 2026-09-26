use super::*;

fn options() -> Vec<QuestionOption> {
    vec![
        QuestionOption {
            label: "自分用".into(),
            description: "一人で使う".into(),
        },
        QuestionOption {
            label: "チーム用".into(),
            description: "共有して使う".into(),
        },
    ]
}

#[test]
fn questions_are_turn_bound_and_answers_are_atomic_and_persistent() {
    let f = Fixture::new();
    let c = f.store.create_conversation("codex").unwrap();
    let m = f
        .store
        .append_message(&c.id, "user", "TODOを作りたい".into(), vec![])
        .unwrap();
    let q = f
        .store
        .present_question(&c.id, &m.id, "誰が使いますか？".into(), options())
        .unwrap();
    let retry = f
        .store
        .present_question(&c.id, &m.id, q.question.clone(), options())
        .unwrap();
    assert_eq!(q.id, retry.id);
    assert!(
        f.store
            .present_question(&c.id, &m.id, "別の質問".into(), options())
            .is_err()
    );
    let other = f.store.create_conversation("codex").unwrap();
    let answer = QuestionAnswer {
        question_id: q.id.clone(),
        option_index: 0,
    };
    assert!(
        f.store
            .append_message_with_answer(
                &other.id,
                "user",
                "改変".into(),
                vec![],
                Some(answer.clone())
            )
            .is_err()
    );
    assert!(
        f.store
            .append_message_with_answer(
                &c.id,
                "user",
                "改変".into(),
                vec![],
                Some(QuestionAnswer {
                    option_index: 99,
                    ..answer.clone()
                })
            )
            .is_err()
    );
    assert_eq!(f.store.snapshot().unwrap().messages.len(), 1);
    assert_eq!(
        f.store.snapshot().unwrap().questions[0].state,
        QuestionState::Pending
    );
    let message = f
        .store
        .append_message_with_answer(&c.id, "user", "改変".into(), vec![], Some(answer.clone()))
        .unwrap();
    assert_eq!(
        message.text,
        "「誰が使いますか？」への回答：自分用\n一人で使う"
    );
    assert!(
        f.store
            .append_message_with_answer(&c.id, "user", "再送".into(), vec![], Some(answer))
            .is_err()
    );
    assert!(
        f.store
            .present_question(&c.id, &m.id, "古いターン".into(), options())
            .is_err()
    );
    let saved = Store::open(f.store.path()).unwrap().snapshot().unwrap();
    assert_eq!(saved.messages.len(), 2);
    assert_eq!(saved.questions[0].state, QuestionState::Answered);
    assert_eq!(saved.questions[0].selected_option, Some(0));
    assert!(saved.cards.is_empty());
    assert!(saved.proposals.is_empty());
}

#[test]
fn free_text_and_cancellation_close_only_the_matching_question() {
    let f = Fixture::new();
    let c = f.store.create_conversation("codex").unwrap();
    let other = f.store.create_conversation("codex").unwrap();
    for conversation in [&c, &other] {
        let m = f
            .store
            .append_message(&conversation.id, "user", "考えたい".into(), vec![])
            .unwrap();
        f.store
            .present_question(
                &conversation.id,
                &m.id,
                "誰が使いますか？".into(),
                options(),
            )
            .unwrap();
    }
    let next = f
        .store
        .append_message(&c.id, "user", "家族で使う".into(), vec![])
        .unwrap();
    let saved = f.store.snapshot().unwrap();
    assert_eq!(saved.questions[0].state, QuestionState::Dismissed);
    assert_eq!(saved.questions[1].state, QuestionState::Pending);
    f.store
        .present_question(&c.id, &next.id, "通知は？".into(), options())
        .unwrap();
    f.store.cancel_questions(&c.id, &next.id).unwrap();
    let saved = f.store.snapshot().unwrap();
    assert_eq!(saved.questions[2].state, QuestionState::Cancelled);
    assert_eq!(saved.questions[1].state, QuestionState::Pending);
}

#[test]
fn invalid_question_payloads_never_persist() {
    let f = Fixture::new();
    let c = f.store.create_conversation("codex").unwrap();
    let m = f
        .store
        .append_message(&c.id, "user", "考えたい".into(), vec![])
        .unwrap();
    for (question, choices) in [
        (" ".into(), options()),
        ("長".repeat(501), options()),
        ("質問".into(), vec![]),
        ("質問".into(), vec![options()[0].clone(); 2]),
        ("質問".into(), vec![options()[0].clone(); 5]),
    ] {
        assert!(
            f.store
                .present_question(&c.id, &m.id, question, choices)
                .is_err()
        );
    }
    assert!(f.store.snapshot().unwrap().questions.is_empty());
}
