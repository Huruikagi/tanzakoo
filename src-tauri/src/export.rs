use crate::language::Language;
use crate::model::{CardStatus, Snapshot};
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use ts_rs::TS;
mod card_links;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ExportResult {
    pub path: String,
    pub card_count: usize,
}

/// A frozen, saved board: no chat history, drafts, or proposed replacements.
pub struct MarkdownExport {
    project_name: String,
    card_count: usize,
    files: Vec<(String, String)>,
}

impl MarkdownExport {
    pub fn from_snapshot(snapshot: Snapshot) -> Result<Self, String> {
        Self::from_snapshot_in_language(snapshot, Language::Ja)
    }

    pub fn from_snapshot_in_language(
        snapshot: Snapshot,
        language: Language,
    ) -> Result<Self, String> {
        let mut cards: Vec<_> = snapshot
            .cards
            .iter()
            .filter(|card| !card.deleted && card.status == CardStatus::Decided)
            .collect();
        cards.sort_by(|a, b| a.position.total_cmp(&b.position).then(a.id.cmp(&b.id)));
        if cards.is_empty() {
            return Err(
                "「決めたこと」にカードがありません。決定した話題を移してから出力してください。"
                    .into(),
            );
        }
        let project = &snapshot.project;
        let filenames: std::collections::HashMap<_, _> = cards
            .iter()
            .enumerate()
            .map(|(position, card)| {
                (
                    card.id.as_str(),
                    format!(
                        "decisions/{:04}-{}.md",
                        position + 1,
                        filename_part(&card.title)
                    ),
                )
            })
            .collect();
        let project_memory = card_links::rewrite(
            &project.memory,
            &snapshot.cards,
            &filenames,
            false,
            language,
        );
        let mut index = String::from("---\nokf_version: \"0.2\"\n---\n\n");
        index.push_str(&if language == Language::En {
            format!(
                "# {} — Decisions\n\nA snapshot of decisions saved in Tanzakoo.\n\n- Project ID: {}\n- Decided topics: {}\n\n## Starting development\n\n1. Read the [project background and context](project.md).\n2. Read the decisions below.\n3. Ask for clarification before proceeding if information is missing or contradictory.\n\nTreat unspecified behavior as undecided. Undecided cards, conversation history, unsaved edits, and pending proposals are excluded. Saved content is included without summarization. Card references become Markdown links; references outside this export are annotated as text.\n\n",
                markdown_text(&project.name),
                markdown_text(&project.id),
                cards.len(),
            )
        } else {
            format!(
                "# {} — 決めたこと\n\nTanzakooに保存された決定事項のスナップショットです。\n\n- プロジェクトID: {}\n- 決定した話題: {}件\n\n## 開発を始めるとき\n\n1. [プロジェクトの背景・前提](project.md)を読む。\n2. 下記の決定事項を読む。\n3. 実装に必要な情報が足りない場合や、内容が矛盾する場合は、確認してから進める。\n\n記載のない仕様は未決定として扱ってください。未決定のカード・会話履歴・未保存の編集・未適用の変更提案は含みません。保存済みの本文を要約せず収録しています。カード参照はMarkdownリンクに変換し、出力対象外の参照先は理由を添えた文字として残しています。\n\n",
                markdown_text(&project.name),
                markdown_text(&project.id),
                cards.len(),
            )
        });
        if snapshot
            .memory_proposals
            .iter()
            .any(|p| p.state == "pending")
            || snapshot
                .proposals
                .iter()
                .any(|p| p.state == "pending" && cards.iter().any(|card| card.id == p.card_id))
        {
            index.push_str(language.choose("出力時点で、決定事項またはプロジェクトメモリに未適用の変更提案があります。この出力には適用前の内容を収録しています。\n\n", "There are pending proposals for decisions or project memory. This export contains the saved content before those proposals are applied.\n\n"));
        }
        index.push_str(language.choose("## 決定事項\n\n", "## Decisions\n\n"));
        let project_header = format!(
            "---\ntype: Tanzakoo Project\ntitle: {}\ntanzakoo:\n  project_id: {}\n  revision: {}\n---\n\n",
            yaml_string(&project.name),
            yaml_string(&project.id),
            project.revision,
        );
        let mut files = vec![(
            "project.md".into(),
            project_header
                + &format!(
                    "# {}\n\n{}\n",
                    language.choose("プロジェクトの背景・前提", "Project background and context"),
                    if project.memory.is_empty() {
                        language.choose(
                            "（プロジェクトメモリは未記入です。）",
                            "(No project memory.)",
                        )
                    } else {
                        &project_memory
                    },
                ),
        )];
        for card in &cards {
            let filename = filenames[card.id.as_str()].clone();
            let body = card_links::rewrite(&card.body, &snapshot.cards, &filenames, true, language);
            index.push_str(&format!(
                "- [{}]({})\n",
                markdown_text(&card.title),
                link_path(&filename),
            ));
            let header = format!(
                "---\ntype: Tanzakoo Decision\ntitle: {}\ntanzakoo:\n  project_id: {}\n  card_id: {}\n  revision: {}\n---\n\n",
                yaml_string(&card.title),
                yaml_string(&project.id),
                yaml_string(&card.id),
                card.revision,
            );
            files.push((
                filename,
                header
                    + &format!(
                        "# {}\n\n{}\n",
                        markdown_text(&card.title),
                        if card.body.is_empty() {
                            language.choose("（本文は未記入です。）", "(No content.)")
                        } else {
                            &body
                        },
                    ),
            ));
        }
        files.push(("index.md".into(), index));
        Ok(Self {
            project_name: project.name.clone(),
            card_count: cards.len(),
            files,
        })
    }

