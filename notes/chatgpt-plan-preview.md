# ChatGPTプラン接続

2026-09-30時点。Sign in with ChatGPT（SIWC）の公開クライアント向けフローを、同梱Codex ACP実行系につなぐ通常のAI接続。利用者の実接続確認と「完全に寄せる」という合意を受け、ビルド用の有効化スイッチと旧Codexログインへの切り替えを廃止した。APIがプレビューであることは受け入れ、変更時に追従する。スマートフォン版は対象外。

## 起動と確認

Node・依存関係は通常の開発手順で用意する。

```powershell
mise.exe exec -- pnpm tauri dev
```

接続状況を開き「ChatGPTで続ける」を選ぶ。既定ブラウザで本人がサインイン・利用権限への同意を行う。認証やモデル一覧の確認ではプロジェクトの内容を送信しない。接続後は新しい会話を開始し、従来と同じAI送信同意を得てから送信する。

- AI利用は本人のChatGPT利用枠を消費する。入力欄と接続設定に利用量設定への入口を置く。
- モデルは本人のOAuthトークンで `/v1/models` から取得する。保存済みのモデルが一覧になければ、チャット設定で選び直す。モデル・推論強度の設定はプロジェクト単位で保持する。推論強度は同梱ACPが選択肢を返すモデルで設定でき、それ以外は接続先の既定値を使う。
- 最後に接続したアカウントの登録IDをアプリ共通設定へ保存し、再起動時に利用可否を確認して自動復元する。必要なら既存のrefresh処理でトークンを更新する。サインアウト済み・登録不在・認証失効・通信失敗の場合は未接続のままとし、別のアカウントへ切り替えない。サインアウト後も同じ登録から再認証できる。自動復元では選択中の会話・下書きを保持する。変更前から保存されていたアカウントは、一度選択すると以降の起動で復元される。
- サインアウトはトークンを失効させ、この端末から削除する。サーバーの失効を確認できなければ警告する。登録情報・会話は残す。旧Codex認証へのフォールバックは行わない。
- 接続切り替え後は新しい会話になる。保存済み会話は元の接続・同じアカウントだけで再開できる。旧Codex接続の会話は履歴として残し、新しいChatGPT接続に自動で引き継がない。ログアウト・期限切れ・利用上限でも別の接続へ自動で切り替えない。
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

### 推論強度の選択（2026-10-01）

チャットの「モデル・推論強度」から、対応を確認できるモデルの推論強度を選択できる。選択肢の取得では、選択中のChatGPTアカウントで同梱ACPへ認証し、会話・ボード・MCPを含まない空のセッションからモデル別の設定を読む。モデル一覧そのものはOAuthの `/v1/models` の結果を維持する。

ACPが推論強度を返さないモデル（同梱カタログにない新モデルを含む）では強度の選択欄を出さず、保存時に強度指定を解除する。選択した設定はプロジェクトに保存し、新規・再開した会話の次の送信前に、モデル、推論強度の順で適用する。審査用接続は引き続き固定設定を使う。

模擬ACPで認証順序・モデル別選択肢・アカウントのモデル一覧維持・プロジェクト内容の非送信を検証する。同梱Codex・ACPと模擬Responses APIでは、新規会話の `reasoning.effort: high` と再開後の `low`、未知のモデルの選択肢不在を検証する。推論強度を指定した実ChatGPT接続での送信は未確認。

### 検証コマンド

```powershell
mise.exe exec -- pnpm test:plan
mise.exe exec -- pnpm test:review
mise.exe exec -- pnpm check
mise.exe exec -- cargo test --manifest-path src-tauri/Cargo.toml --locked
```

`test:plan` は実loopback callbackと署名付き模擬ID tokenを使い、state/clientの差し替え、不正署名・claims、権限不足、token更新、ローカル保存、サインアウトを検証する。実アカウントや外部APIは使用しない。

`test:review` 内の `plan-board` は同梱版Codex・ACPと実MCPを動かす。模擬Responses APIでHTTPストリーム、カード起票、変更提案の承認前保持、プロセス再起動後の会話再開、非対応フィールドとtoken永続化の不在を確認する。OpenAI側の受付・利用資格を証明する試験ではない。

