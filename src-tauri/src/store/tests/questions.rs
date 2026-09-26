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

fn batch() -> Vec<QuestionInput> {
    vec![
        QuestionInput {
            question: "誰が使いますか？".into(),
            options: options(),
        },
        QuestionInput {
            question: "いつ使いますか？".into(),
            options: options(),
        },
    ]
}

#[test]
fn batch_answers_require_every_question_and_roll_back_on_any_invalid_answer() {
    let f = Fixture::new();
    let c = f.store.create_conversation("codex").unwrap();
    let m = f
        .store
        .append_message(&c.id, "user", "考えたい".into(), vec![])
        .unwrap();
    let questions = f.store.present_questions(&c.id, &m.id, batch()).unwrap();
    assert_eq!(
        f.store.present_questions(&c.id, &m.id, batch()).unwrap()[0].id,
        questions[0].id
    );
    let first = QuestionAnswer {
        question_id: questions[0].id.clone(),
        option_index: Some(1),
        text: None,
    };
    let second = QuestionAnswer {
        question_id: questions[1].id.clone(),
        option_index: None,
        text: Some("  朝に使う\n通知は不要  ".into()),
    };
    for invalid in [
        vec![],
        vec![first.clone()],
        vec![first.clone(), first.clone()],
        vec![
            first.clone(),
            QuestionAnswer {
                question_id: "other".into(),
                ..second.clone()
            },
        ],
        vec![
            first.clone(),
            QuestionAnswer {
                option_index: Some(0),
                ..second.clone()
            },
        ],
        vec![
            first.clone(),
            QuestionAnswer {
                text: Some("  \n".into()),
                ..second.clone()
            },
        ],
        vec![
            first.clone(),
            QuestionAnswer {
                text: Some("長".repeat(2001)),
                ..second.clone()
            },
        ],
        vec![
            first.clone(),
            QuestionAnswer {
                text: None,
                ..second.clone()
            },
        ],
    ] {
        assert!(
            f.store
                .append_message_with_answer(&c.id, "user", "改変".into(), vec![], Some(invalid))
                .is_err()
        );
        let saved = f.store.snapshot().unwrap();
        assert_eq!(saved.messages.len(), 1);
        assert!(
            saved
                .questions
                .iter()
                .all(|q| q.state == QuestionState::Pending && q.selected_option.is_none())
        );
    }
    let answers = vec![second, first]; // Canonical prompt follows question order, not client order.
    let message = f
        .store
        .append_message_with_answer(&c.id, "user", "改変".into(), vec![], Some(answers.clone()))
        .unwrap();
    assert_eq!(
        message.text,
        "「誰が使いますか？」への回答：チーム用\n共有して使う\n\n「いつ使いますか？」への回答：朝に使う\n通知は不要"
    );
    assert!(
        f.store
            .append_message_with_answer(&c.id, "user", "再送".into(), vec![], Some(answers))
            .is_err()
    );
    let saved = Store::open(f.store.path()).unwrap().snapshot().unwrap();
    assert!(
        saved
            .questions
            .iter()
            .all(|q| q.state == QuestionState::Answered)
    );
    assert_eq!(saved.questions[0].selected_option, Some(1));
    assert_eq!(
        saved.questions[1].answer_text.as_deref(),
        Some("朝に使う\n通知は不要")
    );
    assert_eq!(saved.messages.len(), 2);
}

#[test]
fn batches_are_atomic_and_normal_messages_or_cancellation_close_the_whole_batch() {
    let f = Fixture::new();
    let c = f.store.create_conversation("codex").unwrap();
    let m = f
        .store
        .append_message(&c.id, "user", "考えたい".into(), vec![])
        .unwrap();
    let mut malformed = batch();
    malformed[1].options.clear();
    for invalid in [
        vec![],
        malformed,
        vec![batch()[0].clone(); 2],
        vec![batch()[0].clone(); 5],
    ] {
        assert!(f.store.present_questions(&c.id, &m.id, invalid).is_err());
        assert!(f.store.snapshot().unwrap().questions.is_empty());
    }
    f.store.present_questions(&c.id, &m.id, batch()).unwrap();
    let next = f
        .store
        .append_message(&c.id, "user", "先に別の話をしたい".into(), vec![])
        .unwrap();
    assert!(
        f.store
            .snapshot()
            .unwrap()
            .questions
            .iter()
            .all(|q| q.state == QuestionState::Dismissed)
    );
    f.store.present_questions(&c.id, &next.id, batch()).unwrap();
    f.store.cancel_questions(&c.id, &next.id).unwrap();
    let saved = f.store.snapshot().unwrap();
    assert_eq!(saved.questions.len(), 4);
    assert!(
        saved.questions[2..]
            .iter()
            .all(|q| q.state == QuestionState::Cancelled)
    );
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
        option_index: Some(0),
        text: None,
    };
    assert!(
        f.store
            .append_message_with_answer(
                &other.id,
                "user",
                "改変".into(),
                vec![],
                Some(vec![answer.clone()])
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
                Some(vec![QuestionAnswer {
                    option_index: Some(99),
                    ..answer.clone()
                }])
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
        .append_message_with_answer(
            &c.id,
            "user",
            "改変".into(),
            vec![],
            Some(vec![answer.clone()]),
        )
        .unwrap();
    assert_eq!(
        message.text,
        "「誰が使いますか？」への回答：自分用\n一人で使う"
    );
    assert!(
        f.store
            .append_message_with_answer(&c.id, "user", "再送".into(), vec![], Some(vec![answer]))
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