    /// Create a fresh directory exclusively; never merge with a previous export.
    pub fn write_to(&self, parent: &Path) -> Result<ExportResult, String> {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        self.write_named(
            parent,
            &format!("tanzakoo-{}-{stamp}", filename_part(&self.project_name)),
        )
    }

    fn write_named(&self, parent: &Path, name: &str) -> Result<ExportResult, String> {
        let display_parent = parent;
        let parent = parent.canonicalize().map_err(|e| {
            crate::system_message::detail(
                crate::system_message::Code::ExportOpen,
                &e.to_string(),
                &format!("保存先を開けません: {e}"),
            )
        })?;
        let mut suffix = 0u32;
        let directory = loop {
            let path = parent.join(if suffix == 0 {
                name.into()
            } else {
                format!("{name}-{suffix}")
            });
            match fs::create_dir(&path) {
                Ok(()) => break path,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    suffix = suffix
                        .checked_add(1)
                        .ok_or("出力先の名前を確保できません。")?;
                }
                Err(e) => {
                    return Err(crate::system_message::detail(
                        crate::system_message::Code::ExportCreate,
                        &e.to_string(),
                        &format!("出力フォルダーを作成できません: {e}"),
                    ));
                }
            }
        };
        let write = || -> std::io::Result<()> {
            fs::create_dir(directory.join("decisions"))?;
            for (name, content) in &self.files {
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(directory.join(name))?;
                file.write_all(content.as_bytes())?;
                file.sync_all()?;
            }
            Ok(())
        };
        if let Err(error) = write() {
            // Only this call's exclusively created directory can be cleaned up.
            return match fs::remove_dir_all(&directory) {
                Ok(()) => Err(crate::system_message::detail(
                    crate::system_message::Code::ExportWrite,
                    &error.to_string(),
                    &format!("Markdownの出力に失敗しました: {error}"),
                )),
                Err(_) => {
                    let path = directory.display().to_string();
                    Err(crate::system_message::partial_export(
                        &error.to_string(),
                        &path,
                        &format!(
                            "Markdownの出力に失敗しました: {error}。不完全な出力が {path} に残っています。"
                        ),
                    ))
                }
            };
        }
        Ok(ExportResult {
            path: display_parent
                .join(directory.file_name().expect("created directory name"))
                .to_string_lossy()
                .into_owned(),
            card_count: self.card_count,
        })
    }
}

// JSON quoting is also YAML double quoting. Escape additional YAML control and
// line-break characters so arbitrary saved titles remain a single scalar.
fn yaml_string(text: &str) -> String {
    let quoted = serde_json::to_string(text).expect("serializing a string cannot fail");
    let mut output = String::new();
    for c in quoted.chars() {
        if c.is_control() || matches!(c, '\u{2028}' | '\u{2029}' | '\u{fffe}' | '\u{ffff}') {
            output.push_str(&format!("\\u{:04X}", c as u32));
        } else {
            output.push(c);
        }
    }
    output
}

