# ChatGPTプラン接続のデスクトッププレビュー

2026-09-30時点。Sign in with ChatGPT（SIWC）の公開クライアント向けフローを、既存Codex ACP実行系につなぐ検証実装。Cargo feature `chatgpt-plan-preview` を指定したビルドだけに入口を表示する。スマートフォン版は対象外。

## 起動と確認

Node・依存関係は通常の開発手順で用意する。

```powershell
mise exec -- pnpm tauri dev --features chatgpt-plan-preview
```

接続状況を開き「ChatGPTプラン接続（プレビュー）」→「ChatGPTで続ける」を選ぶ。既定ブラウザで本人がサインイン・利用権限への同意を行う。認証やモデル一覧の確認ではプロジェクトの内容を送信しない。接続後は新しい会話を開始し、従来と同じAI送信同意を得てから送信する。

- AI利用は本人のChatGPT利用枠を消費する。入力欄と接続設定に利用量設定への入口を置く。
- モデルは本人のOAuthトークンで `/v1/models` から取得する。通常接続で保存済みのモデルが一覧になければ、チャット設定で選び直す。モデル設定は現状、通常接続と共通。推論強度はこのプレビューでは接続先の既定値を使う。
- 保存済みアカウントは再起動後に選択して接続する。選択中の接続は起動中だけ保持する。サインアウト後も同じ登録から再認証できる。
- サインアウトはトークンを失効させ、この端末から削除する。サーバーの失効を確認できなければ警告する。登録情報・会話は残す。「通常の接続に戻す」はログアウトではない。
- 接続切り替え後は新しい会話になる。保存済み会話は元の接続・同じアカウントだけで再開できる。ログアウト・期限切れ・利用上限でも通常接続へ自動で切り替えない。
- 審査用接続は別経路として維持する。審査員のChatGPT契約やログインを新たな前提にしない。この実装はストアへの提出・審査通過を意味しない。

## 実装の境界

- 初回は `dynamic_agent_client`、端末で保持する `ext_agent_host_id`、`agent_name_hint=Tanzakoo` を使用する。callbackで発行された `client_id` と検証済み `sub` を登録単位で保持し、以後の認証・更新・失効で再利用する。client secretやAPIキーは要求しない。
- 一時的な `127.0.0.1` のloopback listener、PKCE S256、ランダムなstateとnonceを使う。ID tokenはOIDC discoveryとJWKSから `jose` で署名・issuer・audience・期限・nonce・再認証時のsubjectを検証する。scopeはtoken応答で確認する。
- 認証情報はアプリデータ内 `chatgpt-plan/accounts.json` に保存する。Unixはディレクトリ0700・ファイル0600、Windowsはユーザーのアプリデータ領域のACLを継承する。OSキーチェーンによる暗号化は未実装。原子的な置換とSQLiteのプロセス間ロックで更新を直列化する。処理中止時もOSがロックを解放する。
- Node helperとRust間だけでトークンを受け渡す。WebViewにはアカウント表示情報だけを返す。ACP gateway認証でBearerを実行中メモリに渡し、Codexの認証ファイルや環境変数には渡さない。下位エラー本文を画面へ転送しない。
- アカウントごとにCodex homeとセッション接頭辞を分離する。各送信前に必要ならrefresh tokenを更新して保存する。期限切れや失効の際に課金APIへフォールバックしない。
- `/v1/responses` のHTTP/SSEを使う。ローカルMCPのカード操作・提案承認・参照資料読み取りは既存経路を利用する。`tool_search` は無効。会話はCodexのローカル履歴から復元し、`previous_response_id` に依存しない。
- `jose`（MIT）をID token検証、`open`（MIT）を既定ブラウザ起動に使用する。

## 検証と残りの確認

```powershell
mise exec -- pnpm test:plan
mise exec -- pnpm test:review
mise exec -- pnpm check
mise exec -- cargo test --manifest-path src-tauri/Cargo.toml --locked --features chatgpt-plan-preview
```

`test:plan` は実loopback callbackと署名付き模擬ID tokenを使い、state/clientの差し替え、不正署名・claims、権限不足、token更新、ローカル保存、サインアウトを検証する。実アカウントや外部APIは使用しない。

`test:review` 内の `plan-board` は同梱版Codex・ACPと実MCPを動かす。模擬Responses APIでHTTPストリーム、カード起票、変更提案の承認前保持、プロセス再起動後の会話再開、非対応フィールドとtoken永続化の不在を確認する。OpenAI側の受付・利用資格を証明する試験ではない。

通常配布を有効化する前に次を確認する。今回のPRでは配布・実ログインを完了済みとして扱わない。

