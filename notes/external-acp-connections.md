# インストール済み外部ACP CLIへの接続

2026-10-11実装。Mac App Store版以外（Microsoft Store候補を含む）で、利用者が導入・ログイン済みのCLIを選んで会話する。Mac App Store版はChatGPTサインインのみ。同日の利用者判断でGemini CLI・Cursorは接続候補から除外し、Antigravityと、APIキー方式に限ったClaude APIを追加した。除外した接続の既存会話は閲覧だけを維持する。

## 接続の境界

- 自動インストール・同梱・認証情報の読み取りやコピーは行わない。CLI自身が既存の認証を利用する。
- コマンド名はPATHから解決する。GUIからPATHが見えない場合は絶対パスを設定する。起動引数はJSON文字列配列で保存し、認証情報を入力しないよう案内する。
- 起動時はプロジェクト外の専用ディレクトリを使う。接続確認ではプロジェクトのボード・メモリ・参照資料・MCP・プロンプトを渡さず、ACPセッション作成までを確認する。
- 接続確認結果・確認日時・起動設定はプロジェクトDBに保存し、再起動後も「接続を確認済み」または「要対応」を表示する（2026-10-12）。確認日時は設定詳細に表示し、起動コマンド・引数を変えると「未確認」に戻す。会話の成功・接続失敗も結果を更新する。手動停止とモデル・推論設定の不一致では保存済み結果を置き換えない。起動だけで自動接続は行わない。
- 会話時は既存のTanzakoo MCPとカード・メモリの提案承認を利用する。外部CLIからの権限要求を自動承認しない。ただしCLI独自の設定・拡張機能・ツールも動くため、送信同意で案内する。
- Copilot CLI 1.0.95はACPの`mcpServers`に渡したstdioサーバーを拒否するため、[公式の`--additional-mcp-config`](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)でTanzakoo MCPを起動時だけ追加する。毎ターン作り直し、質問・議論を現在の発言に紐づける。CLIの設定ファイルや権限設定は変更せず、接続確認には渡さない。
- 同じ起動設定の同意はプロジェクト間で共有する。コマンド・引数の変更で同意と当該CLIのACPセッションを解除し、会話履歴は保持する。
- モデルはCLIの既定値を使う。ChatGPTのモデル・推論設定やアプリ用認証環境変数は外部CLIへ追加しない。
- `app-sandbox`ではUIを隠し、設定保存・会話作成・実行・専用ランチャーでも拒否する。通常版の保存済み設定があっても起動しない。
- Windowsでは専用ランチャーをJob Objectに入れ、停止・終了時にCLIと子孫プロセスをまとめて終了する。npmラッパー配下のプロセスも対象。

## Windowsでの実CLI確認

Tanzakooのコンパイル済みバイナリの診断経路（`--connection-check` / `--smoke`）と、合成データ専用のGUIで確認。診断経路ではツール実行を拒否し、GUIでは対象のTanzakoo操作だけを都度許可した。Free等の料金プランの継続利用やストア審査通過を保証するものではない。

| CLI                | バージョン         | 結果                                                                                                                  |
| ------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| GitHub Copilot CLI | 1.0.95             | 既存の認証で接続・応答・カード作成・提案承認・再開後の選択質問が成功。Windowsの`.cmd`ラッパー経由。契約プランは未確認 |
| OpenCode           | 1.19.0             | ローカルOllamaのQwen3.5 4Bで接続・応答・カード作成・会話再開・未承認変更提案が成功                                    |
| Devin CLI          | 3000.11.3          | 以前にFreeとしてログインした既存アカウントで接続・応答・カード作成・提案承認・再起動後の再開・停止が成功              |
| Gemini CLI         | 0.63.0             | Googleログイン再実行後、個人向けクライアントのサポート終了エラー。プロンプト送信なし                                  |
| Cursor CLI         | 2026.10.01-e373342 | 認証が必要との応答を確認。終了時の子プロセス残留はWindows Job Objectで解消                                            |

