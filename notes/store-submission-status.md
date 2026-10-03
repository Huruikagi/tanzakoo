# ストア提出準備の状況

最新状態（2026-10-03）: **Windows MSIX 1.0.2.0を認定へ送信済み**。Partner Centerで「認定中」、申請完了・前処理中（手順2/4）への遷移を確認した。無料・フランス以外の239市場で、認定合格後すぐに公開を開始する設定。現時点で認定合格・ストア公開は未確認。**Macは0.1.0 (4)の作成・署名・Apple事前検証・アップロードが成功**。App Store Connectへのログイン待ちで、処理完了・掲載情報の登録と人の審査への提出は未完了。[Mac build 4の記録](app-store/build-4.md)を優先する。以下は各時点の作業履歴。

2026-10-01の作業記録。MacとWindowsの審査提出・ストア公開は未実施。

2026-10-02追記: Windowsは日英各3枚の画像・掲載原稿を登録済み。設定から公開ポリシー・サポートを開くリンクを含むMSIX **1.0.1.0**を作成し、Partner Centerで旧版から差し替え、`Validated`を確認した。[最新のWindows検証記録](windows-store/build-1.0.1.0.md)を優先する。以下は2026-10-01時点の記録であり、Windowsの登録・撮影・パッケージ更新の未完了記述は更新前の状態。

2026-10-02追加: Windows提出専用の審査コードを発行し、同1.0.1.0で実APIへの接続・カード作成・未承認提案・UIでの適用を確認した。コードはPartner Centerの非公開Credentialsへ、英語手順はAdditional Testing Infoの説明欄へ保存し、再読み込みで保持を確認。有効期限は2026-11-01 09:06:23 UTC。インストール後の追加検証を終えた時点の残量は279 API試行。

2026-10-02実機検証: 正式identityのMSIXをテスト署名してインストールし、審査接続・参照資料読み取り・カード作成・提案適用・Markdown出力・アプリ再起動後の保持と資料追記の読み取り・アンインストールが成功した。WACKの全検査は完了したが総合 **WARNING**（22 PASS、任意のブロック済み実行可能ファイル検査1 FAIL、必須のDPI検査1 WARNING）。一時証明書と秘密鍵は削除済み。DPI宣言の改善と再検証、最小OS・クリーン環境、旧版からの更新等は残る。詳細は[最新のWindows検証記録](windows-store/build-1.0.1.0.md)を参照。審査提出は未実施。

2026-10-02 DPI対応: EXEのDPI宣言を追加し、MSIX **1.0.2.0**を新規作成した。releaseビルド、埋め込みマニフェスト、パッケージ検査は成功。WACK再実行はUAC取消で開始されず、警告解消は未確認。テスト秘密鍵は削除済み。Partner Centerは1.0.1.0のままで、新版のアップロード・審査送信はしていない。[DPI修正版の記録](windows-store/build-1.0.2.0.md)を参照。

2026-10-03再検証: UAC承認後、1.0.2.0のインストールとWACK全検査を完了。総合WARNING（22 PASS・任意1 FAIL・必須DPI検査1 WARNING）。DPI検査はWACK内部のマニフェスト判定でCOM E_FAILとなっていた。一方、インストール済みEXEの宣言と、Windows APIによる実行中の **Per-Monitor V2** を確認した。警告そのものは未解消で、全検査合格とは扱わない。検証用MSIXはアンインストール済み、一時信頼登録・秘密鍵も残っていない。Partner Centerへの差し替えは未実施。

2026-10-03登録更新: 利用者の依頼でPartner CenterのMSIXを **1.0.2.0** に差し替え、保存後の概要で `Validated`・パッケージ「完了」を確認した。審査メモにも新版番号、実行時のPer-Monitor V2確認、WACKの未解消警告を保存し、再読み込みで全文一致を確認。既存の審査コードは有効で残量279 API試行、期限は2026-11-01 09:06:23 UTC。申請は下書きのままで、認定への送信は未実施。価格・年齢区分の完了状態は提出前の最終照合に残る。[最新のWindows登録記録](windows-store/build-1.0.2.0.md)を参照。

2026-10-03設定照合: 価格の詳細画面でJPY 0、市場別の全240行も0と確認した。配信先は全世界（フランスを含む）、一般公開・検索可能、リリース「できるだけ早く」。年齢別レーティングの詳細ではMicrosoft/IARC 12+、ESRB T等を取得済みと確認した。質問票は読み取りのみで変更なし。Windowsでもフランスを除外するか利用者に確認中。[設定照合の記録](windows-store/settings-check-20261003.md)を参照。審査未送信。

2026-10-03市場変更: 利用者の指示でWindowsのフランス配信を除外して保存した。設定を開き直し、239市場が選択済み、フランスだけ未選択、基本価格JPY 0であることを確認した。年齢区分は変更なし。審査未送信。