// A numbered/prefixed filename avoids Windows reserved names and duplicate titles.
fn filename_part(text: &str) -> String {
    let name: String = text
        .chars()
        .take(32)
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let name = name.trim_matches('-');
    if name.is_empty() {
        "untitled".into()
    } else {
        name.into()
    }
}

fn markdown_text(text: &str) -> String {
    let mut output = String::new();
    for c in text.chars() {
        if c.is_whitespace() {
            output.push(' ');
        } else {
            if c.is_ascii_punctuation() {
                output.push('\\');
            }
            output.push(c);
        }
    }
    output
}

fn link_path(path: &str) -> String {
    let mut output = String::new();
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._/".contains(&byte) {
            output.push(byte as char);
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn exports_saved_decisions_and_memory_without_proposals_or_conversations() {
        let root = std::env::temp_dir().join(format!(
            "tanzakoo-export-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let store = Store::open(root.join("board.db")).unwrap();
        store
            .update_project("家族のアプリ".into(), "# 目的\n\n家族で使う。".into(), 1)
            .unwrap();
        let mut decided = store
            .create_card(
                "通知 [毎日]/CON:*?".into(),
                "## 結論\n\n- 朝に通知\n\n```ts\nconst hour = 9;\n```".into(),
                "user",
            )
            .unwrap();
        decided.status = CardStatus::Decided;
        decided.position = 2.0;
        let decided = store.update_card(decided).unwrap();
        store
            .propose(
                &decided.id,
                decided.revision,
                "未適用の題名".into(),
                "未適用の本文".into(),
                "変更案".into(),
            )
            .unwrap();
        store
            .propose_memory(2, "未適用のメモリ".into(), "変更案".into())
            .unwrap();
        for (index, status) in [
            CardStatus::Idea,
            CardStatus::Explore,
            CardStatus::Discuss,
            CardStatus::Decided,
        ]
        .into_iter()
        .enumerate()
        {
            let mut card = store
                .create_card(format!("除外{index}"), "出力しない本文".into(), "user")
                .unwrap();
            card.deleted = status == CardStatus::Decided;
            card.status = status;
            store.update_card(card).unwrap();
        }
        let mut duplicate = store
            .create_card(decided.title.clone(), "先に決めた本文".into(), "user")
            .unwrap();
        duplicate.status = CardStatus::Decided;
        duplicate.position = 1.0;
        store.update_card(duplicate).unwrap();
        let chat = store.create_conversation("codex").unwrap();
        store
            .append_message(&chat.id, "user", "会話だけの内容".into(), vec![])
            .unwrap();
        let mut bundle = MarkdownExport::from_snapshot(store.snapshot().unwrap()).unwrap();
        let english =
            MarkdownExport::from_snapshot_in_language(store.snapshot().unwrap(), Language::En)
                .unwrap();
        let index_en = &english
            .files
            .iter()
            .find(|(name, _)| name == "index.md")
            .unwrap()
            .1;
        assert!(index_en.starts_with("---\nokf_version: \"0.2\"\n---\n\n"));
        assert!(index_en.contains("## Starting development"));
        assert!(index_en.contains("pending proposals"));
        let memory_en = &english
            .files
            .iter()
            .find(|(name, _)| name == "project.md")
            .unwrap()
            .1;
        assert!(memory_en.starts_with("---\ntype: Tanzakoo Project\n"));
        assert!(memory_en.contains("# Project background and context"));
        assert!(memory_en.contains("# 目的\n\n家族で使う。"));
        assert!(
            english
                .files
                .iter()
                .any(|(_, content)| content.ends_with(&format!(
                    "---\n\n# {}\n\n{}\n",
                    markdown_text(&decided.title),
                    decided.body
                )))
        );
        // Every concept has metadata; only the bundle root declares the version.
        // Machine-readable fields are independent of the selected display language.
        for (name, content) in &bundle.files {
            let (header, _) = content
                .strip_prefix("---\n")
                .unwrap()
                .split_once("\n---\n")
                .unwrap();
            let english_content = &english
                .files
                .iter()
                .find(|(path, _)| path == name)
                .unwrap()
                .1;
            assert!(english_content.starts_with(&format!("---\n{header}\n---\n")));
            if name == "index.md" {
                assert_eq!(header, "okf_version: \"0.2\"");
                continue;
            }
            assert!(header.starts_with("type: Tanzakoo "));
            assert!(header.contains("\ntitle: \""));
            assert!(header.contains("\ntanzakoo:\n  project_id: \""));
            assert!(!header.contains("okf_version:"));
            assert!(!header.contains("verified:"));
            assert!(!header.contains("generated:"));
            assert!(!header.contains("sources:"));
        }
        store
            .update_project("新しい名前".into(), "出力開始後のメモリ".into(), 2)
            .unwrap();
        let first = bundle.write_named(&root, "export").unwrap();
        let second = bundle.write_named(&root, "export").unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(first.card_count, 2);
        let dir = Path::new(&first.path);
        let index = fs::read_to_string(dir.join("index.md")).unwrap();
        assert!(index.contains("未適用の変更提案"));
        assert!(index.contains("%E9%80%9A%E7%9F%A5"));
        let mut decisions: Vec<_> = fs::read_dir(dir.join("decisions"))
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        decisions.sort();
        assert_eq!(decisions.len(), 2);
        assert_eq!(decisions[0].file_name().unwrap(), "0001-通知--毎日--CON.md");
        assert_eq!(decisions[1].file_name().unwrap(), "0002-通知--毎日--CON.md");
        for path in &decisions {
            let relative = format!("decisions/{}", path.file_name().unwrap().to_str().unwrap());
            assert!(index.contains(&format!("]({})", link_path(&relative))));
        }
        assert!(
            fs::read_to_string(&decisions[0])
                .unwrap()
                .contains("先に決めた本文")
        );
        let content = fs::read_to_string(&decisions[1]).unwrap();
        assert!(content.ends_with(&format!("{}\n", decided.body)));
        assert!(content.contains(&format!(
            "  card_id: \"{}\"\n  revision: {}\n",
            decided.id, decided.revision
        )));
        let memory = fs::read_to_string(dir.join("project.md")).unwrap();
        assert!(memory.ends_with("# 目的\n\n家族で使う。\n"));
        assert!(memory.contains("  revision: 2\n"));
        let all = format!("{index}{content}{memory}");
        for omitted in [
            "未適用の題名",
            "未適用の本文",
            "未適用のメモリ",
            "出力しない本文",
            "会話だけの内容",
        ] {
            assert!(!all.contains(omitted));
        }
        assert_eq!(store.snapshot().unwrap().cards.len(), 6);
        let missing_parent = bundle.write_to(&root.join("missing-parent")).unwrap_err();
        assert!(missing_parent.contains("\"code\":\"export_open\""));
        let open_error = bundle.write_to(&root.join("board.db")).unwrap_err();
        assert!(open_error.contains("\"code\":\"export_create\""));
        // A write failure after earlier files were saved removes only the partial export.
        bundle
            .files
            .push(("missing/file.md".into(), "失敗させる".into()));
        let write_error = bundle.write_named(&root, "partial").unwrap_err();
        assert!(write_error.contains("\"code\":\"export_write\""));
        assert!(!root.join("partial").exists());
        assert!(dir.join("index.md").is_file());
        assert!(Path::new(&second.path).join("index.md").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn metadata_strings_cannot_escape_their_yaml_scalar() {
        for text in [
            "通知: 毎朝 #1 [家族]",
            "true",
            "2026-09-27",
            "引用\"と\\パス\r\n---\nverified: true\n---",
            "\0\t\u{7f}\u{85}\u{9f}\u{2028}\u{2029}\u{fffe}\u{ffff}😀",
        ] {
            let quoted = yaml_string(text);
            assert_eq!(serde_json::from_str::<String>(&quoted).unwrap(), text);
            assert!(!quoted.chars().any(char::is_control));
            assert!(!quoted.contains(['\u{2028}', '\u{2029}']));
            assert!(quoted.starts_with('"') && quoted.ends_with('"'));
        }
    }

    #[test]
    fn empty_board_and_unsafe_titles() {
        assert_eq!(filename_part("../../CON<>:\"/\\|?*\n"), "CON");
        assert_eq!(filename_part("..."), "untitled");
        assert_eq!(filename_part(&"あ".repeat(200)).chars().count(), 32);
        assert_eq!(
            markdown_text("[題名](x)\n<img>"),
            "\\[題名\\]\\(x\\) \\<img\\>"
        );
        let root =
            std::env::temp_dir().join(format!("tanzakoo-export-empty-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let store = Store::open(root.join("board.db")).unwrap();
        assert!(MarkdownExport::from_snapshot(store.snapshot().unwrap()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
