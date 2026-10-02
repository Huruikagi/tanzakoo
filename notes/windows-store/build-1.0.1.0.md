# Windows MSIX 1.0.1.0の作成・検証

2026-10-02、利用者の依頼に基づき、設定画面の公開プライバシーポリシー・サポートへのリンクを含む差し替えパッケージを作成した。アプリ本体のバージョンは0.1.0、MSIXは1.0.1.0。

## 作成元

- ソース: `860a2a737fcd18334bfd6502e79a3d1dc51f66f5`。このWindows PCでローカルビルドした。
- 出力: `.local/windows-store-candidate-20261002/Tanzakoo-1.0.1.0-x64.msix`（205,812,446 bytes）。
- MSIX SHA-256: `bb43779d7c55516c473c2ed3fe432844416a1ae57c4c9748139faab49a922afa`。
- 同梱exe SHA-256: `98f86e993a3d13e6230f54bda2e39ffe809cb7578ebadfabc852a126a39f235f`。
- 正式な `Huruikagi.Tanzakoo` identity、Windows.Desktop x64、最低OS 10.0.19041.0。審査接続先は既存のRailway URL。
- 同梱ランタイムを再ステージし、Node 24.21.0、Codex ACP 1.13.1、Codex 0.156.1を収録。
- 作成先にMakeAppxログ、全payloadのハッシュを含む `provenance.json`、ビルド・テストログと `build-verification.json` を保存した。

ビルド開始時はクリーン。並行実施したRustテストの型出力によって `src/bindings/Snapshot.ts` に末尾空白1文字が付き、パッケージ記録の `dirty` はtrueになった。差分は同じ出力先に記録し、元へ戻した。意味のあるソース変更はない。パッケージ記録のチェックアウトだけをビルド元の証明として扱わない。

## 検証結果

- `pnpm check`: lint・整形・フロントエンド134テスト・ビルド成功。
- `cargo test --locked`: 121成功、実Claude接続の1件は既定どおりignored。
- `scripts/test_windows_store.py`: 6成功。`pnpm test:plan`: 6成功。
- releaseビルド、MakeAppx検査、MSIXに格納された1,434ファイルのSHA-256照合が成功。
- 展開したpayloadのexeを隔離データ領域で起動し、設定にPrivacy Policy / Supportが表示されることを実画面で確認。両ボタンから標準ブラウザーに英語ポリシー・サポートページが開いた。
- 公開されている日本語ポリシー・英語ポリシー・サポートページの本文もブラウザーで確認した。

これはMSIXとしてインストールした状態の検証やWindows App Certification Kitの結果ではない。正式なインストール・更新・アンインストール、AI接続等の実機検証、掲載画像との比較は残る。

## Partner Center

新パッケージをアップロードし、保存によって1.0.0.0を1.0.1.0に置き換えた。申請概要に `Tanzakoo-1.0.1.0-x64.msix` / `Validated` / 完了が表示されたことを確認した。従来と同じ `runFullTrust` の承認が必要という警告はあるが、新たな受領検証エラーはない。審査提出・公開は行っていない。

アップロード元タブでは100% / Analyzing packageの表示が残り、Saveが無効だった。元タブを中断せず別タブで同じパッケージページを開くと、新版が受領済みでSaveが有効だったため、そちらで保存した。保存後に元タブも申請概要へ更新した。再アップロードはしていない。
