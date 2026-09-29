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
- 公開クライアント向け提供条件とTanzakooのソース公開・ライセンスの適合。公開リポジトリであるだけではOSSライセンスの付与を意味しない。本実装はプロジェクトのライセンスを新たに選択しない。
- 長時間の1ターン中に失効した場合は再認証・再送を案内する。実行中プロセスへのトークン差し替えや自動再送は行わない。ローカルtoken保存前にプロセスが停止した場合も再認証が必要になる可能性がある。

## 参照した公式資料

- [Sign in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- [Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

公開プレビューのため、実サービス検証時に仕様を再確認する。
