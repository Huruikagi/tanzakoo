# Appのプライバシー申告案

2026-10-04更新。提出対象は0.1.0 build 4（ソース `83949a2`）。App Store Connectには9種類の下書きとカスタマーサポートの詳細回答を保存済みだが、ラベルは未公開。build 4のMac実機実行は未確認。公開ポリシーとストアの申告判断は別に管理する。外部サービスの未確認事項を、収集しないという意味で扱わない。以下の過去の調査に対する訂正は末尾の固定バージョン調査を優先する。

## 実際のデータの流れ

| 場面                   | 内容と送信先                                                                                                                                        | 保存・注意点                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| AIを使わないボード操作 | 端末内のDB、アプリデータ領域                                                                                                                        | この操作のために開発者へボード本文を送る処理はない                                                                 |
| 通常のAI接続           | ChatGPTプランで同梱ランタイムからOpenAIへ、入力、会話履歴、現在のプロジェクト、削除されていないカード、保留提案、メモリ、登録資料情報、ツールの結果 | ChatGPTアカウントと接続。通常接続の保持・学習設定はアカウントとサービスの条件を確認する。API用の条件を流用しない   |
| 登録資料               | AIへの初期コンテキストに登録先の `id/path/kind`。読み取り時は必要な抜粋も送信                                                                       | ファイル全体を登録時に一括アップロードする仕組みではないが、パスは送信される。パスにユーザー名が含まれることがある |
| 審査用AI接続           | 同じ内容をRailway上の開発者のrelay経由でOpenAI APIへ                                                                                                | relayは `store:false`、`background:false` を指定。OpenAIの不正利用監視ログ等は別。ゼロ保持とは言えない             |
| relayの利用管理        | grant ID、コードのSHA-256、モデル、期限・失効状態、要求数、トークン累計、処理中状態                                                                 | SQLite台帳に保存。期限切れ・失効時に行を自動削除する処理はない。会話本文は台帳に含まれない                         |
| 基盤ログ               | RailwayのHTTPログではIP、要求パス、時刻、状態コード、User-Agent、所要時間等を扱える                                                                 | アプリ側 `logger:false` と基盤ログの無効化は別。実環境の設定・保持を確認する                                       |
| サポート               | 本人がメールで送ったアドレス、問い合わせ内容・添付                                                                                                  | `huruikagi@gmail.com` で受信。メールサービスも処理する。機密内容を添付するよう要求しない                           |

実装根拠: `src-tauri/src/agent/prompt.rs`、`src/bindings/ReferenceMaterial.ts`、`src-tauri/src/storage.rs`、`packages/agent-runtime/codex.mjs`、`packages/agent-runtime/reference-policy.json`、`packages/review-relay/src/server.mjs`、`packages/review-relay/src/ledger.mjs`。通常接続の認証情報は端末内の専用領域に保存し、審査コードとその同意はアプリ終了まで。

## App Store Connectの選択案

