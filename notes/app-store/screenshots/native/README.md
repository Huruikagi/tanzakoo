# Mac実機の撮影原本

2026-10-01に受領した撮り直し版を保存する。日本語・英語のボード、変更提案、Markdownエクスポート確認の計6枚に、日本語変更提案の再撮影1枚を追加した。採用候補は下表の6枚。画像の加工・再圧縮は行わず、撮影時のファイル名と [manifest.json](20261001-011811-zgitbmen/manifest.json) と [再撮影のmanifest.json](20261001-012748-5oarn_x8/manifest.json) を保持している。ZIPの `__MACOSX` メタデータは含めない。

## 撮影環境と検証

- 撮影日時: 2026-10-01 01:18〜01:21 JST、日本語変更提案の再撮影は01:28 JST（manifestはUTC）。
- 環境: macOS 26.6.1 / arm64、クローン先から起動したネイティブアプリ。
- 撮影開始時のチェックアウト: `6c929b76907a017acc8bfcfdfdad49a22145954f`、未コミット変更なし。実行ファイルのビルド元を保証する情報ではない。
- 保存した7枚すべてJPEG / RGB / 2560×1600、アルファなし。画像をデコードし、寸法とSHA-256がmanifestと一致することを確認した。
- 保存した7枚を目視確認。日英のUI・カード本文、変更提案のChatGPT表示、エクスポート確認画面を確認した。個人のパス・アクセスコード・通知・エラー表示の写り込みは見当たらない。

## 画像一覧と確認結果

| 画面 | 日本語 | 英語 |
| --- | --- | --- |
| ボードとカード詳細 | [ja-01-board-local.jpg](20261001-011811-zgitbmen/ja-01-board-local.jpg): 4列・7枚と詳細を確認 | [en-01-board-local.jpg](20261001-011811-zgitbmen/en-01-board-local.jpg): 4列・7枚と詳細を確認 |
| 変更提案と会話 | [ja-02-proposal-local.jpg](20261001-012748-5oarn_x8/ja-02-proposal-local.jpg): 再撮影版。差分・却下・適用するを確認 | [en-02-proposal-local.jpg](20261001-011811-zgitbmen/en-02-proposal-local.jpg): 差分・Reject・Applyを確認 |
| Markdownエクスポート | [ja-03-export-local.jpg](20261001-011811-zgitbmen/ja-03-export-local.jpg): 出力内容と実行ボタンを確認 | [en-03-export-local.jpg](20261001-011811-zgitbmen/en-03-export-local.jpg): 出力内容と実行ボタンを確認 |

日本語変更提案は、01:28の再撮影版を採用候補とする。差分・「却下」・「適用する」が全て収まり、ChatGPTの会話も見えることを確認した。寸法・SHA-256・ZIP原本との一致も確認済み。再撮影時の実行ファイルSHA-256・PID・撮影開始時コミットは最初の6枚と同じ。見切れのある旧画像は撮影履歴として元フォルダに残し、提出候補には含めない。

## 提出前に残る確認

これらはローカル起動版の撮影原本で、最終提出ビルドとの一致は未確認。manifestの `version` / `build` は未指定、`submissionBuildMatch` は `not-verified` のまま。掲載資料のbuild 2と同じ画面であるとは扱わない。

manifestは撮影時の証跡として変更しない。そこに残る `contentReview: pending` / `captured-awaiting-visual-review` に対する受領後の目視確認結果は、このREADMEに記録する。画像の見切れについての再撮影は完了。最終提出ビルドとの一致確認後に、上表で選定した6枚の提出可否を確定する。
