# Mac App Store 掲載資料

準備日: 2026-09-28。対象はアップロード済みの **0.1.0 (2)**、ソース `2a5adab1365b2c239106af71662045442ff33180`。公開・審査提出はまだ行っていない。

## 入力する資料

MacにCodexを入れずに撮影できる [実機撮影用の半自動スクリプト](screenshots/mac-capture.md) も用意した。画面の準備は手動、撮影と寸法検査は自動。Macでの初回動作確認は未完了。

| 項目                                               | 原稿・素材                                                                      | 状態                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 日本語・英語の名称、サブタイトル、説明、キーワード | [metadata.json](metadata.json)                                                  | build 2 の機能に合わせた入力用原稿                       |
| スクリーンショット                                 | [撮影手順と構図案](screenshots/README.md)                                       | ブラウザー構図案。提出用のMac実機撮影は未完了            |
| Appのプライバシー                                  | [申告の整理](privacy-assessment.md)                                             | 送信・保存の実装調査済み。外部サービスの未確認項目が残る |
| プライバシーポリシー                               | [日本語](privacy-ja.md) / [English](privacy-en.md)                              | 公開用原稿。公開URL未作成                                |
| サポートページ                                     | [日英原稿](support.md)                                                          | 公開連絡先は `huruikagi@gmail.com`。公開URL未作成        |
| 審査メモ                                           | [英文入力用原稿](review-notes.txt) / [詳細な確認手順](../store-review-notes.md) | コード・期限・個人の審査連絡先は非公開欄に入力           |

`metadata.json` の `description` は改行を含むプレーンテキスト。JSON全体ではなく、各フィールドの値を対応する欄に貼る。カテゴリ案は「仕事効率化 / Productivity」。マーケティングURLは任意のため、未作成のURLを入力しない。価格は既存方針どおり無料だが、外部AIサービスの利用条件は別である。

現時点のHEADにあるカード間リンク機能はbuild 2に含まれないため、この原稿には記載しない。ビルドを更新した場合は原稿・画像との一致を再確認する。

## 提出前に残る作業

1. プライバシー・サポートの原稿を確認し、ログイン不要のHTTPSページとして公開する。公開先は未決定。ポリシーのデータ保持方針と外部サービスの扱いは [申告の整理](privacy-assessment.md) の未確認点を解消してから確定する。
2. 公開URLをApp Store Connectへ入力する。アプリ内にもプライバシーポリシーへのリンクが必要。build 2の設定画面にはリンクがなく、URL確定後に実装・新しいビルドの署名とアップロードが必要になる。
3. 最終提出ビルドでMac実機画像を撮影する。構図案PNGをそのまま提出しない。
4. プライバシー申告の未確認項目を解消し、年齢制限等の残りのApp Store Connect質問に実際の挙動に基づいて回答する。権利者・Copyright表記、審査担当者名・電話番号も実情報を入力する。
5. 有効な審査コード、期限・残数、接続動作を提出直前に確認する。コードはリポジトリ・公開ページ・画像に含めない。審査と追確認の間は接続を維持する。
6. フランスを配信対象から外す。暗号化質問への「いいえ」だけでは配信地域は変更されない。

利用者は暗号利用の質問に回答し、App Store Connectで「提出準備完了」になったと報告した。借用Macに個人のApple Accountでログインしないため、TestFlight経由のインストール・起動確認は今回は見送る判断。従来のSandbox版で行った確認を、Store配信ビルドの実機確認済みとは扱わない。

## 仕様の参照

今回の確認: 日英の各入力欄は上限以内（説明725 / 1,458文字、キーワード77 / 70 UTF-8 bytes、英文審査メモ2,694文字）。構図案6枚は1440×900、アルファなしのPNGで、ブラウザー例外・ページ全体の横はみ出しなし。6枚を目視し、撮影スクリプトのLint、資料の整形とローカルリンクも確認した。ネイティブ実機の確認ではない。

2026-09-28に確認。説明4,000文字、プロモーション170文字、名称・サブタイトル30文字、キーワード100 bytes以内を検査する。

- [Apple: Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
- [Apple: App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)
- [Apple: Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Apple: App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) — 正確なメタデータ、使用中の画面、アプリ内ポリシーリンク。