2026-10-03認定送信: 利用者の継続依頼に基づきSubmission 1を送信した。追加の入力エラーは表示されず、Partner Centerの状態が「下書き段階」から「認定中」へ変わった。画面証跡は `.local/windows-dpi-validation-20261002/partner-submitted-20261003.png`。審査用relayとコードは認定・追加確認に備えて維持する。結果は未確定で、WACKの未解消警告に関する説明は審査メモに保存済み。

## Mac

- 2026-10-03、公開ポリシー・サポートへのアプリ内リンクを含むソース `83949a2` からbuild 4の作成を開始。掲載原稿と審査メモの版番号も更新した。選定画像の画面について、撮影時チェックアウトからのソース差分を確認した。実行ファイルとの一致確認やStore配信版の実機検証を済ませたとは扱わない。
- ソース `6c929b76907a017acc8bfcfdfdad49a22145954f` から **0.1.0 (3)** のMac App Store用PKGを作成した。[作成run 36746301459](https://github.com/Huruikagi/tanzakoo/actions/runs/36746301459)
- フロントエンド検査、Rustのテスト、Sandboxのbookmark異常系テストが成功。63個のMach-O、アプリ、PKGの署名を検証した。
- 利用者の許可を受け、Appleへの機械的な事前検証を実施し、成功した。[検証run 36781032548](https://github.com/Huruikagi/tanzakoo/actions/runs/36781032548)。`mode=validate` のみで、build 3の登録アップロード・人のApp Review・ストア公開はしていない。
- 日英の画像6枚を選定した。日本語の変更提案は撮り直し版を採用。原本とSHA-256は保持している。最終提出ビルドとの画面一致は未確認。
- 従来のbuild 2には新しいChatGPT認証などが含まれないため、更新した掲載原稿とそのまま組み合わせない。

## Windows

- 利用者がPartner Centerで製品名を予約した。正式なPackage identityとStore IDは `windows-store/identity.json` / `metadata.json` に保存済み。Windows算出のPFNと提示された値の一致も確認した。
- x64 release本体と同梱ランタイムから、検証用の未署名MSIXを作成した。MakeAppxの検査と1,434ファイルの格納内容照合が成功。
- 予約済みidentityでも `1.0.0.0` の未署名MSIXを作成し、manifestのname/publisher、x64、全1,434ファイルの一致を確認した。出力は `.local/windows-store-candidate-20261001/Tanzakoo-1.0.0.0-x64.msix`。インストール・WACK・Store審査は未確認。
- 開発用PATHを外してpayloadから接続確認を実行し、`authRequired` / `canLogin:true` を確認した。これはMSIXインストール後の確認ではない。
- パッケージ検査6件、ChatGPT認証6件、relay11件、ACPと実ボードツールの呼び出し10件が成功。
- 手動の作成workflowと、正式identityを入力するテンプレートを用意した。検証用identityのパッケージは提出不可。
- 本体・Node・Codex・code-mode hostの直接DLL依存を確認した。追加のVisual C++ DLL依存は見当たらない。クリーン環境のWebView2、最小OS、インストール後の動作は引き続き実機検証が必要。

## 資料と生成物

日英の説明文、英語の審査メモ、認証・通知を反映したプライバシーポリシーとサポートを更新した。2026-10-01、共通のGitHub Pages公開先を設定し、必要期間の保持と不要後の手動削除を利用者が承認した。設定から標準ブラウザーでページを開くため、Tauri公式openerを追加した。[公開・更新手順](../site/README.md)を参照。

```powershell
mise exec -- node scripts/prepare-store-listing.mjs .local/store-submission-kit
```

新規フォルダへ入力欄別テキスト、Mac画像6枚、画像の対応表、公開ページの確認用HTML、`readiness.json` を生成する。原稿の文字数と画像ハッシュを検査する。生成物は `.local/` に置き、原稿と生成スクリプトをGitに保存する。

詳細は [Mac掲載資料](app-store/README.md)、[Windowsの手順](windows-store/README.md)、[プライバシー申告案](app-store/privacy-assessment.md) を参照。

## 帰席後に必要な判断・操作

1. Windowsの登録・名前予約は完了。Partner Centerで提出用の新しい申請を作り、残りの登録項目を確認する。
2. プライバシー・サポートの公開URLと設定画面のリンクを含む、新しい署名済みビルドを作る。既存のMac build 3・Windows MSIXにはリンクが含まれていない。
3. MacのStore配信候補、Windowsの正式identityによるインストールを実機で確認する。WindowsではWACK検査・通知・再起動後の参照・更新も確認し、Windowsネイティブの画像を撮影する。
4. 最終ビルドと画像、プライバシー申告、年齢レーティング、無料価格・配信地域を照合する。Macのフランス除外は配信地域で設定する。
5. 私的な審査連絡先と有効な審査コードを提出画面へ入力し、審査開始・公開の最終判断を行う。

審査サーバーの `/health` は作業中に `status:ok` を返した。これは審査コードの期限・残数やAIのライブ応答を保証するものではない。提出直前に確認する。
