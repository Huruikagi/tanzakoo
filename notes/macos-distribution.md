# Macの署名・公証とDMG作成

Mac初版はApple Silicon・macOS 26 Tahoe以上向けのDMGを直接配布する。Mac App Storeの審査には提出しない。既存ユーザー自身のCodexアカウントで接続し、審査用のキー・デモ・バックエンドは追加しない。WindowsはMSIX / Microsoft Store方針を維持する。

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

証明書はCIの一時キーチェーンに取り込み、唯一の有効なDeveloper ID ApplicationのSHA-1識別子を選ぶ。署名者名や秘密鍵のパスをリポジトリに固定しない。AppleのG2中間証明書も取り込む。キーチェーンのパスワードは実行ごとに生成し、公証キーとともに終了時に削除する。

## 手動実行

ワークフローがデフォルトブランチにpushされた後、GitHubのActionsで **macOS signed DMG → Run workflow** を選ぶ。CLIなら次を使う。

```sh
gh workflow run macos-dmg.yml --ref main
```

macOS 26のARM64ランナーで以下を実行する。

1. miseのNode / pnpmと固定ロックファイルを使ってインストールし、フロントエンドとRustのテストを行う。
2. `runtime:stage` でNode・Codex・ACP・ライセンスを同梱し、TauriでApple Silicon用のリリース `.app` を作る。署名は後段にまとめる。
3. 同梱物を拡張子ではなくMach-O形式で調べ、ARM64を含むことを確認して内側から署名する。実行ファイルはHardened Runtimeを使う。Nodeにだけ `allow-jit` を付け、アプリ本体やCodexにJIT・デバッグ・ライブラリ検証無効化の権限を付けない。未知のネストしたbundleが追加されたら停止し、署名順を見直す。
4. 署名を検証し、開発用PATH・AI認証情報のない環境で、同梱NodeのJIT・Codexのバージョン表示・ACP初期化を確認する。ログインやモデル呼び出しは行わない。
5. アプリとApplicationsへのリンクを入れたDMGを作り、署名してAppleへ公証申請する。1回の申請で最大30分待ち、`Accepted` のときだけ公証チケットをDMGへ添付する。
6. チケットとGatekeeperの判定を確認し、DMGを読み取り専用でマウントして、配布されるアプリの署名・Gatekeeper・ランタイムを再確認する。SHA-256を作成する。

成功時にDMGとSHA-256を `Tanzakoo-macos-arm64-<commit SHA>` Artifactへ保存する。保持期間は14日。証明書・秘密鍵・開発用認証情報はArtifactへ含めない。GitHub Releasesの作成、タグ作成、外部への公開、自動更新の実装は行わない。

## 公証の待ち時間と失敗

Appleの初回公証は30分を超える場合がある。タイムアウトや `Invalid` は成功扱いにせず、DMGを配布用Artifactへアップロードしない。`macos-notarization-<run ID>-<attempt>` Artifactに申請結果と、取得できた公証ログを残す。申請IDからApple側の状況を確認し、即座に同じ申請を繰り返さない。

後から `Accepted` になっても、失敗した実行のDMGを自動公開しない。再ビルドする場合も新しいDMGの公証・チケット添付・検証をすべて実行する。公証用JSONは診断専用であり、認証情報の代わりにはならない。

## 検証の限界と配布後の更新

ワークフローを追加しただけでは署名・公証成功を確認したことにならない。初回Actions実行でパスワード、Apple側の権限、同梱物の署名と公証を検証する。GUIの起動、ブラウザ認証、カード保存・会話・MCP・エクスポートは別途Macで操作確認する。特にNodeのJIT権限は同梱Nodeの実行確認と公証結果で検証し、権限を一律に広げて回避しない。

App Sandbox用の設定はDMGビルドで読み込まない。保存先と外部ファイルアクセスは [保存設計](store-storage.md) を参照。初版の更新は新しいDMGからアプリを置き換える形を想定し、自動更新は未実装。

## 参考

- [Apple: Developer ID証明書](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)
- [Apple: macOSソフトウェアの公証](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Tauri: macOS署名・公証](https://v2.tauri.app/distribute/sign/macos/)
- [GitHub: macOSランナーでの証明書の取り込み](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)