## 自動検証と未確認範囲

UIテストでは接続先の選択と下書き保持、ChatGPT未ログインでの外部送信、Mac App Store向け表示・送信制限を確認。Rustでは偽CLIを使った実バイナリの接続・会話・復元、認証環境の継承、プロジェクトをまたぐ同意、設定変更時のセッション解除、Windowsの子孫終了、`app-sandbox`での起動拒否を確認する。

### 実GUIの結果（2026-10-11）

- 検証用データはworktreeの`.local/external-gui`に分離し、通常利用中のデータは変更しなかった。実CLIは利用者自身の認証を使用した。
- Devinで「毎朝3つ選ぶ」、Copilotで「Weekly review」を各1枚作成。同じ会話から本文変更を提案し、元の本文が維持されたまま未承認差分が表示された。画面の「適用する」の後にだけ保存本文が変わり、両カードがrevision 2・両提案がappliedになったことをSQLiteでも確認した。
- Copilotでさらに同じ会話を再開し、選択質問を表示した。保存された質問のconversationIdとmessageIdが今回の発言に一致した。再開時に古いMCP設定を引き継いでいないことを確認した。
- Devinはアプリを終了してrelease payloadから再起動した後も、履歴・カードを保持して会話を再開できた。ツール権限待ちで「応答を停止」を押すと待機表示が消え、入力が戻った。別途releaseバイナリの`--smoke-cancel`で最初の応答断片の後に停止し、部分応答保存も成功した。
- 会話切り替え後に前の「応答を停止しました」が残る不具合を修正し、GUIと回帰テストで確認した。
- `pnpm check`（140テスト）・`cargo test --locked`（127成功、実Claude接続1件ignored）・Clippy・Windowsパッケージ用Pythonテスト6件が成功した。

### Antigravity公式ACPの追加検証（2026-10-11）

利用者の「ACPで繋げられるか調べて、いけそうなら試して」に基づき、公式ACPサーバーを別worktreeで検証した。この時点では製品の接続候補への追加や同梱は行わず、後続の組み込みは次節に記録する。

