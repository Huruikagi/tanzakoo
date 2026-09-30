# ストア提出準備の状況

2026-10-01の作業記録。MacとWindowsの審査提出・ストア公開は未実施。

## Mac

- ソース `6c929b76907a017acc8bfcfdfdad49a22145954f` から **0.1.0 (3)** のMac App Store用PKGを作成した。[作成run 36746301459](https://github.com/Huruikagi/tanzakoo/actions/runs/36746301459)
- フロントエンド検査、Rustのテスト、Sandboxのbookmark異常系テストが成功。63個のMach-O、アプリ、PKGの署名を検証した。
- 利用者の許可を受け、Appleへの機械的な事前検証を実施し、成功した。[検証run 36781032548](https://github.com/Huruikagi/tanzakoo/actions/runs/36781032548)。`mode=validate` のみで、build 3の登録アップロード・人のApp Review・ストア公開はしていない。
- 日英の画像6枚を選定した。日本語の変更提案は撮り直し版を採用。原本とSHA-256は保持している。最終提出ビルドとの画面一致は未確認。
- 従来のbuild 2には新しいChatGPT認証などが含まれないため、更新した掲載原稿とそのまま組み合わせない。

## Windows

- Partner Centerの開発者登録・アプリ名予約はまだ。正式なPackage identityは未取得。
- x64 release本体と同梱ランタイムから、検証用の未署名MSIXを作成した。MakeAppxの検査と1,434ファイルの格納内容照合が成功。
- 開発用PATHを外してpayloadから接続確認を実行し、`authRequired` / `canLogin:true` を確認した。これはMSIXインストール後の確認ではない。
- パッケージ検査6件、ChatGPT認証6件、relay11件、ACPと実ボードツールの呼び出し10件が成功。
- 手動の作成workflowと、正式identityを入力するテンプレートを用意した。検証用identityのパッケージは提出不可。
- 本体・Node・Codex・code-mode hostの直接DLL依存を確認した。追加のVisual C++ DLL依存は見当たらない。クリーン環境のWebView2、最小OS、インストール後の動作は引き続き実機検証が必要。

## 資料と生成物

日英の説明文、英語の審査メモ、認証・通知を反映したプライバシー原稿とサポート原稿を更新した。新しい依存関係は追加していない。

```powershell
mise exec -- node scripts/prepare-store-listing.mjs .local/store-submission-kit
```

新規フォルダへ入力欄別テキスト、Mac画像6枚、画像の対応表、公開ページの確認用HTML、`readiness.json` を生成する。原稿の文字数と画像ハッシュを検査する。生成物は `.local/` に置き、原稿と生成スクリプトをGitに保存する。

詳細は [Mac掲載資料](app-store/README.md)、[Windowsの手順](windows-store/README.md)、[プライバシー申告案](app-store/privacy-assessment.md) を参照。

## 帰席後に必要な判断・操作

1. Windowsの開発者登録・名前予約を行い、正確なidentityを取得する。
2. 共通のプライバシー・サポート原稿と保持運用を確定し、ログイン不要のHTTPS公開先を決める。公開URLへのアプリ内リンクを追加して最終ビルドを作る。
3. MacのStore配信候補、Windowsの正式identityによるインストールを実機で確認する。WindowsではWACK検査・通知・再起動後の参照・更新も確認し、Windowsネイティブの画像を撮影する。
4. 最終ビルドと画像、プライバシー申告、年齢レーティング、無料価格・配信地域を照合する。Macのフランス除外は配信地域で設定する。
5. 私的な審査連絡先と有効な審査コードを提出画面へ入力し、審査開始・公開の最終判断を行う。

審査サーバーの `/health` は作業中に `status:ok` を返した。これは審査コードの期限・残数やAIのライブ応答を保証するものではない。提出直前に確認する。
