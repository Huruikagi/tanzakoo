# 外部ACP CLI対応版のWindows配布検証

2026-10-11。外部CLIの任意接続を追加した版を、並行作業から分離した`feat/external-acp-connections` worktreeで検証した。これは検証専用identityの未署名パッケージであり、提出用ではない。

同日後続のCursor除外はこのパッケージには含まれない。現行ソースを配布するときは再ビルド・再パッケージが必要。

## 作成元と成果物

- ソースコミット: `5811dde2d77899611b9cbad1077ceffac6e5e1b8`。
- クリーンなコミットから`pnpm tauri build --no-bundle --config src-tauri/tauri.runtime.conf.json -- --locked`でWindows x64 releaseをビルドした。パッケージ作成時も変更なし。
- `python scripts/package-windows-store.py --validation-only --package-version 1.0.0.0 --output .local/external-msix-20261011-final`で作成した。
- 出力: `.local/external-msix-20261011-final/Tanzakoo-1.0.0.0-x64-VALIDATION-ONLY.msix`（205,937,750 bytes）。
- MSIX SHA-256: `33fcfb4a1d5e86c2313d63d99b6c1780b6b21188caea68771875737102a4b870`。
- payloadの`tanzakoo.exe` SHA-256: `0560082b02832b38cd5b6ddb15dc90b086b6d5795dc1e29e940d7ac540e4b43a`。
- identity: `Tanzakoo.LocalPackagingValidation`、publisher: `CN=Tanzakoo Local Packaging Validation`。正式なStore identityではない。
- 同梱ランタイム: Node 24.21.0、Codex ACP 1.13.1、Codex 0.156.1。外部CLIは同梱していない。
- MakeAppxとパッケージ内payloadのSHA-256照合に成功した。出力先に`makeappx.log`、`provenance.json`、MSIXのSHA-256ファイルを保存した。`checkoutAtPackaging`は作成時の記録で、単独ではビルド元を証明しない。上記は同一ターンで実施したビルドと照合の記録である。

## 検証範囲

- `pnpm check`: フロントエンド140テスト・lint・整形・TypeScript・Viteビルドが成功。
- `cargo test --locked`: 127成功、実Claude接続1件ignored。Clippyも成功。
- `scripts/test_windows_store.py`: 6成功。
- [外部CLIの実GUI検証](../external-acp-connections.md)でDevin/Copilotの候補作成・提案承認・会話再開、Devinの停止と部分応答保存、Copilotの選択質問を確認した。
- 最終パッケージの展開payloadを`.local/external-gui`の合成データで起動。保存済みの2枚と適用後の本文が復元された。修正前にMCPへ接続できなかったCopilot会話も再開でき、`tanzakoo-get_board`の都度許可後に「There are 2 cards.」と応答した。これはMSIXをインストールした状態での検証ではない。

## 残る作業

- このパッケージは未署名・未インストール。インストール済みMSIXとしての外部CLI起動は未確認で、展開payloadの動作とは区別する。
- インストール検証には、検証用コピーへの署名とWindowsへの証明書信頼登録が必要。今回、証明書の作成・信頼登録やOSのセキュリティ設定変更は行っていない。
- 署名・インストール後の実CLI接続、WACK、正式identityでの提出用パッケージ作成、Partner Centerの受領検証・審査が残る。今回の成功はMicrosoft Storeの審査通過を示さない。
- プライバシーポリシー案の外部CLIに関する変更は公開サイトへ未反映。
