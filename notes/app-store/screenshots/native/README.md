# Mac実機の撮影原本

2026-10-01に受領した撮り直し版を保存する。日本語・英語のボード、変更提案、Markdownエクスポート確認の計6枚。画像の加工・再圧縮は行わず、撮影時のファイル名と [manifest.json](20261001-011811-zgitbmen/manifest.json) を保持している。ZIPの `__MACOSX` メタデータは含めない。

## 撮影環境と検証

- 撮影日時: 2026-10-01 01:18〜01:21 JST（manifestはUTC）。
- 環境: macOS 26.6.1 / arm64、クローン先から起動したネイティブアプリ。
- 撮影開始時のチェックアウト: `6c929b76907a017acc8bfcfdfdad49a22145954f`、未コミット変更なし。実行ファイルのビルド元を保証する情報ではない。
- 6枚すべてJPEG / RGB / 2560×1600、アルファなし。画像をデコードし、寸法とSHA-256がmanifestと一致することを確認した。
- 6枚を目視確認。日英のUI・カード本文、変更提案のChatGPT表示、エクスポート確認画面を確認した。個人のパス・アクセスコード・通知・エラー表示の写り込みは見当たらない。

## 画像一覧と確認結果

| 画面 | 日本語 | 英語 |
| --- | --- | --- |
| ボードとカード詳細 | [ja-01-board-local.jpg](20261001-011811-zgitbmen/ja-01-board-local.jpg): 4列・7枚と詳細を確認 | [en-01-board-local.jpg](20261001-011811-zgitbmen/en-01-board-local.jpg): 4列・7枚と詳細を確認 |
| 変更提案と会話 | [ja-02-proposal-local.jpg](20261001-011811-zgitbmen/ja-02-proposal-local.jpg): 差分を確認。下端の適用ボタンが見切れるため再撮影候補 | [en-02-proposal-local.jpg](20261001-011811-zgitbmen/en-02-proposal-local.jpg): 差分・Reject・Applyを確認 |
| Markdownエクスポート | [ja-03-export-local.jpg](20261001-011811-zgitbmen/ja-03-export-local.jpg): 出力内容と実行ボタンを確認 | [en-03-export-local.jpg](20261001-011811-zgitbmen/en-03-export-local.jpg): 出力内容と実行ボタンを確認 |

日本語の変更提案は、中央のカード詳細を少し下へスクロールし、「適用する」が完全に見える状態で撮り直す。提案の適用は不要。再撮影画像も新しい撮影フォルダとmanifestを一緒に保存し、元画像の上書きや別のmanifestへの混在を避ける。

```sh
python3 scripts/capture-macos-store.py --running --languages ja --scenes proposal
```

## 提出前に残る確認

これらはローカル起動版の撮影原本で、最終提出ビルドとの一致は未確認。manifestの `version` / `build` は未指定、`submissionBuildMatch` は `not-verified` のまま。掲載資料のbuild 2と同じ画面であるとは扱わない。

manifestは撮影時の証跡として変更しない。そこに残る `contentReview: pending` / `captured-awaiting-visual-review` に対する受領後の目視確認結果は、このREADMEに記録する。日本語変更提案の再撮影と最終提出ビルドとの一致確認後に、提出する6枚を確定する。
