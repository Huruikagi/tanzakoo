# Tanzakoo 公開ページ

公開先は <https://huruikagi.github.io/tanzakoo/>。Mac App StoreとMicrosoft Storeで同じサポート・プライバシーポリシーを使う。

| 用途                   | URL                                                    |
| ---------------------- | ------------------------------------------------------ |
| サポート（日英）       | <https://huruikagi.github.io/tanzakoo/support.html>    |
| プライバシー（日本語） | <https://huruikagi.github.io/tanzakoo/privacy-ja.html> |
| プライバシー（英語）   | <https://huruikagi.github.io/tanzakoo/privacy-en.html> |

## 原稿と更新

- 案内: `site/index.md`
- プライバシー: `notes/app-store/privacy-ja.md` / `privacy-en.md`
- サポート: `notes/app-store/support.md`
- 見た目: `site/style.css`、共通レンダラー: `scripts/store-site.mjs`

この4ページ、CSS、`.nojekyll`だけを生成する。内部の申告検討、審査メモ、審査コード、スクリーンショット原本はサイトの生成対象にしない。アクセス解析・外部フォント・フォーム・ブラウザー内のスクリプトは使用しない。GitHub自身のアクセスログはポリシーに記載する。

```powershell
mise exec -- node scripts/build-store-site.mjs .local/public-site
python -m http.server 8766 --bind 127.0.0.1 --directory .local/public-site
```

出力先は未作成のフォルダを指定する。生成前に公開前原稿の注記を検査し、残っていれば失敗する。再生成は別の出力先で行い、古いファイルを混ぜない。確認用の提出資料生成も同じ原稿・レンダラーを使う。

## 配信

GitHubのSettings → PagesのSourceを **GitHub Actions** に設定する。`.github/workflows/pages.yml` がmainの関連ファイル更新または手動実行で生成・配信する。リポジトリ全体をアップロードせず、生成フォルダだけをPages artifactに含める。独自ドメイン・追加の秘密情報は不要。

2026-10-01、PagesをActions方式・HTTPS有効で設定。利用者が審査用利用記録の必要期間のみの保持と不要後の手動削除を承認した。外部サービスの保持期間や削除を独自に保証しない。ストア申告の未確認項目は `notes/app-store/privacy-assessment.md` に残す。

アプリ内の設定から、現在の表示言語のポリシーと日英サポートを標準ブラウザーで開く。Tauri公式opener（MIT OR Apache-2.0）を使用し、capabilityで3つの固定HTTPS URLだけを許可する。既存Tauri 2.11を維持するためRust側はopener 2.5.3、JS側は2.5.5を使う。ネイティブのリンク動作は、次の署名済みMac・Windowsパッケージで確認する。
