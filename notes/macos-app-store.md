# Mac App Store用パッケージの準備

2026-09-27、利用者の依頼によりStore用の署名・プロビジョニングとpkg作成を準備する。対象はApple Silicon・macOS 26以上、アプリ名Tanzakoo、既存のBundle ID `dev.huruikagi.tanzakoo`。通常DMGを維持する。別アプリのSandbox検証結果は [Mac実機検証記録](macos-distribution.md) にある。

## 現在の状態

Store専用のTauri設定・手動ワークフロー・署名スクリプトを追加した。`app-sandbox` は製品の権限処理、`sandbox-validation` は別名の検証アプリの固定CLIとテスト資材に分離した。Store版には後者を含めない。新しい依存ライブラリは追加せず、既存のTauri・Apple標準ツール・Python標準ライブラリを使う。

利用者からStore用のApp ID・証明書・プロファイルはまだ未作成との回答を受けた。署名済みpkgの生成・Apple側の検証は未実行。ワークフローは成果物をGitHub Actionsに保存するところまでで、App Store Connectへのアップロード・TestFlight配布・審査提出・公開は行わない。

## Apple側の初回作業

1. [Identifiers](https://developer.apple.com/account/resources/identifiers/list) で **App IDs** を追加する。Descriptionは `Tanzakoo`、Bundle IDは **Explicit** / `dev.huruikagi.tanzakoo`。既存の同一IDがあればそれを確認して使う。Sandbox検証用の `.sandbox-test` は使わない。今回、追加のCloud・Push・App Groups等は不要。
2. Macの「キーチェーンアクセス → 証明書アシスタント → 認証局に証明書を要求」でCSRをディスクに保存する。秘密鍵はそのMacに保持する。[Certificates](https://developer.apple.com/account/resources/certificates/list) で **Mac App Distribution** と **Mac Installer Distribution** を発行する。既存のDeveloper ID ApplicationはDMG用なので置き換えない。
3. ダウンロードした証明書をCSRを作ったMacへ取り込む。「自分の証明書」で秘密鍵が付いていることを確認し、それぞれパスワード付き `.p12` として書き出す。アプリ用の署名名は `3rd Party Mac Developer Application`（既存の `Apple Distribution` も処理で対応）、pkg用は `3rd Party Mac Developer Installer`。証明書チェーンが有効であることを確認する。CIで中間証明書不足になる場合は該当するApple公開中間証明書もp12へ含める。
4. [Profiles](https://developer.apple.com/account/resources/profiles/list) で **Mac App Store Connect** の配布用プロファイルを作る。上記App IDとアプリ用の配布証明書を選び、`.provisionprofile` をダウンロードする。開発用・Developer ID用のプロファイルは使わない。
5. 以下のActions Secretsをリポジトリへ設定する。DMG用の既存 `APPLE_*` Secretsは変更しない。

| Secret                               | 内容                            |
| ------------------------------------ | ------------------------------- |
| `MAS_APP_CERTIFICATE`                | アプリ署名用p12のBase64         |
| `MAS_APP_CERTIFICATE_PASSWORD`       | そのp12の書き出しパスワード     |
| `MAS_INSTALLER_CERTIFICATE`          | インストーラー署名用p12のBase64 |
| `MAS_INSTALLER_CERTIFICATE_PASSWORD` | そのp12の書き出しパスワード     |
| `MAS_PROVISION_PROFILE`              | 配布用provisionprofileのBase64  |

MacでファイルをBase64にしてクリップボードへ送る例：

```sh
base64 -i /path/to/file.p12 | tr -d '\n' | pbcopy
```

プロファイルも同様。値は該当するGitHub Secret欄へ直接貼り付ける。チャット・コミット・実行ログへ貼らない。p12・秘密鍵・プロファイルはGitの除外対象。

## ビルド

ユーザーがpushを依頼し、ワークフローがリモートに反映された後に、Actionsの **macOS Store package** を手動実行する。`build_number` はAppleへ送るたびに増やす数値（初回例 `1`）。`review_access` の既定は有効で、公開仲介URLを組み込む。APIキー・審査用コードは同梱しない。

```sh
gh workflow run macos-store.yml --ref main -f build_number=1 -f review_access=true
```

1. Frontend・通常Rustテスト・Sandboxの不正bookmark拒否テストを実行する。
2. `tauri.runtime.conf.json` と `tauri.appstore.conf.json`、指定build numberをマージしてunsigned `.app` を作る。macOS固有の最低OS・Info.plist設定はTauriが通常通り読み込む。
3. 署名専用ステップで2種類の証明書を一時キーチェーンへ取り込む。署名物・秘密情報はキャッシュしない。終了時にはキーチェーン検索リストを復元し、一時キーチェーンと秘密ファイルを削除する。
4. プロファイルの期限・macOS対象・配布種別・明示App ID・Team ID・証明書の一致を検査する。App ID PrefixはTeam IDと同一とは仮定せず、プロファイルから取得する。親の既存Sandbox権限にアプリ識別子とTeam IDだけを追加する。
5. 元の署名済みプロファイルを `Contents/embedded.provisionprofile` に配置する。親と同じ識別子の専用MCP helperを含め、全Mach-Oを内側から署名する。子プロセスのSandbox継承、Nodeとcode-mode hostだけのJIT権限を維持する。
6. アプリの署名・親の実際のentitlements・Team IDを検証する。`productbuild` でインストーラー用証明書によりpkgを作成し、`pkgutil --check-signature` とSHA-256、ソースコミット等のprovenanceを記録する。

成果物は `Tanzakoo-macos-store-<commit>-<build>` Artifact、保持14日。pkg・SHA-256・provenanceだけを保存する。プロファイルはAppleへの提出に必要なアプリ内のものだけがpkgに含まれる。p12やそのパスワード、デコードしたプロファイル単体はArtifactに含めない。

## 検証と次段階

2026-09-27、Windowsでプロファイル検証の4テスト（期限・対象OS・配布種別・App ID・Team ID・証明書の不一致等の拒否条件を含む）、Bash構文、マージしたTauri設定のスキーマとYAML構文、Rustの整形、`app-sandbox` / `sandbox-validation` 各featureの `cargo check --locked` を確認した。署名・productbuild・Appleの検証はmacOSと実際の証明書が必要なので、ローカルテストで通過扱いにしない。

Store配布署名のpkgは、これまでの直接インストール用DMGとは用途が異なる。署名検証の成功は、そのまま起動して動くことやAppleの受理を保証しない。次段階でApp Store Connectへのアップロードを進めるときに、Appレコード・暗号利用の申告・プライバシー情報・サポートURL・スクリーンショット・英語審査メモを用意し、Appleが処理したビルドをTestFlight等で検証する。暗号利用の申告値は未判断なので `ITSAppUsesNonExemptEncryption` を便宜的に固定しない。

参照元の移動・削除、エクスポートの失敗条件など、Sandbox実機検証で未確認のケースも残る。提出前に必要な確認を終える。審査用接続は、審査期間をカバーする有効期限・残数で別途用意する。

## 参照

- [Tauri: App Store](https://v2.tauri.app/distribute/app-store/)
- [Apple: Register an App ID](https://developer.apple.com/help/account/identifiers/register-an-app-id)
- [Apple: Certificates overview](https://developer.apple.com/help/account/create-certificates/certificates-overview)
- [Apple: Packaging Mac software](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [Apple: Provisioning profilesの内容と識別子](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles)
