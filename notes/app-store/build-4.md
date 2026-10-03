# Mac App Store build 4（作成・検証記録）

2026-10-03、Mac側の提出準備を続ける利用者の依頼に基づき、GitHub Actionsの `macOS Store package` を起動した。バージョン0.1.0、build番号4、審査接続あり。

- ソース: `83949a21b4f46c81be5c975a7aa97c106f04c337`（起動時のGitHub main）。
- [作成run 37108624235](https://github.com/Huruikagi/tanzakoo/actions/runs/37108624235)が成功。フロントエンド22ファイルのテスト、Rustの各テスト群、Sandboxのbookmark異常系テストが成功し、63個のMach-O・アプリ・PKGの署名を検証した。
- 成果物は `Tanzakoo-macos-store-83949a21b4f46c81be5c975a7aa97c106f04c337-4`（artifact ID `11269271105`）。ZIPのSHA-256は `df8e8e3708bbd389074cb7f51e3c59512f0b083f764acfbfc9c1d8c6bcd9083c`。これはPKG単体のハッシュではない。アップロードworkflowで別途PKGのchecksumとprovenanceを照合する。
- [検証・登録run 37109279057](https://github.com/Huruikagi/tanzakoo/actions/runs/37109279057)が成功。`source_run_id=37108624235` / `mode=upload` で、provenance・PKGハッシュ照合、Apple事前検証、アップロードを完了した。App Store Connectでの処理完了・ビルド選択可能状態・暗号化申告はログイン後に確認する。アップロード成功をApp Review合格とは扱わない。
- build 3からのアプリ画面変更は設定画面のプライバシー・サポート導線とその英訳。通常のボード・変更提案・エクスポート画面にはソース上の変更がない。
- Mac実機の選定済み日英6枚は撮影時チェックアウト `6c929b7`。ソース差分は確認したが、撮影した実行ファイルとStore build 4の一致・Store配信版の実機動作は未確認。画像を加工して一致済みとは扱わない。
- 手元の未push差分のアプリ関連部分はWindows DPI宣言とWindowsのテスト片付け修正。Macの新しいUI機能を含む差分ではないため、GitHub上の上記ソースを候補にした。手元の追加コミットはpushしていない。
- 公開ポリシーの日英URLとサポートURLはHTTP 200を確認した。現在の公開サポートはメール案内で、GitHub Issue Formsへの変更は未pushのため未反映。アプリ内URLの変更は不要。
- 掲載原稿と審査手順の版番号をbuild 4向けに更新。審査コード・期限は未入力で、原稿のまま提出しない。Windowsの審査コードをそのまま転用しない。
- App Store Connectのログイン画面を開いた。利用者のログイン待ち。登録済みビルド、掲載情報、価格・配信地域・年齢・プライバシー申告はログイン後に現物を確認する。

App Reviewへの最終提出・公開は、この記録の段階では行っていない。TestFlightの実機確認を見送る従来の判断は維持する。
