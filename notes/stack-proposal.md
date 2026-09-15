# Tanzakoo — 初版の技術スタック案

2026-09-15に作成、2026-09-16更新。Tauri・React・TypeScript・RustとACPを軸にする方針は合意済み。ユーザーから、この案にあるライブラリを使って初版を実装する許可を得た。現在の依存は `package.json` / `src-tauri/Cargo.toml` とロックファイルを正とする。

## 初版での採用状況

- React / Vite / Tailwind / shadcn/ui、Lucide、Resizable、dnd kit、Zustand、CodeMirror、react-markdownを導入した。
- SQLite / rusqlite、ACP Rust SDK 2.1.0、rmcp 3.3.0、Tokio / Serde / thiserror / ts-rsを導入した。
- ACPアダプターは `@agentclientprotocol/codex-acp` 1.11.0、`@agentclientprotocol/claude-agent-acp` 0.77.0。両方で起票・会話再開・変更提案・停止を実接続検証した。
- miseでNode 24.21.0とpnpm 12.4.2を導入・実行確認した。`packageManager` も同期済み。
- Oxlint 1.83.0 + Oxfmt 0.68.0 + `@shadcn/lint` 0.1.0を導入した。TypeScriptはlintプラグインのパーサーとの互換性に合わせ6.0.3を使用。正常例の通過と `Button` の余白上書きの検出を確認した。
- 提案は変更前と変更後の全文を表示する。差分計算ライブラリ、Tiptap、WebdriverIOはまだ導入していない。

以下は選定時の理由と、今後必要になったときの候補を含む。

追加のユーザー指定：Node.jsとpnpmはmise管理。lint・整形はBiomeまたはOxlint / Oxfmtを希望。`shadcn-ui/lint` にも関心があり、採用を検討する。

## 1. 画面と操作

| 用途                           | 第一候補                                      | Tanzakooでの使い方                                           |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------------------ |
| デスクトップ基盤               | Tauri 2                                       | ウィンドウ、Rustとの連携、ローカル機能                       |
| UI開発                         | React + TypeScript + Vite                     | ボード・カード詳細・チャットの3領域                          |
| パッケージ管理                 | pnpm / Cargo                                  | TypeScript側とRust側の依存管理                               |
| Node.js / pnpmのバージョン管理 | mise                                          | `mise.toml` でNode 24.21.0（LTS）・pnpm 12.4.2を固定         |
| UI部品                         | shadcn/ui                                     | ボタン、メニュー、ダイアログ、タブ、入力欄など               |
| スタイル                       | Tailwind CSS                                  | shadcn/uiと合わせて余白・色・レイアウトを統一                |
| アイコン                       | Lucide React                                  | カード操作、参照添付、エージェント選択など                   |
| 可変ペイン                     | shadcn/ui Resizable（react-resizable-panels） | 各領域の幅調整。独自のリサイズ処理を書かない                 |
| ドラッグ操作                   | dnd kit                                       | 列内並べ替え、列間移動。現行のReact APIを候補とする          |
| UI状態                         | Zustand                                       | 選択カード、開いている詳細、入力途中の文章、添付した参照など |
| 本文編集                       | CodeMirror 6                                  | Markdown本文の編集・範囲選択・選択箇所の表示                 |
| Markdown表示                   | react-markdown + remark-gfm                   | カードのプレビュー、チャットの文章・リスト・表               |

shadcn/uiは部品のコードをプロジェクトへ取り込む方式。部品の振る舞いを再実装するのではなく、取り込んだ部品を組み合わせて製品固有の画面を作る。基礎部品の変更は必要な範囲に留める。

最初に使いそうな部品：Button、Card、Dialog、Dropdown Menu、Tabs、Tooltip、Scroll Area、Resizable、Textarea。

CodeMirrorは「本文をMarkdownとして編集する」案に基づく。ユーザーが書式を見ながら直接編集する体験を重視する場合は、Tiptapを比較する。本文形式はまだ確定していないため、エディタ導入前に具体的な操作案を示す。

## 2. 保存・エージェント接続

| 用途                   | 第一候補                             | Tanzakooでの使い方                                |
| ---------------------- | ------------------------------------ | ------------------------------------------------- |
| ローカルDB             | SQLite + rusqlite                    | カード、状態、未適用の提案、会話記録を保存        |
| ACP通信                | 公式Rust SDK `agent-client-protocol` | 共通のACPクライアント。プロトコル処理を自作しない |
| エージェント別の接続   | 既存のCodex用・Claude用ACPアダプター | ログインや対応機能の差を検証しつつ接続            |
| 非同期処理・データ変換 | Tokio、Serde / serde_json            | プロセス通信、通知、JSONデータの取り扱い          |
| エラー・診断           | thiserror、tracing                   | 画面に返すエラーと接続問題の診断                  |
| Rust / TSの型共有      | ts-rs                                | カードや提案のデータ型をRustからTypeScriptへ生成  |

DBへの書き込みはRust側に集約する。Zustandは画面の状態や表示用データを扱い、別の永続的な正本を持たせない。カードの変更と提案の適用記録は同じトランザクションで扱う案。同期APIを持つrusqliteの処理を画面や通信の実行を妨げない場所で実行する。

ts-rsは型の二重管理を減らすための候補であり、受信値の実行時検証を代替しない。エージェントが返した操作はRust側で形・対象カード・操作可否を検証する。

ACP SDKとアダプターの正確なバージョン、ランタイムの組み合わせは接続検証時に決める。SDKのバージョン番号とプロトコルのバージョン番号を混同せず、実験的な機能を前提にしない。