- 本人が操作する実SIWCログイン、モデル取得、少量の実送信、再認証・アカウント切り替え・利用上限。実送信はChatGPTの利用枠を消費する。
- 署名済みWindows MSIXとMac版でのブラウザ起動・loopback・資格情報保存。Mac App Sandboxでの確認は別途必要。
- 一回だけ表示する初回案内、正式ボタンのブランド要件、利用枠・課金表示など公開時点のSIWC要件への適合。プレビューには常設の利用枠説明のみ実装した。
- `agent_name_hint` と同じ `Tanzakoo` をACPのclientInfoからapp-serverに渡す。模擬APIでoriginatorヘッダーも確認するが、実サービス上の表示・帰属は確認が必要。
- OSSとしての一般配布に向けたTanzakoo本体のライセンス決定と、配布成果物に含む依存の告知確認。下記の提供対象調査により、個人のローカル検証とOSS配布の判断を分ける。ライセンスは未採用。
- 長時間の1ターン中に失効した場合は再認証・再送を案内する。実行中プロセスへのトークン差し替えや自動再送は行わない。ローカルtoken保存前にプロセスが停止した場合も再認証が必要になる可能性がある。

## 提供対象とライセンスの確認（2026-09-30）

公開資料と現在のソースを照合した調査結果。OpenAIからの個別承認や、全配布物のライセンス監査を取得したという意味ではない。

### 確認できた提供対象

- [Quickstart](https://developers.openai.com/siwc/quickstart) はChatGPTプラン利用をOSSと選ばれた非公開クライアントに提供すると説明している。identity-onlyの商用パートナー向け試験提供とは区別する。
- [公式Cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) は、ローカルで実行する個人プロジェクトも提供対象に含めている。そのため、本人によるローカル検証を本体ライセンス未決だけで止める必要がある、とは読まない。実アカウントの対象資格・同意・モデルへのアクセスは別途確認する。
- [プラン利用のOverview](https://developers.openai.com/siwc/token-sharing-open-source) はOSS・ローカルホスト向けの経路を説明し、有料アプリやリモートホスト型アプリにはinterest formを案内している。無料・利用者端末内で動くTanzakooをOSSとして配布する方向は、この公開経路に合うと判断する。有料化や運営側のサーバーで利用者のプランを使う構成に変える場合は、同じ許可を引き継げると仮定しない。
- 今回の登録フローはclient secret・partner API keyを要求しない。これは商用パートナー向けのclient ID発行申請が済んだという意味ではない。
- 確認したSIWC資料には、MITやApache-2.0など特定のOSSライセンスを必須にする記載は見つからなかった。無料配布だけでOSSになるわけではない。

### 現在のライセンス状態

Tanzakoo本体のルートLICENSE、READMEのライセンス宣言、ルートpackage.jsonとCargo.tomlのlicense指定は未設定。`packages/agent-runtime/licenses` の文書は同梱Codexのもので、Tanzakoo本体の許諾ではない。[GitHubの説明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) に従い、公開リポジトリであることだけを根拠にOSSと表示しない。

SIWC追加部分の直接依存は、インストールされた固定バージョンのpackage.jsonで `jose 6.2.12` と `open 11.0.4` がMIT、既存 `@agentclientprotocol/codex-acp 1.13.1` がApache-2.0と確認した。同梱Codex `0.156.1` は保存済みLICENSEがApache-2.0で、NOTICEも維持している。これらの許諾と告知は本体のライセンスと分けて保持する。全フロントエンド・Rust依存・フォント・各OSの完成パッケージを一括監査済みとは扱わない。

### 本体ライセンスの提案（未採用）

Tanzakoo自身のコードについて、改変・再配布・商用利用を広く認める方針なら [MIT](https://opensource.org/license/mit) を候補とする。著作権表示と許諾文の保持を条件に、第三者による改変版の配布・販売も認め、改変ソースの公開は義務付けない。この権利付与への意思を確認してから、ルートLICENSE・README・本体package.json・Cargo.tomlへ反映する。依存のライセンスをMITに置き換える提案ではない。

利用者がMITで配布されたTanzakooを商用利用・再販売できることと、その派生アプリがSIWCの提供対象になることは別の判断となる。

### 公開前に残る提供上の確認

[UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines) が要求する初回だけの案内、正式ボタン、利用上限時の操作案内は、一般配布前に実装・確認する。プレビューの常設説明だけで適合完了とはしない。アプリ自身のライセンスを選んでも、OpenAIのサービス利用条件・利用者の対象資格・ストア規則を置き換えるものではない。

## 参照した公式資料

- [Sign in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- [Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

公開プレビューのため、実サービス検証時に仕様を再確認する。
