# Macの署名・公証とDMG作成

Mac初版はApple Silicon・macOS 26 Tahoe以上向けのDMGを直接配布する。Mac App Storeの審査には提出しない。通常は利用者自身のCodexアカウントで接続する。審査用接続を検証するDMGでは、手動ビルドの選択肢で公開仲介URLを組み込む。APIキーや審査用コードは同梱しない。WindowsはMSIX / Microsoft Store方針を維持する。

## 初回設定

Apple Developer ProgramのAccount HolderがDeveloper ID ApplicationのG2証明書を発行する。秘密鍵と証明書をパスワード付き `.p12` にまとめる。App Store ConnectではDeveloper権限のチームAPIキーを公証用に発行する。

GitHubのリポジトリに次のActions Secretsを登録する。秘密鍵・パスワードをGitやログに入れない。

| Secret                       | 値                                       |
| ---------------------------- | ---------------------------------------- |
| `APPLE_CERTIFICATE`          | 秘密鍵を含む `.p12` のBase64（改行なし） |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` のExport Password                 |
| `APPLE_API_KEY_CONTENT`      | 公証用 `.p8` ファイルの内容              |
| `APPLE_API_KEY`              | その `.p8` のKey ID                      |
| `APPLE_API_ISSUER`           | チームキーのIssuer ID                    |

証明書はCIの一時キーチェーンに取り込み、既存のユーザー検索リストを保ったまま検索対象へ追加する。唯一の有効なDeveloper ID ApplicationのSHA-1識別子を選び、署名者名や秘密鍵のパスをリポジトリに固定しない。AppleのG2中間証明書も取り込む。キーチェーンのパスワードは実行ごとに生成し、公証キーとともに終了時に削除する。

## 手動実行

ワークフローがデフォルトブランチにpushされた後、GitHubのActionsで **macOS signed DMG → Run workflow** を選ぶ。CLIなら次を使う。

```sh
gh workflow run macos-dmg.yml --ref main
```

審査用接続を含める場合は実行画面の `review_access` を有効にする。CLIでは次を使う。

```sh
gh workflow run macos-dmg.yml --ref main -f review_access=true
```

接続先は `https://review-relay-production-4f29.up.railway.app` に固定する。通常版はこの入力を無効にし、審査用接続を含めない。既定は通常版。URL変更時は再ビルドが必要。

macOS 26のARM64ランナーで以下を実行する。

1. miseのNode / pnpmと固定ロックファイルを使ってインストールし、フロントエンドとRustのテストを行う。
2. `runtime:stage` でNode・Codex・ACP・ライセンスを同梱し、TauriでApple Silicon用のリリース `.app` を作る。署名は後段にまとめる。
3. 同梱物を拡張子ではなくMach-O形式で調べ、ARM64を含むことを確認して内側から署名する。実行ファイルはHardened Runtimeを使う。NodeとCodexのツール実行専用バイナリー `codex-code-mode-host` にだけ `allow-jit` を付ける。アプリ本体や他のCodexバイナリーにはJIT権限を付けず、デバッグ・ライブラリ検証無効化・未署名実行メモリの権限も追加しない。未知のネストしたbundleが追加されたら停止し、署名順を見直す。
4. 署名を検証し、開発用PATH・AI認証情報のない環境で、同梱NodeのJIT・Codexのバージョン表示・ACP初期化を確認する。さらにローカルの模擬応答を使い、署名済みランタイムとアプリのMCPでカード作成・未承認の変更提案・会話の再開を検証する。ログインや外部AIへの呼び出しは行わない。
5. アプリとApplicationsへのリンクを入れたDMGを作り、署名してAppleへ公証申請する。1回の申請で最大30分待ち、`Accepted` のときだけ公証チケットをDMGへ添付する。
6. チケットとGatekeeperの判定を確認し、DMGを読み取り専用でマウントして、配布されるアプリの署名・Gatekeeper・ランタイムと同じカード操作テストを再確認する。SHA-256を作成する。

成功時にDMGとSHA-256を `Tanzakoo-macos-arm64-<commit SHA>-review` または `-standard` Artifactへ保存する。保持期間は14日。証明書・秘密鍵・開発用認証情報はArtifactへ含めない。GitHub Releasesの作成、タグ作成、外部への公開、自動更新の実装は行わない。

## Macでの操作確認

1. 対象コミットのArtifactをダウンロードしてZIPを展開し、DMGを開く。`Tanzakoo.app` をApplicationsへコピーする。旧版が起動中なら先に終了する。
2. Applicationsから起動し、カードの作成・編集・再起動後の保存を確認する。OSの署名・公証エラーが出た場合は回避せず、表示内容を調べる。
3. 審査用DMGでは接続設定から「審査用アクセスを利用する」を開き、別途発行した期限付きコードで接続する。モデル・期限の表示、会話、候補作成、変更提案の差分と承認を確認する。
4. 再起動後にカード・会話が残り、審査用コードと同意が解除されることを確認する。通常のCodex接続は別途ブラウザ認証で確認する。
5. 必要に応じて参照資料の登録・読み取りと、ネイティブ保存ダイアログからのMarkdownエクスポートを確認する。

DMGの署名・公証とCIのランタイム初期化だけでは、これらのGUI操作が成功したことにはならない。検証時のmacOS、チップ、ビルド元コミットと結果を記録する。

