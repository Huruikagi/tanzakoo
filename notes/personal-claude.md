# 個人用ビルドでログイン済みClaude CLIを使う

2026-10-14の依頼により、自分で使用するビルドに限って追加した接続。公開版のClaude API接続とは別の `claude-personal` として保存する。通常ビルドでは無効で、環境変数や保存済み設定だけでは有効にならない。

## 起動

```powershell
mise.exe exec -- pnpm dev:personal
```

個人用リリースビルドは、通常のランタイム準備後に `mise.exe exec -- pnpm build:personal` を使う。`Tanzakoo Personal` のアプリ名と専用identifierを使うため、既定のアプリデータは通常版と分かれる。`TANZAKOO_DATA_DIR` に同じパスを指定した場合は分離されない。

AI接続設定の `Claude (Personal)` を開く。ACPアダプターは利用者が導入した `claude-agent-acp`、CLIは利用者が導入・ログイン済みの公式 `claude` を使う。自動導入・同梱はしない。

- 実行ファイル欄はACPアダプターのコマンドまたは絶対パス。リポジトリの開発依存を使うWindowsの例は `G:\tanzakoo\node_modules\.bin\claude-agent-acp.cmd`。別の場所にcheckoutした場合は読み替える。GUI起動でNodeがPATHにない場合は、Nodeの絶対パスを実行ファイル欄に指定し、アダプターの `dist/index.js` の絶対パスを引数の先頭に追加する。
- 引数の初期値は `["--tanzakoo-claude-cli=claude"]`。CLIの場所を固定する例は `["--tanzakoo-claude-cli=C:\\Users\\your-name\\.local\\bin\\claude.exe"]`。
- この引数はTanzakooが取り除き、解決したCLIのパスをアダプター子プロセスの `CLAUDE_CODE_EXECUTABLE` に渡す。指定がない・重複・CLIが見つからない場合は停止し、SDK同梱CLIへフォールバックしない。
- アダプターとCLIが使える状態で「接続を確認」を実行する。確認はACP初期化・セッション作成と認証状態の取得までで、プロンプト、ボード、参照資料、MCPは送らない。会話を始める前には従来の送信同意が必要。
- 認証は公式CLI自身に任せ、Tanzakooはログイン・ログアウト、認証情報の読み取り・コピー・保存を行わない。認証の種類だけを表示し、アカウント名やメールアドレスは保存しない。
- APIキーやCLI設定が優先されていればAPI課金になる。個人用接続はサブスク利用を強制しない。CLI自身のツール・ユーザー設定・拡張機能も動作し得る点は、既存の外部CLI接続と同じ。

## 公開版の境界

- `personal-claude` Cargo featureを明示した場合だけ、個人用接続の登録とCLI指定処理をコンパイルする。
- 通常ビルド、`public-distribution`、Mac App Storeの `app-sandbox` では個人用接続の設定・新規会話・接続確認・送信・モデル一覧・直接の `--external-acp` 起動を拒否する。個人用の保存データを開いても自動で別接続へ移行しない。
- `personal-claude` と `public-distribution` / `app-sandbox` の同時指定はビルドエラーになる。
- DMG、Mac App Store、Windows Storeの配布ワークフローと `build:desktop` は `public-distribution` を指定する。
- 各パッケージスクリプトは署名・梱包前に実行ファイルの識別子を検査し、個人用・識別不能な実行ファイルを拒否する。手動配布でも `python scripts/check-public-build.py <実行ファイル>` を実行する。個人用の成果物は公開しない。
- 公開版の `claude-api` は引き続き `--hide-claude-auth` 必須。中継の直接起動時も検証する。旧 `claude` 接続はカスタムコマンドが保存されていても起動せず、履歴閲覧のみ。

これはTanzakooが提供する接続の境界であり、利用者が任意の外部プログラムを書き換えることを防ぐ仕組みではない。

## 確認したアダプターと実機

既存の開発依存 `@agentclientprotocol/claude-agent-acp 0.87.0`（Apache-2.0、Node >=22、Agent SDK 0.3.287）の `dist/acp-agent.js` で、認証確認の `claudeCliPath()` と会話作成の `pathToClaudeCodeExecutable` の両方が `CLAUDE_CODE_EXECUTABLE` を参照することを確認した。新しい依存は追加していない。Nodeは既存のmise固定版24.21.0を使う。

Windowsの公式CLI 2.1.296を指定して実接続確認を実施。この環境のCLI自身が報告した認証方式は `api_key` だった。サブスク認証での実接続・実モデルへの送信は未検証。サブスク認証の通知、会話・再開・MCP引き渡しは模擬ACPで検証する。

実認証の確認を再実行する場合（プロンプト送信なし）：

```powershell
$env:TANZAKOO_PERSONAL_CLI = (Get-Command claude.exe).Source
mise.exe exec -- cargo test --manifest-path src-tauri/Cargo.toml --locked --features personal-claude --test external_agents real_personal_cli_authentication_without_prompt -- --ignored
```

サブスク認証を期待して検証する場合のみ `TANZAKOO_EXPECT_CLAUDE_SUBSCRIPTION=1` も設定する。その場合、APIキー認証であればテストは失敗する。ログイン設定の変更は本人が公式CLIで行う。

利用枠の扱いと第三者製品の提供条件は別の論点。個人用ビルドの追加を公開版のサブスク対応の承認根拠にしない。調査は [Claude接続の提供条件](claude-connection-terms.md) を参照。

## 実装時の検証

2026-10-14、Windowsで以下を確認した。

- `pnpm check`：lint・整形・フロントエンド154テスト・TypeScript・Viteビルド成功。
- 通常のRust全テスト成功。個人用はlib 117件、認証4件、外部接続9件が成功。実認証の任意テストは別途1件成功（APIキー認証）。
- `public-distribution` の外部接続8件と `app-sandbox` の拒否2件が成功。個人用とのfeature競合は両方ビルドエラーになることを確認。
- 通常・個人用のClippy成功。Windows梱包6件、Mac関連21件、ビルド識別子の検査1件が成功。
- `pnpm build:personal --debug` でTauriアプリのビルド成功。生成した実行ファイルが個人用識別子を返し、公開用梱包検査で拒否されることを確認。公開用実行ファイルが同検査を通ることも確認。

Mac実機、署名済みDMG・PKG・MSIX、サブスク認証での実会話は今回未検証。