## 3. 必要になった時点で採用する候補

| 候補                         | 導入する条件                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Rust MCP SDK `rmcp`          | 起票・カード取得・変更提案をMCPツールとして各エージェントへ提供する構成を選んだ場合。両アダプターでの動作を先に確認 |
| Tiptap                       | Markdownのテキスト編集より、書式付きの文章を直接編集する体験を採用する場合。CodeMirrorとの比較候補                  |
| 差分計算・差分表示ライブラリ | 変更提案の表示を実装するとき。本文形式に合わせて選定し、差分アルゴリズムを自作しない                                |
| WebdriverIO / tauri-driver   | Tauri実ウィンドウの操作を自動テストする段階                                                                         |

ACPは会話・セッションの接続、MCPはエージェントに提供する操作の経路として検討する。起票・変更提案はTanzakooが定義する機能で、ACP対応だけで自動的に利用できるものではない。

## 4. 開発・検証

- Vitest + React Testing Library：カード参照の添付や変更提案の適用・却下など、ユーザー操作を検証。
- cargo test：保存、提案の適用条件、接続の状態遷移などを検証。
- Oxlint + Oxfmtを第一候補とし、rustfmt + Clippyと組み合わせる。ESLint + Prettier案はユーザー希望により取り下げた。
- TypeScriptの型検査は `tsc --noEmit` 等で別途行う。lintの通過だけで型検査済みとしない。
- 実エージェントの確認：CodexとClaudeそれぞれで会話・起票・変更提案を確認する。テスト用の応答だけで対応済みとはしない。
- ブラウザでのUIテストと、TauriのIPC・保存・実プロセスを含むテストは検証範囲を区別する。

### @shadcn/lintの組み合わせ

- 正式なnpmパッケージ名は `@shadcn/lint`。Tailwind v4向けのデザインシステム用lintで、公式READMEにESLintとOxlintへの対応が記載されている。
- この組み合わせを使いやすくするため、Biomeとの比較ではOxlint + Oxfmtを第一候補にする。Biomeは公式に記載された接続先ではない。
- OxlintはJavaScript / TypeScriptの静的チェック、Oxfmtは整形、`@shadcn/lint` はコンポーネントやテーマの使い方の確認を担当する。
- `shadcn/no-restyle` を共通部品の利用側に適用する案。部品自身の実装には適切な除外を設定し、レイアウト調整と共通デザインの変更を区別する。
- 色をテーマに揃えるルール等はUI方針に合わせて追加する。可変ペインやドラッグ用の動的スタイルを禁止するような一括設定にはしない。
- READMEではNode.js 20.19以上、Oxlint 1.80以上を要求し、利用するOxlint JSプラグインAPIをalphaとしている。導入時に正常なコードと違反例の両方で実際の動作を確認する。
- 初版ではこの設定を導入済み。現在のルールは `.oxlintrc.json` を参照。

### mise設定の状態

- `mise.toml` を作成した。Nodeは公式LTSリリース、pnpmは公式GitHubの安定リリースを確認して固定した。
- mise本体は `C:\Users\hurui\.local\bin\mise.exe` にある。指定したNode・pnpmの導入と、mise経由の実行を確認済み。
- `package.json` の `packageManager` は `pnpm@12.4.2` に同期済み。`pnpm install --frozen-lockfile` で再現できることを確認した。

## 5. 採用時の確認

この資料は用途に対する候補選定。全候補のバージョン互換性・ライセンス・Windows動作を検証済みという意味ではない。実際に追加するときに確認し、依存のバージョンとロックファイルを管理する。

## 公式資料

- [shadcn/uiの考え方](https://ui.shadcn.com/docs)、[Viteへの導入](https://ui.shadcn.com/docs/installation/vite)、[Resizable](https://ui.shadcn.com/docs/components/base/resizable)
- [Lucide React](https://lucide.dev/guide/react)
- [dnd kit React](https://dndkit.com/react/quickstart/)
- [Zustand](https://zustand.docs.pmnd.rs/learn/getting-started/introduction)
- [CodeMirrorのサンプル一覧](https://codemirror.net/examples/)、[react-markdown](https://remarkjs.github.io/react-markdown/)
- [Tiptap](https://tiptap.dev/docs/editor/getting-started/overview)
- [rusqlite](https://docs.rs/rusqlite/latest/rusqlite/)、[Tokio](https://docs.rs/tokio/latest/tokio/)、[ts-rs](https://docs.rs/ts-rs/latest/ts_rs/)
- [ACP Rust SDK](https://agentclientprotocol.com/libraries/rust)、[ACP Registry](https://agentclientprotocol.com/get-started/registry)、[Zed External Agents](https://zed.dev/docs/ai/external-agents)
- [rmcp](https://docs.rs/rmcp/latest/rmcp/)
- [Vitest](https://vitest.dev/guide/)、[React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)、[Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)
- [@shadcn/lint README](https://github.com/shadcn-ui/lint/blob/main/README.md)、[Oxlint JS Plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins)、[Oxfmt](https://oxc.rs/docs/guide/usage/formatter)
- [Biome Plugins](https://biomejs.dev/linter/plugins/)
- [mise設定](https://mise.jdx.dev/configuration.html)、[Node 24.21.0 LTS](https://nodejs.org/en/blog/release/v24.21.0)、[pnpm 12.4.2](https://github.com/pnpm/pnpm/releases/tag/v12.4.2)
