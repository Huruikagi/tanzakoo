# Mac App Store用パッケージの準備

2026-09-27、利用者の依頼によりStore用の署名・プロビジョニングとpkg作成を準備する。対象はApple Silicon・macOS 26以上、アプリ名Tanzakoo、既存のBundle ID `dev.huruikagi.tanzakoo`。通常DMGを維持する。別アプリのSandbox検証結果は [Mac実機検証記録](macos-distribution.md) にある。

## 現在の状態

Store専用のTauri設定・手動ワークフロー・署名スクリプトを追加した。`app-sandbox` は製品の権限処理、`sandbox-validation` は別名の検証アプリの固定CLIとテスト資材に分離した。Store版には後者を含めない。新しい依存ライブラリは追加せず、既存のTauri・Apple標準ツール・Python標準ライブラリを使う。

2026-09-28、利用者がApp IDと2種類の配布証明書、Mac App Store Connectプロファイルを作成した。テスト用Macは私用機ではないため、秘密鍵・CSR・パスワード付きp12はWindowsで作成した。アプリ用・インストーラー用の公開証明書はApple WWDR G3発行で、p12には同中間証明書も含めた。プロファイルはWindowsでBundle ID・アプリ用証明書・Team ID・配布種別・有効期限の一致を確認済み。CMSの署名をローカルで検証したが、Appleの証明書チェーンの信頼確認はMac署名ランナーに残る。

同日、下記5件の `MAS_*` Actions Secretsの登録を利用者が完了し、Macランナーでp12のパスワード・整合性・キーチェーンへのインポートとプロファイルの一致を確認した。`2cbaf63` から署名済みpkgの生成とローカル署名検証が成功した。その後、App Store Connectへの登録とTestFlightでの確認を進める依頼を受け、利用者がAppレコードを作成した。Apple側の検証・アップロードは下記の別ワークフローで進める。TestFlight実機検証・製品版の審査提出・公開は未実施。

## Apple側の初回作業