Appleの定義では、第三者が要求処理を超えて保持するデータも判断対象になる。そのため、アプリ全体を「データを収集しない」とする案は採らない。自由記述欄は通常「その他のユーザコンテンツ」に整理し、任意に入力されうる個人情報をすべて別カテゴリとして選ぶわけではない。[Appleの説明](https://developer.apple.com/app-store/app-privacy-details/)

| データの種類                                                          | 主な対象                                                  | 目的の案          | ユーザーとの関連付け                                       | 提出前の判断                                                                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------- | ----------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| その他のユーザコンテンツ / Other User Content                         | AIに送る会話、カード、メモリ、資料のパス・抜粋            | App Functionality | あり。通常接続は本人のアカウントを使用し、匿名化していない | 開示する案                                                                                                     |
| ユーザID / User ID                                                    | 通常のOpenAIアカウントとの関連、審査コードに対応するgrant | App Functionality | ありとして整理                                             | 第三者での保持・照合とコード発行運用を確認                                                                     |
| その他の使用状況データ / Other Usage Data                             | relayの要求数・トークン使用量                             | App Functionality | 審査コードに関連付く                                       | 開示する案。用途は利用枠・不正利用防止で、マーケティング分析ではない                                           |
| 診断 / Diagnostics                                                    | 基盤のエラー情報・応答時間・IP等                          | App Functionality | 匿名扱いにしない                                           | 実ログを確認し、Performance Data / Other Diagnostic Data等の該当項目を選ぶ。IPだけから位置情報収集を推測しない |
| メールアドレス / Email Address、カスタマーサポート / Customer Support | 任意の問い合わせ                                          | App Functionality | あり                                                       | Appleの任意開示条件をすべて満たすか確認。除外を決めつけず開示する案                                            |

上表は主用途の整理。通常接続で第三者が追加用途に利用する場合、その用途も評価する。Trackingは広告目的の他社データとの照合等を指す。Tanzakoo独自の広告・追跡機能は確認されていないが、同梱ランタイムと第三者の実際の扱いを確認してから「追跡しない」を確定する。「関連付けあり」と「追跡あり」は同じ意味ではない。

## 未確認事項と解消方法

- 2026-10-03、build 4のソース `83949a2` と同じ `reference-policy.json` / `codex.mjs` を再確認した。`analytics.enabled` / `otel` の明示設定はない。現行の[OpenAI公式設定リファレンス](https://learn.chatgpt.com/docs/config-file/config-reference)は、analytics未設定時にクライアント既定値が適用されると説明している。設定の不在を「計測なし」の根拠にしない。同梱ACP 1.13.1が起動するクライアントの既定値と送信内容は、引き続き確認が必要。
- 通常のChatGPTプラン接続について、同梱バージョンの計測・診断の送信設定、アカウント識別子、保存と追加用途を確認する。OpenAI APIの保持条件だけでは通常接続を判断できない。
- Railwayの実際のプランとログ設定を管理画面で確認する。公式文書のログ閲覧保持期間はFree 3日、Trial/Hobby 7日、Pro 30日、Enterprise最大90日だが、上位プランへの変更で過去ログが復元される記述があるため、これを完全消去期限と約束しない。[Railway Logs](https://docs.railway.com/observability/logs)
- relay台帳は自動削除されない。2026-10-01、利用者が「審査・不正利用調査・問い合わせ対応に必要な間保持し、不要になったら手動削除」を承認した。削除時はバックアップや基盤側の保持も確認する。失効だけで削除済みとしない。
- OpenAI APIでは通常、不正利用監視のため内容を最大30日保持する場合があり、例外もある。`store:false` はその保持をなくさない。[OpenAI: Your data](https://developers.openai.com/api/docs/guides/your-data)
- Appleが求める第三者の同等のデータ保護、同意撤回、削除の説明を、実際の外部サービス条件と照合してポリシー原稿を確定する。未確認の「学習に一切使われない」「すべて即時削除」を追記しない。
- 2026-10-01、設定画面から日英プライバシーポリシーとサポートを標準ブラウザーで開く導線を実装した。既存の署名済みbuild 3/MSIXには未収録なので再ビルド・実機確認が必要。[App Review Guidelines 5.1.1](https://developer.apple.com/app-store/review/guidelines/)

## 現行認証への更新

`packages/agent-runtime/plan/oauth.mjs` と `plan/store.mjs` では、OpenIDのプロフィール・メール・識別子とトークンを端末に保存する。サインアウトはトークンを除去するが、登録情報をすべて消す処理ではない。メールアドレスは問い合わせだけでなく認証にも関係するため、第三者での処理・保持を申告判断に含める。ChatGPTの会話履歴を取得する機能ではない。

通常接続とAPI relayは別の条件で評価する。[公式のプロフィール・セッション説明](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) と実際のアカウント設定を確認する。通知は任意で、カード本文を通知本文に含めない。Windowsのプライバシー回答にも同じ実装調査を使えるが、Appleの設問をそのまま転記しない。

## 2026-10-04：追加の調査と入力下書き

App Store Connectでは、第三者も含めた収集を「はい」とし、メールアドレス、カスタマーサポート、その他のユーザコンテンツ、ユーザID、デバイスID、製品の操作、その他の使用状況データ、パフォーマンスデータ、その他の診断データの9種類だけを保存した。用途・関連付け・トラッキングは未確定で、ラベルは未公開。これは網羅性を確定した一覧ではない。

- `pnpm-lock.yaml` の同梱Codexは0.156.1。現行の[公式Advanced Configuration](https://learn.chatgpt.com/docs/config-file/config-advanced)は、既定で匿名の利用・稼働状態メトリクスを送信し、API・ツールの回数、結果、所要時間等を含むと説明している。OTelログ出力の有効化とは別で、`analytics.enabled=false` が無効化の指定。本アプリの設定にはその指定がないため、「計測なし」とする根拠はない。製品の操作と診断の分類を下書きに加えた。現行文書と固定バイナリの完全一致や、実際の送信先別のフィールドは未検証。
- `packages/agent-runtime/plan/store.mjs` はランダムUUIDのhostを保存し、再ログインでも再利用する。OAuthで送る `ext_agent_host_id` はインストール単位の識別子としてデバイスIDの申告対象に整理した。[OpenAIのAccounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)もhost ID・発行されたclient IDの再利用を説明している。
- [Appleの定義](https://developer.apple.com/app-store/app-privacy-details/)では、第三者によるリクエスト処理を超える保持も収集に含まれ、データごとの用途を把握する必要がある。関連付けありと広告目的のトラッキングは区別する。自由入力で扱いうるあらゆる情報を機械的に別分類へ追加するわけではない。
- [OpenAIの一般プライバシーポリシー](https://openai.com/policies/privacy-policy/)（閲覧時は2026-09-10更新のUS版）は、利用・診断、IPからの大まかな場所、改善、設定に応じた学習、マーケティング等を説明する一方、API等のビジネス向けコンテンツは別契約としている。一般方針の全項目を本アプリからの収集と断定することも、ChatGPTプラン利用をAPIと同じ条件だと断定することもしない。適用する地域版とSIWC経路固有の扱いを確認してから、追加分類・用途・トラッキング回答を確定する。

残る確認を具体化すると、(1) SIWCのResponsesへの入力・出力に適用される保持・改善用途と利用者設定、(2) その経路の識別子や利用データが第三者広告のために関連付けられるか、(3) 固定したCodexの匿名メトリクス以外の診断送信、(4) IP由来の位置情報などがこの経路に適用されるか、である。一般文書からの推測で「機能提供のみ」「トラッキングなし」を公開しない。

## GitHub Issue Formsへの案内

2026-10-01、通常のお問い合わせを公開GitHub Issue Formsへ案内する変更を準備。投稿は利用者がGitHub上で行い、アプリからボードやログを自動転送しない。アカウント名・本文・添付・返信が公開され、回答・調査・改善の検討に利用することを日英ポリシーへ記載した。Issueを閉じることは削除ではなく、GitHubの保持条件や第三者のコピーも考慮する。個人情報・削除依頼・審査コード・セキュリティの問題は非公開メールへ案内する。ストアのCustomer Support等の申告判断では、この任意の外部フォームも考慮する。

## 固定バージョン調査と訂正（2026-10-04）

### 匿名メトリクスの既定値

先の「現行Codexの一般文書では既定で送信」という説明は、Tanzakooの起動方式の既定値を証明しない。npm同梱物と公式タグ `rust-v0.156.1` を照合した結果、次が確認できた。

- ACP 1.13.1の `dist/index.js` 内 `startCodexConnection` は、同梱Codexを `app-server` 引数で起動する。`--analytics-default-enabled` は付けない。
- [Codex 0.156.1のCLI](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/cli/src/main.rs#L592)は、app-serverのanalytics既定値を無効と明記している。
- [OTelの初期化](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/core/src/otel_init.rs#L68)は、`analytics_enabled.unwrap_or(default_analytics_enabled)` がfalseならmetrics exporterをNoneにする。[設定型の既定値](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/config/src/types.rs#L638)もlog/trace exporterはNone。
- Tanzakooの `reference-policy.json` はanalytics/otelを上書きしない。したがって、追加のユーザー設定がない管理ランタイムでは、一般文書を根拠に匿名メトリクスが有効だとする判断を撤回する。

これはすべてのネットワーク計測がないという証明ではない。[analyticsイベントクライアント](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/analytics/src/client.rs#L861)は別経路で、認証方式・イベント種別による送信制限がある。Tanzakooのgateway認証における全経路の通信実測、サーバーが保存する診断データ、利用者が後から加えた設定は今回未検証。製品の操作などの下書きを「匿名メトリクスが既定で有効だから確定」とは扱わず、最終的な分類は通常接続の処理も含めて判断する。

### 通常接続に残る確認

[Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)と[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)は、OAuthトークンでResponsesを使用し `store:false` / `stream:true` を要求する。一方、確認した本文にはこの経路固有の保持期間・学習利用・広告目的の照合の説明はない。[利用者向け案内](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites)も、プラン利用・接続解除の説明であり、その詳細を埋めるものではない。

接続先がAPIのURLであることだけを理由にAPIキー契約のデータ条件を適用しない。逆に、一般プライバシーポリシーの広告・位置情報の項目をすべて本経路に適用することもしない。公開文書で解決できなかった点に絞った問い合わせ文案を更新した。問い合わせ自体はAppleが一律に要求する手続きではなく、未確定の申告事項を解消するための確認手段である。送信は利用者の明示指示待ち。

### 保存したカスタマーサポートの回答

用途は「アプリの機能」と「アナリティクス」。問い合わせへの回答・障害調査に加え、公開ポリシーに記載した改善の検討を含む。メールアドレスやGitHubアカウント名を除去して受信する仕組みではないため、ユーザーとの関連付けは「あり」。サポート内容を広告向けの照合やデータブローカーへ渡す運用ではなく、トラッキングは「なし」とした。[Gmailの公式説明](https://support.google.com/mail/answer/6603?hl=en)もメール本文を広告表示のために読む・走査する用途を否定している。外部サイトをブラウザーで開くことや公開Issueが第三者に閲覧可能なことと、Tanzakooが広告向けにサポートデータを共有することは区別する。

App Store Connectで保存後、用途2件と関連付けの表示を確認。残り8種類の詳細回答とラベル公開は未実施。メールアドレスは認証でも利用されるため、サポートの回答をそのまま流用していない。
