use crate::{language::Language, model::Card};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use std::collections::HashMap;

fn card_id(url: &str) -> Option<&str> {
    let id = url.strip_prefix("tanzakoo:card/")?;
    (!id.is_empty()
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c)))
    .then_some(id)
}

/// Change only parsed card links; preserve the surrounding Markdown and code verbatim.
pub(super) fn rewrite(
    body: &str,
    cards: &[Card],
    filenames: &HashMap<&str, String>,
    in_decisions: bool,
    language: Language,
) -> String {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES;
    let mut events = Parser::new_ext(body, options).into_offset_iter();
    let mut replacements = Vec::new();
    let mut image_depth = 0;
    while let Some((event, range)) = events.next() {
        match event {
            Event::Start(Tag::Image { .. }) => {
                image_depth += 1;
                continue;
            }
            Event::End(TagEnd::Image) => {
                image_depth -= 1;
                continue;
            }
            _ if image_depth > 0 => continue,
            _ => {}
        }
        let Event::Start(Tag::Link { dest_url, .. }) = event else {
            continue;
        };
        let Some(id) = card_id(&dest_url) else {
            continue;
        };
        let mut label = String::new();
        for (event, _) in events.by_ref() {
            match event {
                Event::End(TagEnd::Link) => break,
                Event::Text(text) | Event::Code(text) => label.push_str(&text),
                Event::SoftBreak | Event::HardBreak => label.push(' '),
                _ => {}
            }
        }
        let target = cards.iter().find(|card| card.id == id);
        let title = super::markdown_text(target.map_or(label.as_str(), |card| card.title.as_str()));
        let replacement = if let Some(filename) = filenames.get(id) {
            let path = if in_decisions {
                filename.strip_prefix("decisions/").unwrap_or(filename)
            } else {
                filename
            };
            format!("[{title}]({})", super::link_path(path))
        } else {
            let note = match target {
                Some(card) if card.deleted => {
                    language.choose("アーカイブ済み・出力対象外", "archived; not exported")
                }
                Some(_) => language.choose("未決定・出力対象外", "undecided; not exported"),
                None => language.choose("参照先なし", "reference unavailable"),
            };
            format!("{title} ({note})")
        };
        replacements.push((range, replacement));
    }
    let mut output = body.to_owned();
    for (range, replacement) in replacements.into_iter().rev() {
        output.replace_range(range, &replacement);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{export::MarkdownExport, model::CardStatus, store::Store};

    fn card(id: &str, title: &str) -> Card {
        Card {
            id: id.into(),
            title: title.into(),
            body: String::new(),
            status: CardStatus::Decided,
            revision: 1,
            position: 1.0,
            source: "user".into(),
            deleted: false,
            created_at: 1.0,
            updated_at: 1.0,
        }
    }

    #[test]
    fn rewrites_only_links_and_reports_targets_outside_the_export() {
        let mut idea = card("idea", "未決定");
        idea.status = CardStatus::Idea;
        let mut archived = card("archive", "保管済み");
        archived.deleted = true;
        let cards = vec![card("saved", "最新 [設定]"), idea, archived];
        let paths = HashMap::from([("saved", "decisions/0002-通知-設定.md".into())]);
        let untouched = "`[code](tanzakoo:card/saved)`\n\n```md\n[example](tanzakoo:card/saved)\n```\n\n![image](tanzakoo:card/saved) [web](https://example.com)";
        let body = format!(
            "前 [古い名前](tanzakoo:card/saved) 後\n\n[別名][ref]\n\n[ref]: tanzakoo:card/saved\n\n[案](tanzakoo:card/idea) [保管](tanzakoo:card/archive) [不明](tanzakoo:card/missing)\n\n{untouched}"
        );
        let result = rewrite(&body, &cards, &paths, true, Language::Ja);
        let expected = "[最新 \\[設定\\]](0002-%E9%80%9A%E7%9F%A5-%E8%A8%AD%E5%AE%9A.md)";
        assert!(result.starts_with(&format!("前 {expected} 後")), "{result}");
        assert_eq!(result.matches(expected).count(), 2);
        assert!(result.contains("未決定 (未決定・出力対象外)"));
        assert!(result.contains("保管済み (アーカイブ済み・出力対象外)"));
        assert!(result.contains("不明 (参照先なし)"));
        assert!(result.ends_with(untouched));
        let english = rewrite(
            "[案](tanzakoo:card/idea)",
            &cards,
            &paths,
            false,
            Language::En,
        );
        assert_eq!(english, "未決定 (undecided; not exported)");
    }

    #[test]
    fn exported_files_link_by_id_with_duplicate_titles_cycles_and_memory() {
        let root = std::env::temp_dir().join(format!(
            "tanzakoo-links-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let store = Store::open(root.join("board.db")).unwrap();
        let mut first = store
            .create_card("通知 設定".into(), String::new(), "user")
            .unwrap();
        let mut second = store
            .create_card(first.title.clone(), "独立した設定".into(), "user")
            .unwrap();
        first.status = CardStatus::Decided;
        first.position = 1.0;
        first.body = format!("参照 [設定](tanzakoo:card/{})", second.id);
        second.status = CardStatus::Decided;
        second.position = 2.0;
        second.body = format!("戻る [通知](tanzakoo:card/{})", first.id);
        store.update_card(first.clone()).unwrap();
        store.update_card(second).unwrap();
        let project = store.snapshot().unwrap().project;
        store
            .update_project(
                project.name,
                format!("[背景](tanzakoo:card/{})", first.id),
                project.revision,
            )
            .unwrap();
        let bundle = MarkdownExport::from_snapshot(store.snapshot().unwrap()).unwrap();
        let first_body = &bundle
            .files
            .iter()
            .find(|(path, _)| path.starts_with("decisions/0001-"))
            .unwrap()
            .1;
        let second_body = &bundle
            .files
            .iter()
            .find(|(path, _)| path.starts_with("decisions/0002-"))
            .unwrap()
            .1;
        let memory = &bundle
            .files
            .iter()
            .find(|(path, _)| path == "project.md")
            .unwrap()
            .1;
        assert!(first_body.contains("](0002-%E9%80%9A%E7%9F%A5-%E8%A8%AD%E5%AE%9A.md)"));
        assert!(second_body.contains("](0001-%E9%80%9A%E7%9F%A5-%E8%A8%AD%E5%AE%9A.md)"));
        assert!(memory.contains("](decisions/0001-%E9%80%9A%E7%9F%A5-%E8%A8%AD%E5%AE%9A.md)"));
        assert!(!first_body.contains("tanzakoo:card/"));
        assert_eq!(
            store
                .snapshot()
                .unwrap()
                .cards
                .iter()
                .find(|c| c.id == first.id)
                .unwrap()
                .body,
            first.body
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