1. [Identifiers](https://developer.apple.com/account/resources/identifiers/list) で **App IDs** を追加する。Descriptionは `Tanzakoo`、Bundle IDは **Explicit** / `dev.huruikagi.tanzakoo`。既存の同一IDがあればそれを確認して使う。Sandbox検証用の `.sandbox-test` は使わない。今回、追加のCloud・Push・App Groups等は不要。
2. 自分が管理するWindowsで下記のOpenSSL手順によりCSRを作る。Macで行う場合は「キーチェーンアクセス → 証明書アシスタント → 認証局に証明書を要求」で作成できる。[Certificates](https://developer.apple.com/account/resources/certificates/list) で **Mac App Distribution** と **Mac Installer Distribution** を発行する。既存のDeveloper ID ApplicationはDMG用なので置き換えない。
3. CSRを作った秘密鍵とダウンロードした証明書を、それぞれパスワード付き `.p12` にまとめる。Windowsは下記手順を使い、Macは「自分の証明書」で秘密鍵付きの証明書を書き出す。アプリ用の署名名は `3rd Party Mac Developer Application`（既存の `Apple Distribution` も処理で対応）、pkg用は `3rd Party Mac Developer Installer`。発行元に対応するApple公開中間証明書もp12へ含める。
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

### Windowsでの証明書準備

Git for Windows同梱の `C:\Program Files\Git\usr\bin\openssl.exe` を使用した。秘密鍵とp12はリポジトリの外、自分のWindowsユーザーフォルダー内に保存する。アプリ用は `mac-app`、インストーラー用は `mac-installer` という別の名前と鍵を使う。以下はアプリ用の例。インストーラー用は `$kind` と通称を変更し、同じ保存フォルダーで実行する。

```powershell
$openssl = 'C:\Program Files\Git\usr\bin\openssl.exe'
$signDir = Join-Path $env:USERPROFILE ('Tanzakoo-signing-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $signDir -ErrorAction Stop | Out-Null
$kind = 'mac-app'
$email = Read-Host 'Apple Developerに登録しているメールアドレス'
if (Test-Path "$signDir\$kind.key.pem") { throw '既存の秘密鍵を上書きしないでください' }
& $openssl req -new -newkey rsa:2048 -sha256 `
  -config 'C:\Program Files\Git\usr\ssl\openssl.cnf' `
  -keyout "$signDir\$kind.key.pem" -out "$signDir\$kind.certSigningRequest" `
  -subj "/CN=Tanzakoo Mac App Distribution/emailAddress=$email"
if ($LASTEXITCODE -ne 0) { throw 'CSR作成失敗' }
& $openssl req -in "$signDir\$kind.certSigningRequest" -noout -verify
```

秘密鍵のパスワードはOpenSSLの入力要求へ直接入力する。Appleへアップロードするのは `.certSigningRequest`。発行された証明書を同じフォルダーに `mac-app.cer` / `mac-installer.cer` として保存する。

`openssl x509 -inform DER -in <証明書.cer> -noout -issuer` で発行元を確認し、対応する中間証明書を [Apple PKI](https://www.apple.com/certificateauthority/) から取得する。今回の発行元は両方ともWWDR G3だった。証明書と中間証明書を `openssl x509 -inform DER -in <入力.cer> -out <出力.pem>` でPEMへ変換してから、次を実行する。

```powershell
if (Test-Path "$signDir\$kind.p12") { throw '既存のp12を上書きしないでください' }
& $openssl pkcs12 -export -inkey "$signDir\$kind.key.pem" `
  -in "$signDir\$kind.cert.pem" -certfile "$signDir\AppleWWDRCAG3.pem" `
  -out "$signDir\$kind.p12"
if ($LASTEXITCODE -ne 0) { throw 'p12作成失敗' }
```

最初に秘密鍵のパスワード、続いてp12用のExport Passwordを2回入力する。Actionsの `*_CERTIFICATE_PASSWORD` にはこのExport Passwordを登録する。Windows側はOpenSSLの既定の暗号形式を使う。CIではOpenSSLでパスワードと整合性を確認してから、MacのSecurityツール向けにp12内部の鍵・証明書暗号化を3DES、MACをSHA-1、反復回数を100,000へ変換する。パスワードは環境変数から渡し、復号した鍵は所有者だけがアクセスできる一時ディレクトリー内に置き、変換後に削除する。アプリ自体の署名アルゴリズムを変更する処理ではない。

バイナリーファイルをGitHub Secretへ登録するときは、PowerShellで次のようにBase64を直接クリップボードへ送る。各ファイルのコピーと貼り付けを1件ずつ行い、内容を画面やログへ表示しない。

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$signDir\mac-app.p12")) | Set-Clipboard
```

インストーラーp12と `Tanzakoo.provisionprofile` も同様に行う。パスワード2件はSecret欄へ直接入力する。

## ビルド

ユーザーがpushを依頼し、ワークフローがリモートに反映された後に、Actionsの **macOS Store package** を手動実行する。`build_number` はAppleへ送るたびに増やす数値（初回例 `1`）。`review_access` の既定は有効で、公開仲介URLを組み込む。APIキー・審査用コードは同梱しない。

```sh
gh workflow run macos-store.yml --ref main -f build_number=1 -f review_access=true
```

1. ビルド前にp12のパスワードと整合性をOpenSSLで検証し、一時ファイルを削除する。Frontend・通常Rustテスト・Sandboxの不正bookmark拒否テストを実行する。再試行では署名前に保存したRustキャッシュを利用する。
2. `tauri.runtime.conf.json` と `tauri.appstore.conf.json`、指定build numberをマージしてunsigned `.app` を作る。macOS固有の最低OS・Info.plist設定はTauriが通常通り読み込む。
3. 署名専用ステップで2種類の証明書を一時キーチェーンへ取り込む。署名物・秘密情報はキャッシュしない。終了時にはキーチェーン検索リストを復元し、一時キーチェーンと秘密ファイルを削除する。
4. プロファイルの期限・macOS対象・配布種別・明示App ID・Team ID・証明書の一致を検査する。App ID PrefixはTeam IDと同一とは仮定せず、プロファイルから取得する。親の既存Sandbox権限にアプリ識別子とTeam IDだけを追加する。
5. 元の署名済みプロファイルを `Contents/embedded.provisionprofile` に配置する。親と同じ識別子の専用MCP helperを含め、全Mach-Oを内側から署名する。子プロセスのSandbox継承、Nodeとcode-mode hostだけのJIT権限を維持する。
6. アプリの署名・親の実際のentitlements・Team IDを検証する。`productbuild` でインストーラー用証明書によりpkgを作成し、`pkgutil --check-signature` とSHA-256、ソースコミット等のprovenanceを記録する。

成果物は `Tanzakoo-macos-store-<commit>-<build>` Artifact、保持14日。pkg・SHA-256・provenanceだけを保存する。プロファイルはAppleへの提出に必要なアプリ内のものだけがpkgに含まれる。p12やそのパスワード、デコードしたプロファイル単体はArtifactに含めない。

## App Store Connectへの検証・アップロード

`macos-store-upload.yml` は成功済み `macos-store.yml` のArtifactを取得する。元のワークフロー・リポジトリ・mainブランチ・成功状態を確認し、provenanceのコミット・run・build番号とpkgのSHA-256が一致する場合だけAppleへ送る。再ビルドや再署名は行わない。

認証にはDMG公証で使用しているDeveloper権限のチームキー `APPLE_API_KEY`・`APPLE_API_ISSUER`・`APPLE_API_KEY_CONTENT` を使う。追加のキー発行は不要。秘密鍵はMacランナーの所有者だけが読める一時ディレクトリーへ置き、終了時に削除する。Appleの標準ツール `altool` を使い、新しい依存は追加しない。

```sh
gh workflow run macos-store-upload.yml --ref main -f source_run_id=36342814606 -f mode=validate
gh workflow run macos-store-upload.yml --ref main -f source_run_id=36342814606 -f mode=upload
```

既定の `validate` はAppleによるパッケージ検証のみ。`upload` は検証後に1回だけアップロードする。アップロードがタイムアウト等で失敗した場合、Apple側の受信状態を確認してから再試行する。コマンドの成功とApple側のビルド処理完了は別で、TestFlight画面で処理結果・暗号利用の申告を確認する。テスターへの配布や審査提出を自動では行わない。

2026-09-28、[初回Apple検証](https://github.com/Huruikagi/tanzakoo/actions/runs/36344752076) は既存APIキーで認証できたが、build 1を `90255`（root以外が読めない同梱ファイル）で拒否した。署名後の公開アプリバンドルだけに `a+rX` を適用し、一般ユーザーの読み取り・ディレクトリー通過権限を検査してから署名を再検証するよう修正した。一時キーチェーンや秘密鍵の権限は変更しない。build 1はTestFlight確認には使わない。

## 検証と次段階

2026-09-27、Windowsでプロファイル検証の4テスト（期限・対象OS・配布種別・App ID・Team ID・証明書の不一致等の拒否条件を含む）、Bash構文、マージしたTauri設定のスキーマとYAML構文、Rustの整形、`app-sandbox` / `sandbox-validation` 各featureの `cargo check --locked` を確認した。署名・productbuild・Appleの検証はmacOSと実際の証明書が必要なので、ローカルテストで通過扱いにしない。

2026-09-28、`e1d8284` の [初回Storeビルド](https://github.com/Huruikagi/tanzakoo/actions/runs/36341778499) はFrontend・Rust・Sandboxの検証とStore用アプリの生成を通過したが、p12取り込みで `MAC verification failed during PKCS12 import (wrong password?)` となった。この表示だけではパスワード不一致と暗号形式の互換性を区別できないため、事前のOpenSSL検証と上記のMac互換形式への変換を追加した。使い捨ての証明書で、鍵・証明書・追加のチェーン証明書の保持、誤ったパスワードの拒否、上書き防止、一時鍵の削除を検証する。

同日、`2cbaf638c943313a7889db5a688091431fe65d14` の [再実行](https://github.com/Huruikagi/tanzakoo/actions/runs/36342814606) が成功した。既存のSecretsのまま両p12の事前検証とMac互換変換、キーチェーンへのインポートが成功し、プロファイルの一致、63個のMach-Oとアプリの署名、実際のentitlements・Team ID、`productbuild` と `pkgutil --check-signature` を確認した。生成物は `Tanzakoo_0.1.0_1_aarch64.pkg`（バージョン0.1.0、build 1、Apple Silicon、macOS 26以上、審査用接続有効）。[Artifact](https://github.com/Huruikagi/tanzakoo/actions/runs/36342814606/artifacts/10939698681) にpkg・SHA-256・provenanceを保存した。Artifact ZIPのSHA-256は `c6a1cef5d73649c180efe2714c744b4d8d97b15e7186b1b9eca8df40c8c6cb54`、保持期限は2026-10-12 04:18 JST。これはpkg単体のハッシュではない。

同じソースの [通常CI](https://github.com/Huruikagi/tanzakoo/actions/runs/36342808833) はWindows・macOS・仲介サーバーの全ジョブが成功した。初回Windows CIで発生したテスト終了時の `taskkill` 競合には、子プロセスとパイプの実際の終了を待って判定する修正を `511fced` で追加した。終了を確認できない場合は失敗を維持し、この分岐の3テストと実ACP/MCP検証も通過している。

Store配布署名のpkgは、これまでの直接インストール用DMGとは用途が異なる。署名検証の成功は、そのまま起動して動くことやAppleの受理を保証しない。次段階でApp Store Connectへのアップロードを進めるときに、Appレコード・暗号利用の申告・プライバシー情報・サポートURL・スクリーンショット・英語審査メモを用意し、Appleが処理したビルドをTestFlight等で検証する。暗号利用の申告値は未判断なので `ITSAppUsesNonExemptEncryption` を便宜的に固定しない。

参照元の移動・削除、エクスポートの失敗条件など、Sandbox実機検証で未確認のケースも残る。提出前に必要な確認を終える。審査用接続は、審査期間をカバーする有効期限・残数で別途用意する。

## 参照

- [Tauri: App Store](https://v2.tauri.app/distribute/app-store/)
- [Apple: Register an App ID](https://developer.apple.com/help/account/identifiers/register-an-app-id)
- [Apple: Certificates overview](https://developer.apple.com/help/account/create-certificates/certificates-overview)
- [Apple: Packaging Mac software](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [Apple: Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)
- [Apple: APIキーのaltool・notarytoolでの共用](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool)
- [Apple: Provisioning profilesの内容と識別子](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles)