署名工程の再実行では、Rustのバージョンとソース・ロックファイルに紐づくActionsキャッシュを再利用する。キャッシュは署名用Secretを渡す前に保存し、署名済みアプリ・一時キーチェーン・公証キーを含めない。型の再生成比較はts-rsが出力する行末空白だけを無視し、型内容の差分は検出する。

## 公証の待ち時間と失敗

Appleの初回公証は30分を超える場合がある。タイムアウトや `Invalid` は成功扱いにせず、DMGを配布用Artifactへアップロードしない。`macos-notarization-<run ID>-<attempt>` Artifactに申請結果と、取得できた公証ログを残す。申請IDからApple側の状況を確認し、即座に同じ申請を繰り返さない。

後から `Accepted` になっても、失敗した実行のDMGを自動公開しない。再ビルドする場合も新しいDMGの公証・チケット添付・検証をすべて実行する。公証用JSONは診断専用であり、認証情報の代わりにはならない。

## 検証の限界と配布後の更新

2026-09-26、コミット `4666605` の [初回成功実行](https://github.com/Huruikagi/tanzakoo/actions/runs/36246728045) で証明書・パスワード・公証キーを含む工程全体を検証した。10個のMach-Oとアプリ本体の署名、公証Accepted、DMGへのチケット添付、DMGと内包アプリのGatekeeper判定、同梱Node 24.21.0のJIT・Codex 0.153.4起動・ACP初期化が通過した。公証申請IDは `dc911d0e-486e-42d7-bad3-8a798537efe2`。成果物のビルド元はこのコミットであり、後続の文書更新コミットとは区別する。

2026-09-27、コミット `3e3221c` の [審査用DMGの実行](https://github.com/Huruikagi/tanzakoo/actions/runs/36300371177) が成功した。`review_access=true` で公開仲介URLを組み込み、Node 24.21.0・Codex 0.156.1・ACP 1.13.1を同梱した。62個のMach-Oとアプリ本体の署名、公証Accepted、チケット添付、DMGと内包アプリのGatekeeper判定、署名後とDMGマウント後のNode JIT・Codex起動・ACP初期化を確認した。公証申請IDは `c52ba999-cda0-4a2c-8d5f-f885a29c765d`。[審査用Artifact](https://github.com/Huruikagi/tanzakoo/actions/runs/36300371177/artifacts/10925935987) のビルド元は `3e3221c5097bd5590d3d058d94064985c4217be2`。同じコミットの通常CIもMac・Windows・仲介サーバーの全ジョブが成功した。

2026-09-27、利用者のApple Silicon・macOS 26以上の実機で、`3e3221c` のGUI起動と審査用接続の成功報告を受けた。一方、候補カード作成では「ツール呼び出し基盤が応答を返せず」という応答になり、カードが追加されなかった。ACP初期化だけでは検出できないため、署名後とDMGマウント後のカード操作テストを追加した。Codex 0.156.1のツール実行専用バイナリーはV8を使い、上流の署名設定にもJIT権限がある。対象をこのバイナリーに限定した署名修正を検証する。

GUIでの変更提案と承認、再起動後のカード・会話の保持、エクスポート、通常接続のブラウザ認証は引き続きMacで操作確認する。今後のバイナリー変更でも同じCI検証を実行し、権限を一律に広げて回避しない。

追加したカード操作テストは、署名権限を変える前の `a8efd18` でも [実行36303544451](https://github.com/Huruikagi/tanzakoo/actions/runs/36303544451) で署名後・DMGマウント後とも成功した。実機の不具合はこの単純な模擬応答では再現しておらず、CIの結果だけでは原因を断定できなかった。

署名調整後の `cd8e8d4` も [実行36303769542](https://github.com/Huruikagi/tanzakoo/actions/runs/36303769542) で成功した。62個のMach-Oとアプリ本体の署名、署名後・DMGマウント後のカード作成と未承認提案、公証Accepted、DMGと内包アプリのGatekeeper判定を確認した。公証申請IDは `7a8062ed-dd79-4abb-9cef-b2bd9cabf462`。[実機再確認用Artifact](https://github.com/Huruikagi/tanzakoo/actions/runs/36303769542/artifacts/10925874602) のビルド元は `cd8e8d4e6eea4429c0733e44e1e627f5900c1893`。

その後、利用者が実機の会話記録から `code-mode host closed its stdout` が6回記録されていることを報告した。署名調整版への置き換えと新しい会話での再試行を案内し、「カード作成された」との報告を受けた。実機で審査用接続から候補カードを作成できるところまで復旧したことを確認した。これは利用者による実機確認であり、CIで元の終了原因を再現・特定したことや、変更提案の承認・再起動後の保持まで確認したことを意味しない。

App Sandbox用の設定はDMGビルドで読み込まない。保存先と外部ファイルアクセスは [保存設計](store-storage.md) を参照。初版の更新は新しいDMGからアプリを置き換える形を想定し、自動更新は未実装。

## 参考

- [Apple: Developer ID証明書](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)
- [Apple: macOSソフトウェアの公証](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Tauri: macOS署名・公証](https://v2.tauri.app/distribute/sign/macos/)
- [GitHub: macOSランナーでの証明書の取り込み](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)
- [Codex 0.156.1: ツール実行専用バイナリーの署名設定](https://github.com/openai/codex/blob/rust-v0.156.1/.github/scripts/macos-signing/codex-code-mode-host.entitlements.plist)