- [Google公式Zed連携ガイド](https://www.antigravity.google/docs/ide/extensions/zed)はACPレジストリ経由の導入と個人Googleアカウント（無料枠を含む）を案内している。
- [ACPレジストリ](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json)の`antigravity-acp` 1.3.0を使用。作者はGoogle LLC、ライセンスはproprietary。`agy`の起動フラグを推測する方式ではなく、Googleが配布する`agy_acp_server.exe`を引数なしで起動する。
- Windows x64配布URL: `https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.3.0-windows-x86_64.zip`。SHA-256: `65215e0688681fa3116e048a9eab27ef53af1bbd6f3da3f1c52bd4911d8b17f9`。同梱の`agy_acp_server.exe`と`localharness_external.exe`は両方ともGoogle LLCの有効なAuthenticode署名を確認した。
- 配置先は`.local/antigravity-probe/server`。グローバルインストールやPATH変更、認証情報の読み取り・コピーはしていない。公式サーバーの`authenticate`に`oauth-personal`を指定し、利用者がブラウザでログインした。アカウントの契約プラン自体は未確認。
- `initialize`（protocolVersion 1）、認証、`session/new`、`session/prompt`に成功し、`TANZAKOO_ACP_OK` / `end_turn`を受信した。モデル・モードの選択肢もACP応答に含まれる。試験は既定モデル`gemini-3.8-flash-high`・`default`モードで実施した。
- 別プロセスで保存済み認証を再利用し、Tanzakooの実MCP（`tanzakoo.exe --mcp <検証用DB> antigravity`）をstdioで渡した。`get_board`と`create_candidate`が成功し、合成カード1枚をSQLiteで確認した。
- さらにプロセスを再起動し、`session/load`で同じ会話を復元。`propose_card_change`でpending提案1件を作成できた。元カードの本文とrevision 1は保持された。モデルが必須引数不足で数回再試行したため、最終成功だけでなくこの挙動も記録する。
- ツール権限要求の名前は`tanzakoo_get_board`等。最初の試験では検証クライアントが未知の名前として拒否し、操作されなかった。実際の名前を確認後、合成データに対する上記3ツールだけに`allow_once`を返して再試験した。`allow_always`や`yolo`は使っていない。
- 記録は`.local/acp-probes/antigravity*-result.json`、合成DBは`.local/antigravity-probe/board.db`。検証後にサーバーと子プロセスの終了を確認した。

これは独立した検証クライアントとTanzakoo MCPによる技術検証であり、Tanzakoo GUIへの組み込み、停止・選択質問・配布パッケージの検証は未実施。Googleの[追加利用規約](https://antigravity.google/terms)には第三者ソフトウェアでのサービス利用に関する制限も記載されており、公式ACP連携の動作成功だけを任意の製品への組み込み・再配布の許諾として扱わない。

### Gemini除外・Antigravity組み込み（2026-10-11）

利用者の「GeminiアウトのAntigravityインで進められるだけ進めよう」に基づき、設定画面・新しい会話・バックエンドの接続候補を置き換えた。標準のChatGPT接続、Mac App Store版の外部CLI禁止、自動導入・認証情報コピーを行わない方針は維持する。公式サーバーは既存の外部実行経路から起動し、新たな依存関係や同梱バイナリは追加しない。

- Windowsの既定コマンドは`agy_acp_server.exe`、Macは`agy_acp_server.par`。引数は空で、通常の`agy`や`--acp`を指定しない。Linuxの既定引数はレジストリの`--uid=`に合わせるが、Linuxの製品サポートを追加するものではない。
- 導入は公式ACPレジストリに記載されたGoogle配布のアーカイブ一式を利用者が展開し、実行ファイルの絶対パスを設定する。[公式のログイン手順](https://www.antigravity.google/docs/cli/install/)では`agy`起動時に認証する。[共通認証の説明](https://www.antigravity.google/docs/ide/extensions/)に従い、同じOSユーザーの公式CLI・拡張機能側で認証済みの状態を使用する。アプリの接続確認から`authenticate`・`logout`を送ったり、トークンを読んだりしない。
- Geminiの保存済み会話は「Gemini CLI」と表示したまま閲覧専用にする。保存済み設定・同意があっても設定更新・新規会話・起動は拒否する。Antigravityへの設定・同意・履歴の自動移行は行わない。
- 利用条件について追加調査し、[Google AI Developers Forumの2026-09-16回答](https://discuss.ai.google.dev/t/clarification-request-is-local-ipc-pty-wrapping-of-agy-cli-for-open-standard-editor-bridges-e-g-acp-tos-compliant/175905/2)を確認した。この回答は、公式の未改変バイナリを利用者自身の認証で単一ユーザーの子プロセスとして動かし、トークンの抽出・保存・転送をしない方式について適合すると説明し、公式ACPサーバーへの直接接続を案内している。今回の構成はこの説明に沿う。回答はTanzakoo固有の認定やバイナリ再配布許可ではなく、追加利用規約そのものを置き換えるものでもない。
- 変更後の`pnpm check`は144テスト・lint・整形・型検査・ビルド成功。`cargo test --locked --test external_agents --test agent_connection`は8件成功・実Claude接続1件ignored、Clippy成功。偽CLIによるアプリ本体テストで、Antigravityの新規・復元セッションに現在の会話・発言に対応するstdio MCPが渡り、認証要求やChatGPT認証の上書きをしないことを確認した。UIでは選択・下書き保持、Geminiの閲覧専用化、Mac Store版での選択不可を確認した。
- 実装後のWindows debugバイナリでも`--connection-check antigravity`がreadyとなり、`--smoke`と別プロセスの`--smoke-resume`で短い確認文への応答・同じ会話への保存に成功した。以前の公式ACP認証を再利用し、今回は認証操作をしていない。データは`.local/antigravity-integration`だけに分離し、シェルプロセスのPATHに検証用公式サーバーのディレクトリを追加した（OSのPATH設定は未変更）。既存のユーザープロジェクトは使用していない。
- カード作成・変更提案は前節の公式サーバー＋実MCP試験、アプリ側MCP配線は今回の回帰テストで確認した。Antigravityの実GUIでの承認・選択質問・停止操作は今回再検証していない。
- リリース、公開、配布物の作り直し、Mac実機・ストア検証は利用者の意向により後回しとする。

### OpenCode + ローカルQwen3.5 4B（2026-10-11）

利用者の許可を得て、既存Ollama 0.32.1に`qwen3.5:4b`（Q4_K_M、約3.3GB、digest先頭`d8b0f5e9760c`）をダウンロードした。[公式モデル](https://ollama.com/library/qwen3.5:4b)はツール対応で、ローカル`/api/show`でも`tools`を確認した。モデルのライセンスはApache-2.0で、Tanzakoo製品の依存・同梱物には追加していない。

- [OllamaのOpenCode向け案内](https://docs.ollama.com/integrations/opencode)に合わせ、重みを共有する別名`tanzakoo-qwen3.5-4b:latest`を作り、`num_ctx: 65536`を設定した。元モデルと既存Gemmaモデルはそのまま残す。専用GPUなしのRyzen 7 9700X・RAM約62GBで、`ollama ps`は100% CPU、コンテキスト65536、稼働時メモリ約5.6GBを示した。
- OpenCode 1.19.0のACPを使用し、モデルを`ollama/tanzakoo-qwen3.5-4b:latest`、`tool_call: true`、context65536・output4096に設定。接続先は`http://127.0.0.1:11434/v1`のみで、クラウドモデル・有料APIは使用しない。
- 試験用設定は`.local/opencode-qwen4b/opencode.json`、再利用ランチャーは同フォルダーの`launch.mjs`、Tanzakoo用起動設定は`tanzakoo-agent.json`。通常のOpenCode設定は上書きせず、ランチャーが`OPENCODE_CONFIG_CONTENT`で試験設定を渡す。`--pure`で外部プラグインを無効にする。
- 合成DBは`.local/opencode-qwen4b/board.db`。新規会話で`get_board`・`create_candidate`を実行し、「Qwen 4B ACP check」1枚の保存に成功。別プロセスの`session/load`で同じ会話を復元し、`get_board`・`propose_card_change`でpending提案1件を作成できた。SQLiteでカード1枚・提案1件・元の本文とrevision 1の保持を確認した。
- 権限は上記3つのMCPツールだけをaskとし、検証クライアントは対象ツールにallow_onceのみを返す。シェル・ファイル・ブラウザー操作などは許可しない。この設定は3ツールの検証用で、質問・参照資料など全機能を許可した利用設定ではない。
- 初回のボード読み取り・カード作成・応答完了は約245秒、復元後のボード読み取り・提案作成・応答完了は約61秒。初回は会話タイトルなどの内部処理にも推論時間がかかる。復元後はモデルoptionsに`reasoningEffort: none`を指定したが、処理内容・キャッシュが異なるため、所要時間差をこの設定だけの効果とはしない。CPUの生成速度はOllamaログで約14〜16トークン/秒だった。
- 記録は`.local/acp-probes/opencode-qwen4b*-result.json`。Tanzakoo本体の`--connection-check`でも同じランチャーを使いreadyを確認した。さらに本体の`--smoke`で`LOCAL_QWEN4B_OK`の応答と保存に約35秒で成功した（合成DBは`.local/opencode-qwen4b/native`）。実GUIでの提案適用・選択質問・停止や配布物の検証は今回の範囲に含めない。

### Claude API（APIキー方式、2026-10-11）

利用者の合意（APIキー方式に限る・アプリ内でキーを扱わない・Mac App Store版はChatGPTのみ）に基づき、外部CLIの候補に`claude-api`（表示名「Claude API」）を追加した。旧`claude`の保存済み会話は閲覧のみのままで、新しい接続へ移行しない。新たな依存関係・同梱物は追加しない。

- 利用者が[`@agentclientprotocol/claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp)（Apache-2.0）を導入する。既定のコマンドは`claude-agent-acp`、引数は`--hide-claude-auth`。アダプターはAgent SDK同梱の公式バイナリを起動する。これらは利用者の環境にあり、Tanzakooは同梱・再配布しない。
- 認証は`ANTHROPIC_API_KEY`、またはClaude Codeの`claude auth login --console`。Macでは環境変数がGUIアプリに渡らないため、Consoleログインを案内する。Tanzakooはキーの入力・保存・読み取りをせず、外部CLIと同じく起動時の環境をそのまま引き継ぐ。
- `--hide-claude-auth`下のアダプターは、サブスクリプション課金になる場合にセッション作成と毎回の送信を`authRequired`（`reason: claude_subscription_not_supported`）で拒否する。0.77.0のソースで確認し、2026-10-11時点の最新0.89.1にも同じフラグと理由が残ることを確認した。
- 起動引数は編集可能なため、Tanzakoo側でも`claude-api`の保存・起動時にこのフラグを必須とする。接続確認と会話送信の`authRequired`は、サブスクリプション拒否と未認証を区別して案内する。接続確認では`_auth/status_update`の種類を表示し、メールアドレスは表示・保存しない。
- ボード操作の自動許可は旧Claudeと同じ`mcp__tanzakoo__*`の名前一致で判定する。それ以外のツール要求は利用者に確認する。

検証：

- `pnpm check`（Vitest 145件・lint・整形・型・ビルド）成功。`cargo test --locked`は133件成功・実Claude接続1件ignored。Clippy・`cargo fmt --check`成功。
- 偽CLIで、APIキーは接続可、サブスクリプションと未認証は区別した`authRequired`、メールアドレス非表示、`authenticate`・プロンプト未送信、フラグなしの設定保存拒否を確認した。
- 実アダプター0.77.0を空の`CLAUDE_CONFIG_DIR`・APIキーなしで起動し、`--connection-check`がプロンプト送信前に未認証の`authRequired`となることを確認した（`--ignored real_claude_api`）。
- 2026-10-12：Windowsでnpmグローバル導入したアダプターが「接続処理が完了しませんでした」で失敗した。npmは`.cmd`と同じ場所に拡張子なしの`#!/bin/sh`シムも作り、名前解決が先にそれを選んでCreateProcessに拒否されていた。Windowsでは`.exe`・`.cmd`・`.bat`だけを候補にし、拡張子なしの絶対パスもこれらを補うよう修正した。npm配布のCopilot CLI・OpenCodeなど名前だけで指定する全外部CLIに共通する。修正後、miseのNode配下にある実アダプター0.89.1を`.cmd`経由で起動し、`--connection-check claude-api`が未認証の`authRequired`となることを確認した（修正前は同条件でerror）。0.89.1はAPIキーなしでも`session/new`に成功し、`_auth/status_update`の`kind: none`で未認証を伝える。
- 実APIキーでの会話・カード作成・提案承認、利用者のサブスクリプションログイン状態での拒否、Mac実機は未確認。

### モデル・推論強度の選択（2026-10-12）

外部CLIでも、ChatGPT接続と同じダイアログでモデル・推論強度を選べるようにした。新たな依存関係は追加していない。

- ACPの`session/new`が返す`configOptions`のうち、カテゴリーが`model`・`thought_level`の選択肢を使う。カテゴリーのない同梱Codexは、従来どおりID（`model`・`reasoning_effort`）で判定する。claude-agent-acp 0.89.1のIDは`model`・`effort`。モード・fast・エージェント選択は扱わない。
- 選択肢の取得では、CLIを起動して作業用フォルダーでセッションを作るだけで、MCP・プロジェクト内容・プロンプトは送らない。
- 設定はプロジェクトごと・CLIごとに保存し、ChatGPT接続の設定とは別にする。CLIの起動コマンド・引数を変えると、そのCLIの設定を消す。
- 送信前に、新規・復元セッションの`configOptions`から実際のIDを調べ、モデル、推論強度の順に`session/set_config_option`で適用する。適用済みの値は送らない。モデルが提供しない値が保存されていれば、プロンプトを送る前に止めて、チャット設定の確認を求める。
- アダプターのソースでは、モデル・推論強度の変更はセッション単位で、利用者のClaude設定ファイルには書き込まない。
- 確認：`pnpm check`（Vitest 151件）・`cargo test --locked`・Clippy・`cargo fmt --check`・`test:plan`・`test:review`が成功した。Claude風の偽CLIで、取得時にプロンプトを送らないこと、実際のIDでの適用順、適用済みの値の省略、未提供値での停止、起動設定の変更時の削除を確認した。実アダプター0.89.1（APIキー認証済み）で`--chat-options claude-api`がモデル5件・推論強度6件を返し、モデル指定後も現在値が切り替わることを確認した。実APIでの会話送信（課金が発生）とGUIでの操作は未確認。

### Devinのモデル再取得エラーへの対策（2026-10-14）

- 保存済みモデルが`session/new`の現在値と同じ場合も、選択肢取得が`session/set_config_option`を送っていた。外部CLIではこの再設定を省き、新規セッションが返した選択肢をそのまま使う。別モデルを選ぶ場合は引き続き設定してから選択肢を取得し、無効な指定で別モデルへ自動変更しない。
- Devinから`swe-1-6-slow`を返された後、モデル一覧取得時に同モデルの`Resource not found`となる報告に対する防御的な修正。手元の検証用CLI（配布manifestは3000.11.3）では、現在値・選択肢として同モデル1件を受信し、再設定も成功したため、報告されたエラー自体は未再現。使用CLIのバージョン・起動設定との差は引き続き確認が必要。
- 模擬CLIで同じ現在モデルの再設定を拒否し、初回・再取得が成功すること、別モデルは設定すること、未提供モデルでは失敗することを検証。実CLIの確認ではプロンプトを送信していない。

### 残る確認

- Geminiは同日、CLI 0.63.0でGoogleログインを再実行。ブラウザの完了後、ACP認証が個人向けクライアントのサポート終了エラーで拒否された。プロンプトは送信していない。[Googleの廃止告知](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)では、個人無料・Google AI Pro・UltraのGoogleログイン経路は2026-06-18に終了している。以前の認証ガイドに基づいた「個人Googleアカウントで利用可能」という案内は訂正する。対応する別の認証経路での会話・カード操作は未確認。後続の利用者判断でGeminiは候補から外し、Antigravityを追加した。Geminiの別認証経路や有料API接続の検証は今回は行わない。
- Cursorは今回は採用しない。上表は除外前の調査履歴であり、現在の提供対象ではない。
- Cursor除外後の`pnpm check`は141テスト成功。Rustの接続・外部CLI統合テスト8件（実Claude接続1件ignored）とClippyも成功。既存Cursor設定の保存・新規会話・起動を拒否し、保存済み会話は閲覧のみを維持する。
- OpenCodeのカード作成・未承認提案は上記Qwen3.5 4Bで確認済み。実GUIでの提案適用・選択質問・停止の確認は残る。
- Mac実機での直接配布版とMac App Store版の確認は未実施。Windows上での`app-sandbox`機能フラグ検証だけでは代替できない。
- WindowsのMSIX作成と展開payloadの起動は確認できるが、インストール済みMSIXからの外部CLI実行・WACK・ストア審査は別途必要。検証用パッケージの記録は[Windows配布検証](windows-store/external-cli-validation-20261011.md)を参照する。
- プライバシー案の文面更新は含むが、公開サイトへの反映・Partner Centerへのアップロード・審査提出は含まない。
