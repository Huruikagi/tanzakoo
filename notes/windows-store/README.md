# Microsoft Store 提出準備

2026-10-01、利用者がPartner Centerで製品名を予約し、正式なPackage identityを提示した。掲載原稿とx64 MSIXの作成手順を用意した。ストアへのアップロード・公開はしていない。

## 予約済みの製品情報

[identity.json](identity.json) は利用者が提示したPartner Center画面の値を保存したもの。認証情報や署名秘密鍵は含まない。

| 項目                                    | 値                                        |
| --------------------------------------- | ----------------------------------------- |
| Package/Identity/Name                   | `Huruikagi.Tanzakoo`                      |
| Package/Identity/Publisher              | `CN=7403B0B0-1D93-4C9F-829F-D1FAF289A523` |
| Package/Properties/PublisherDisplayName | `Huruikagi`                               |
| Package Family Name                     | `Huruikagi.Tanzakoo_022ffcc1y2108`        |
| Microsoft Store ID                      | `9N5N0C7PH483`                            |

Windowsの `PackageFamilyNameFromId` でnameとpublisherから算出したPFNも画面と一致した。別の製品を作る場合は `identity.example.json` をコピーし、その製品のProduct identityの値で明示的に置き換える。MacのBundle IDや任意の名前で代用しない。

正式identityのローカル候補は `.local/windows-store-candidate-20261001/Tanzakoo-1.0.0.0-x64.msix`。MakeAppxの検査、manifestのidentityと全1,434ファイルのハッシュ照合が成功した。未署名であり、Storeや信頼済みのテスト署名によるインストール確認、WACK、最終掲載資料の確定は残る。

MicrosoftはMSIXを推奨し、Store配信時の署名を行う。独自サイトでMSI/EXEをホストする経路より、既存Windows SDKのMakeAppxを使う経路を提出候補にした。新しいnpm依存は不要。[公開の概要](https://learn.microsoft.com/en-us/windows/apps/publish/get-started)、[MSIX署名](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide)

## パッケージの作成

Windows x64、リポジトリ指定のmise環境、Python 3.12以降、Windows SDKのMakeAppxが必要。PowerShellでリポジトリのルートから実行する。

```powershell
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm check
mise exec -- pnpm runtime:stage
$env:TANZAKOO_REVIEW_URL = 'https://review-relay-production-4f29.up.railway.app'
mise exec -- pnpm tauri build --no-bundle --config src-tauri/tauri.runtime.conf.json -- --locked
python scripts/package-windows-store.py --identity notes/windows-store/identity.json --package-version 1.0.0.0 --output .local/windows-store-candidate
```

`1.0.0.0` は初回候補。アプリ本体の `0.1.0` とは別のMSIXパッケージバージョンであり、実際の登録・更新履歴に合わせる。4桁目は0、先頭は1以上。再実行時は新しい出力先を指定する。[パッケージ要件](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)

登録前は `--identity ...` の代わりに `--validation-only` を使える。このパッケージは名前にも `VALIDATION-ONLY` が付き、**提出不可**。正式なStore identityに自動変換されることはない。

出力は未署名の `.msix`、SHA-256、全同梱ファイルのハッシュを記録した `provenance.json`、MakeAppxログ、検査用payload。MakeAppxの意味検証と格納後のハッシュ照合を行う。チェックアウト記録はexeのビルド元を保証しないため、提出時にはクリーンなCIビルドの実行記録も保持する。実機検証に必要な信頼済み署名とStore用の署名は別で、証明書を自動登録する処理は含めない。

## CIで再作成

`.github/workflows/windows-store.yml` は手動実行。既定は検証専用。正式候補を作るときは `validation_only` をオフにし、リポジトリの `notes/windows-store/identity.json` を使用する。identityの内容が不正なら失敗する。Artifactsに出力するだけで、署名・インストール・Storeへの送信は行わない。

## 掲載資料

- `metadata.json`: 日英の説明・特徴・検索語の原稿。AIの外部サービス依存を説明する。
- `review-notes.txt`: 英語の審査手順と `runFullTrust` の用途。バージョン、私的な審査コード、有効期限は提出時に入力する。
- 共通プライバシー・サポート原稿は `../app-store/`。公開先は未確定。
- `mise exec -- node scripts/prepare-store-listing.mjs .local/store-submission-kit` で両ストアの原稿、Macで選定した6枚、公開ページのローカルプレビューをまとめる。出力先は未作成のフォルダを指定する。

Windowsのストア画像にはWindows実機の画面を使う。Desktop画像はPNG、1366×768以上、1枚50MB以下。少なくとも1枚が必要で、日英それぞれの掲載ページに登録する。[Microsoftの画像仕様](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images)

Macの撮影原本やブラウザー用モックをWindows実機画像として流用しない。

## 提出前に残る検証

- 正式identityでインストール、起動、更新、アンインストールを確認する。検証用identityの既存データが移行されるとは扱わない。
- 現在の宣言はWindows 10 build 19041以降のx64。最小OSとクリーンなWindows 11でWebView2の導入要件を確認する。開発PCのWebView2・C++ランタイムが不足依存を隠していないことも確認する。
- インストール済みパッケージでChatGPT接続、審査接続、カード作成・変更案承認、ファイルとフォルダ参照、再起動後の参照、Markdown書き出しを実施する。
- 通知の表示・クリックからの復帰、登録資料の権限、通常版とのデータ領域の違いを確認する。
- Windows App Certification Kitで対象パッケージを検査する。MakeAppx成功やpayloadからの起動は、この検査やStore審査の代わりにはならない。
- Windowsネイティブの日本語・英語スクリーンショットを撮影し、現在のPartner Centerの画像条件と一致させる。
- 公開プライバシーURLとアプリ内導線、年齢レーティング、配信地域、価格、第三者サービスと完全信頼権限の説明を確定する。

`runFullTrust` は同梱Node/Codexの子プロセス、ユーザーが登録した資料、Markdown保存などのデスクトップ機能に必要。通常利用に管理者昇格や常駐Windowsサービスは使わない。[権限の説明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations)

説明は10,000文字、短い説明は1,000文字、特徴は20項目以内・各200文字以内を生成時に検査する。[掲載項目の仕様](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info)
