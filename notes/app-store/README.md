# Mac App Store 掲載資料

更新日: 2026-10-01。原稿はソース `6c929b76907a017acc8bfcfdfdad49a22145954f` の機能に更新した。以前アップロードした **0.1.0 (2)** (`2a5adab`) には新しいChatGPT認証・カード間リンク・通知などが含まれないため、そのまま新原稿と組み合わせない。公開・審査提出はまだ行っていない。

## 入力する資料

MacにCodexを入れずに撮影できる [実機撮影用の半自動スクリプト](screenshots/mac-capture.md) も用意した。画面の準備は手動、撮影と寸法検査は自動。2026-10-01に利用者のMacで撮影した [日英6枚と確認記録](screenshots/native/README.md) を保存した。撮影原本はローカル起動版で、上記build 2との一致を示すものではない。

| 項目                                               | 原稿・素材                                                                      | 状態                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 日本語・英語の名称、サブタイトル、説明、キーワード | [metadata.json](metadata.json)                                                  | 現在のChatGPT接続・カード間リンクを反映した原稿                         |
| スクリーンショット                                 | [実機撮影原本と確認記録](screenshots/native/README.md)                          | 日英6枚を選定。日本語変更提案は再撮影済み。提出ビルドとの一致確認が残る |
| Appのプライバシー                                  | [申告の整理](privacy-assessment.md)                                             | 送信・保存の実装調査済み。外部サービスの未確認項目が残る                |
| プライバシーポリシー                               | [日本語](privacy-ja.md) / [English](privacy-en.md)                              | 公開用原稿。公開URL未作成                                               |
| サポートページ                                     | [日英原稿](support.md)                                                          | 公開連絡先は `huruikagi@gmail.com`。公開URL未作成                       |
| 審査メモ                                           | [英文入力用原稿](review-notes.txt) / [詳細な確認手順](../store-review-notes.md) | コード・期限・個人の審査連絡先は非公開欄に入力                          |

`metadata.json` の `description` は改行を含むプレーンテキスト。JSON全体ではなく、各フィールドの値を対応する欄に貼る。カテゴリ案は「仕事効率化 / Productivity」。マーケティングURLは任意のため、未作成のURLを入力しない。価格は既存方針どおり無料だが、外部AIサービスの利用条件は別である。

最終ビルド番号は未確定のため `metadata.json` の `build` は `null`。審査メモにも最終バージョン・ビルドの入力欄を残している。

## 提出前に残る作業

1. プライバシー・サポートの原稿を確認し、ログイン不要のHTTPSページとして公開する。公開先は未決定。ポリシーのデータ保持方針と外部サービスの扱いは [申告の整理](privacy-assessment.md) の未確認点を解消してから確定する。
2. 公開URLをApp Store Connectへ入力する。アプリ内にもプライバシーポリシーへのリンクが必要。現在の設定画面には公開URLへのリンクがなく、URL確定後に実装・新しいビルドの署名とアップロードが必要になる。
3. 日本語変更提案の再撮影版を含む、選定済みの日英6枚を最終提出ビルドと照合する。表示が異なる画像は撮り直す。構図案PNGをそのまま提出しない。
4. プライバシー申告の未確認項目を解消し、年齢制限等の残りのApp Store Connect質問に実際の挙動に基づいて回答する。権利者・Copyright表記、審査担当者名・電話番号も実情報を入力する。
5. 有効な審査コード、期限・残数、接続動作を提出直前に確認する。コードはリポジトリ・公開ページ・画像に含めない。審査と追確認の間は接続を維持する。
6. フランスを配信対象から外す。暗号化質問への「いいえ」だけでは配信地域は変更されない。

利用者は暗号利用の質問に回答し、App Store Connectで「提出準備完了」になったと報告した。借用Macに個人のApple Accountでログインしないため、TestFlight経由のインストール・起動確認は今回は見送る判断。従来のSandbox版で行った確認を、Store配信ビルドの実機確認済みとは扱わない。

## 仕様の参照

現行原稿は生成スクリプトで文字数を検査する。2026-10-01の結果は説明794 / 1,620文字、キーワード77 / 70 UTF-8 bytes。原本6枚のSHA-256を撮影manifestと照合する。最終提出ビルドとの一致や実機動作を自動で認定する処理ではない。

2026-09-28に確認。説明4,000文字、プロモーション170文字、名称・サブタイトル30文字、キーワード100 bytes以内を検査する。

- [Apple: Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
- [Apple: App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)
- [Apple: Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Apple: App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) — 正確なメタデータ、使用中の画面、アプリ内ポリシーリンク。

## 両ストアの提出資料をまとめる

```powershell
mise exec -- node scripts/prepare-store-listing.mjs .local/store-submission-kit
```

新規出力先に日英の入力欄ごとのテキスト、Mac画像6枚、原本との対応表、公開ページの確認用HTML、未完了事項の `readiness.json` を生成する。HTMLは未公開・noindexで、公開先や保持運用の承認を代行しない。Windows側の手順は [Microsoft Store準備](../windows-store/README.md) を参照する。

## 現在の署名済み候補

ソース `6c929b7` から **0.1.0 (3)** の署名済みPKGを作成し、Appleの事前検証に成功した。[作成run](https://github.com/Huruikagi/tanzakoo/actions/runs/36746301459)、[検証run](https://github.com/Huruikagi/tanzakoo/actions/runs/36781032548)。検証のみでbuild 3の登録アップロードや人の審査は行っていない。公開ポリシーへのアプリ内導線など、最終ビルドに向けた残作業は上記のとおり。