### 開発版での実接続確認（2026-09-30）

利用者が当時のプレビュー用ビルド指定で起動したTanzakooを操作し、この会話で次の成功を報告した。

- 実アカウントで接続し、新しい会話で送信・返答を確認。
- アプリ再起動後、保存済みの同じアカウントを選んで再接続し、元の会話で送信・返答を確認。
- 接続設定でサインアウトし、保存済みアカウントの「再サインイン」から同じアカウントで認証後、新しい会話で送信・返答を確認。

これは利用者による開発版の手動確認。エージェントが画面・通信ログを直接検証した結果や、署名済み配布物での確認ではない。サインアウト後の再認証は、期限経過による自動トークン更新の実サービス検証とは区別する。

### 残りの確認

通常ビルドでは有効にした。次の実サービス・配布物の確認は残る。

- 起動時のアカウント自動復元、モデル・推論強度UIでの選択、別アカウントへの切り替え、期限経過時のトークン更新・利用上限時の扱い、実接続でのカード操作。実送信はChatGPTの利用枠を消費する。自動復元は保存先の再読み込み、サインアウト・失効・通信失敗時に別アカウントへ切り替えないこと、会話・下書き保持を自動テストで確認済み。上記の利用者による再起動確認は手動選択時の結果で、自動復元の実機確認とは区別する。
- 署名済みWindows MSIXとMac版でのブラウザ起動・loopback・資格情報保存。Mac App Sandboxでの確認は別途必要。
- 初回案内・サインインボタン・利用量への入口を含む、署名済み配布物での表示確認。保存済みアカウントごとの初回案内をWebViewのlocalStorageに記録し、同じ登録での再サインインでは繰り返さない。公式の白いロゴを黒いサインインボタンに使用する。
- `agent_name_hint` と同じ `Tanzakoo` をACPのclientInfoからapp-serverに渡す。模擬APIでoriginatorヘッダーも確認するが、実サービス上の表示・帰属は確認が必要。
- 配布成果物に含む依存の告知確認。本体は2026-09-30の合意によりMITを採用済み。個人のローカル検証とOSS配布の判断は下記の提供対象調査を参照する。
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

2026-09-30、利用者の「OK MITで」により本体のMIT採用を決定。ルート [LICENSE](../LICENSE)、README、各自作npmパッケージとCargo.tomlのlicense指定へ反映した。`packages/agent-runtime/licenses` の文書は引き続き同梱Codexの許諾・告知として保持する。デスクトップのランタイム準備と審査用relayのコンテナビルドでは、本体LICENSEも `TANZAKOO-LICENSE.txt` として同梱する。

SIWC追加部分の直接依存は、インストールされた固定バージョンのpackage.jsonで `jose 6.2.12` と `open 11.0.4` がMIT、既存 `@agentclientprotocol/codex-acp 1.13.1` がApache-2.0と確認した。同梱Codex `0.156.1` は保存済みLICENSEがApache-2.0で、NOTICEも維持している。これらの許諾と告知は本体のライセンスと分けて保持する。全フロントエンド・Rust依存・フォント・各OSの完成パッケージを一括監査済みとは扱わない。

### 採用した本体ライセンス

Tanzakoo自身のコードとドキュメントに [MIT](https://opensource.org/license/mit) を適用する。著作権表示と許諾文の保持を条件に、第三者による改変版の配布・販売も認め、改変ソースの公開は義務付けない。依存のライセンスをMITに置き換えるものではない。

利用者がMITで配布されたTanzakooを商用利用・再販売できることと、その派生アプリがSIWCの提供対象になることは別の判断となる。

### 公開前に残る提供上の確認

[UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines) を基に、初回案内・公式ロゴ付きボタン・利用中表示・利用量管理への入口を実装した。実サービスの上限エラーや署名済み配布物での表示は引き続き確認する。アプリ自身のライセンスを選んでも、OpenAIのサービス利用条件・利用者の対象資格・ストア規則を置き換えるものではない。

## 参照した公式資料

- [Sign in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- [Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

公開プレビューのため、実サービス検証時に仕様を再確認する。
