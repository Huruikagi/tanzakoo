# Claude接続の提供条件の整理

更新：2026-09-16

TanzakooからユーザーのClaude契約（claude.aiログイン）で会話する構成が、公式の提供条件に適合するかを整理したメモ。Anthropicの正式な回答や承認ではなく、AI（Claude自身を含む）による資料の読解である。

## 結論

2026-09-19の方針変更：当面はCodexのみで体験を確かめる。Claudeなどは、その後にAPIキー設定方式での追加を検討する。以下は過去のサブスク接続調査として残し、問い合わせへの回答を現在の開発の前提にはしない。APIキー対応は未実装。

**未解決。配布版でClaudeのサブスクリプション接続を正式対応として提供しない。**

公式資料の「利用者本人が改変していないClaude Codeへ自分の契約でログインする構成は妨げない」という記載だけでは、Tanzakooの構成が認められると判断できない。より具体的に第三者製品・Agent SDKを対象とした制限に該当する可能性が高く、事前承認の要否をAnthropicに確認する必要がある。

APIキー方式への切り替え、独自のクラウド中継は未合意のため採用しない。

## 確認した資料（2026-09-16取得）

| 資料                                                                                                                                             | 該当する記載（要約）                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)                                                                         | 事前承認がない限り、第三者開発者が自社製品（Agent SDKで作ったエージェントを含む）でclaude.aiログインや利用枠を提供することを認めない。APIキー認証を使う。SDKの利用はCommercial Termsに従う。                                                                                                                                                                                                                                                               |
| [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)「Can customers offer Claude Code in their products?」               | 製品でClaude Codeを事前導入・実行するにはCommercial Termsへの同意と次の条件が必要：バイナリを改変しない、組み込みの認証方法を削除・無効化・制限しない、利用者の代わりに支払い・再販・仲介しない（各利用者が自分の認証情報で認証し、本人に課金される）。                                                                                                                                                                                                    |
| 同「Authentication and credential use」                                                                                                          | OAuthは契約者本人による通常のClaude Code・Anthropic純正アプリの利用向け。Agent SDKを使う製品の開発者はAPIキー認証を使う。第三者開発者が自社アプリでClaude.aiログインを提供すること、Free/Pro/Maxの認証情報で利用者の代わりに通信することを認めない。認証情報の収集・保存・仲介は不可で、サインインはAnthropic自身の手順で完了させる。一方で、利用者本人が改変していないClaude Codeに自分の契約でサインインすることは妨げない。認証方法の相談先は営業窓口。 |
| [Authentication](https://code.claude.com/docs/en/authentication)                                                                                 | 認証情報はWindowsでは `%USERPROFILE%\.claude\.credentials.json`、`CLAUDE_CONFIG_DIR` 指定時はその配下。優先順位は環境変数のAPIキー等がサブスクリプションより上。                                                                                                                                                                                                                                                                                           |
| [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) | Agent SDK経由の第三者アプリ利用を別枠クレジットに移す変更は2026-06-15に延期され、現在は契約の利用枠を使うと記載。ただし、第三者開発者の承認要否や対象条件は書かれていない。**利用枠の扱いの説明であり、提供の許可ではない。**                                                                                                                                                                                                                              |

参考（非公式・根拠にしない）：[Zedのブログ](https://zed.dev/blog/anthropic-subscription-changes)は、ACP経由ではなくターミナルで公式 `claude` CLIを使う方法を案内している。

## 現行アダプターの実態（ソースで確認）

`@agentclientprotocol/claude-agent-acp` 0.77.0（Zed製、Apache-2.0）を `node_modules` で確認。

- 起動するもの：アダプターは `@anthropic-ai/claude-agent-sdk` 0.3.270 の `query()` を使い、SDKのオプション依存に含まれるネイティブバイナリ `claude.exe`（`--version` は `2.1.270 (Claude Code)`）を子プロセスとして起動する。`CLAUDE_CODE_EXECUTABLE` で差し替え可能。
- ライセンス：SDKとバイナリは「© Anthropic PBC. All rights reserved.」で、利用条件は上記Legal and complianceに従う。オープンソースライセンスによる再配布許可ではない。
- 認証：クライアントが `clientCapabilities.auth.terminal`（または `_meta["terminal-auth"]`）を宣言した場合だけ、`claude auth login --claudeai`（サブスク）と `--console`（API課金）をターミナル認証として提示する。ログイン処理自体は公式バイナリが行い、認証情報は `CLAUDE_CONFIG_DIR`（既定 `~/.claude`）に保存される。アダプターは認証情報を読まない。
- 認証状態：`initialize` 後やセッション作成時に `_auth/status_update` 通知で種類（`none` / `account` / `api_key` / `gateway` / `external`）を送る。サインインしていなくてもセッション作成は成功し、送信時に `authRequired` になる。
- サインアウト：`logout` で `claude auth logout` を実行する。
- `--hide-claude-auth`：claude.aiのサブスク課金を使わせない統合向けのフラグがある。ログイン方法を隠し、サブスクで課金される会話を拒否する。第三者統合での扱いに制約があることをアダプター側も想定している様子だが、規約の根拠にはしない。
- `ANTHROPIC_API_KEY` 等が環境にあると、サブスクより優先されてAPI課金になる。

## Tanzakooの構成が該当する条件

構成：Tanzakoo独自のチャットUI・指示文・MCPツール → ACP → claude-agent-acp → Claude Agent SDK → 公式 `claude` バイナリ → Anthropic。

| 論点                                                        | 判断                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 「第三者開発者の製品」「Agent SDKで作ったエージェント」か   | 該当する。Tanzakooが会話の画面・指示・ツールを提供し、SDK経由でClaude Codeを駆動する。                                                                                                                                                          |
| 「claude.aiログインを自社アプリで提供」か                   | Tanzakooに「Claudeでサインイン」を置けば該当する可能性が高い。ログイン処理を公式バイナリが行っても、提供主体はTanzakooになる。                                                                                                                  |
| 「改変していないClaude Codeへの本人ログイン」の例外に入るか | 資料では判断できない。例外の対象は利用者がClaude Code自体を使うケース（ホストされたサンドボックス等）と読め、独自UIからSDKで駆動する構成を含むかは書かれていない。SDK向けの記載は事前承認を要求しており、例外より具体的。                       |
| 同梱・再配布                                                | 製品へのClaude Code事前導入はCommercial Termsへの同意が前提。配布者（ユーザー）の同意・判断が必要で、未実施。バイナリの無改変と、更新時に公式版のまま差し替えることが条件。                                                                     |
| 認証方法の維持                                              | 同梱する場合、組み込みの認証方法（APIキーやConsoleログインを含む）を削除・制限できない。Codexの同梱版のようにAPIキー環境変数を消す処理は、制限に当たる可能性があり、Claudeには流用しない。一方、API課金を勝手に使わせない方針との両立は未確認。 |
| 名称                                                        | 「Claude Code」を製品・機能名にしない。表示は「Claude」「Claude Agent」を使い、Anthropicの提携・推奨と誤解させない。                                                                                                                            |
| 認証情報の扱い                                              | 個人の `~/.claude` を読んだりコピーしたりしない。専用の `CLAUDE_CONFIG_DIR` を使う設計は可能だが、提供可否とは別の問題。                                                                                                                        |

## 現在の実装での扱い

- 配布（release）ビルドの既定では、Claudeを「この版では提供していない」状態として表示し、子プロセスを起動しない。サインイン・サインアウトの操作は提供しない。
- 開発ビルドでは、開発者自身のClaude Code認証による既存の外部接続を維持する。接続確認はACPの `initialize` と空のセッション作成だけを行い、プロジェクト内容・MCP・プロンプトを送らない。ターミナル認証の対応を宣言しないため、アダプターはログイン方法を提示しない。
- 接続確認では、アダプターの `_auth/status_update` から認証の種類を表示する（未ログイン、サブスク、APIキー＝月額契約とは別料金、など）。メールアドレスは表示・保存しない。

## 別の接続方式の候補（未合意・未実装）

**利用者自身のClaude Codeから、TanzakooのボードをMCPで使う方式。** Tanzakooはログインを提供せず、Claudeを起動もしない。利用者は自分で導入・ログインした公式Claude Code（ターミナル等）に、Tanzakooが提供するMCPサーバー（ボード取得・候補作成・変更提案）を登録する。

- 規約上は、利用者本人による通常のClaude Code利用に近く、「第三者アプリでclaude.aiログインを提供する」構成を避けられる見込み。ただしこれも資料の読解であり、承認ではない。
- 体験は変わる：会話はTanzakooのチャット欄ではなくClaude Code側で行う。会話履歴はTanzakooに保存されない。提案の承認はこれまでどおりTanzakooで行う。
- 実装上の課題：アプリ起動中に外部プロセスがDBへ書いた変更を画面へ反映する仕組み、プロジェクトの指定方法、MCPツールの自動許可の案内。
- 採用するかはプロダクト判断が必要。

## 問い合わせの経過

### ヘルプのAIチャット（2026-09-27）

短縮版の質問を送り、次の回答を得た。**AIサポートの回答であり、Anthropicの正式な判断・承認ではない。実装の根拠にしない。**

- 第三者開発者が他の利用者向けの製品を作る場合、Claude ConsoleまたはクラウドプロバイダーのAPIキー認証が推奨される。
- サブスクリプションの制限に対して第三者のトラフィックをルーティングしようとするアプリケーション、Anthropicのサーバーに対して身元を偽るアプリケーションは禁止。
- 未改変のClaude Codeバイナリを使い、各利用者が自分のアカウントでログインする構成が、Agent SDKの規約のどちらに該当するかは、このチャットの情報では判断できない。

整理すると、前段の「サブスクリプションの利用枠に第三者アプリのトラフィックを流す」という表現は、Tanzakooの構成に当てはまりうる。一方、Tanzakooは身元を偽らず、認証情報も扱わない。判断できないという回答である以上、結論は変わらず未解決のまま。人間の担当者による書面での回答が必要。

その後、同じチャットで人間の担当者へ引き継がれ、メールで回答予定となった（2026-09-27時点で待ち）。サポートの会話IDは公開リポジトリに残さず、ユーザーの手元とサポートからのメールで管理する。回答が届いたら、日付・回答者・内容をここに追記し、実装方針を見直す。

## Anthropicへの問い合わせ文（未送信）

送信先の候補：Legal and complianceの案内にある[営業窓口](https://claude.com/contact-sales)（`anthropic.com/contact-sales` から移転）。送信はユーザーが判断する。名前・連絡先はフォーム側に入力するため本文には書かない。回答は入力したメールアドレスに届く想定で、承認が必要な場合は文面で残す。

```text
Subject: Claude subscription sign-in for a local desktop app built on the Agent SDK via ACP

Hello,

Tanzakoo is a local desktop app (Tauri, Windows and macOS) that helps people turn vague
product ideas into implementable requirements using a card board. AI is optional: the app is
fully usable without it. It is not released yet, and we would like to confirm which
authentication methods are permitted before we ship Claude support.

Distribution plan
- Free of charge, with no paid tier, no ads and no resale of Claude usage.
- We plan to publish it on the Microsoft Store for Windows first, and possibly on the Mac App
  Store later. Direct downloads may also be offered.
- Claude support would ship in the app itself, so every end user would see it.

Current architecture
- Our own chat UI and instructions -> Agent Client Protocol (ACP) ->
  @agentclientprotocol/claude-agent-acp (by Zed) -> @anthropic-ai/claude-agent-sdk ->
  the unmodified native Claude Code binary shipped with the SDK -> Anthropic.
- The app exposes local MCP tools (read board, create candidate card, propose a change);
  the user applies changes in our UI.
- Each end user would use their own account. We do not pay for, resell or proxy usage, and
  we run no cloud relay.
- Sign-in would be performed by the unmodified binary (`claude auth login --claudeai`) in an
  app-specific CLAUDE_CONFIG_DIR. We never read, copy, store or transmit credentials.
- Connection checks send no user content.

Questions
1. The Agent SDK overview says third-party developers may not offer claude.ai login or rate
   limits without prior approval, while the Legal and compliance page says an end user may sign
   in to the unmodified Claude Code binary with their own subscription. Does the architecture
   above require prior approval to let users sign in with their Claude Pro/Max/Team plan?
2. If approval is required, how do we apply, and what conditions would apply?
3. If we bundle the SDK and its native binary in our installer, is agreeing to the Commercial
   Terms of Service sufficient, and are there requirements for keeping the binary updated?
4. Bundling requires not restricting built-in authentication methods. May the app choose not
   to present API key / Console sign-in in its own UI, as long as the binary itself is
   unmodified?
5. Alternative: the user runs their own Claude Code and adds our local MCP server, with no
   sign-in offered by our app. Is that treated as ordinary Claude Code usage?
6. Are there extra requirements for distributing through app stores (the Microsoft Store, or a
   sandboxed app on the Mac App Store) when the bundled binary is launched by the app?
7. Does anything change because the app is free and aimed at individual users rather than sold
   to organizations?

Thank you.
```
