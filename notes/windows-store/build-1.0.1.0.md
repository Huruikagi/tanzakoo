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

ここまでの検証は展開したpayloadを対象としている。同日後半にMSIXのインストール・アンインストール、インストール後の審査接続とWACKも実施した。結果と未確認項目は末尾を参照。

## Partner Center

新パッケージをアップロードし、保存によって1.0.0.0を1.0.1.0に置き換えた。申請概要に `Tanzakoo-1.0.1.0-x64.msix` / `Validated` / 完了が表示されたことを確認した。従来と同じ `runFullTrust` の承認が必要という警告はあるが、新たな受領検証エラーはない。審査提出・公開は行っていない。

アップロード元タブでは100% / Analyzing packageの表示が残り、Saveが無効だった。元タブを中断せず別タブで同じパッケージページを開くと、新版が受領済みでSaveが有効だったため、そちらで保存した。保存後に元タブも申請概要へ更新した。再アップロードはしていない。

## 提出用アクセスと審査手順（2026-10-02）

- Microsoft Store専用の新規コードをRailwayの永続台帳で発行した。モデルは既存の `gpt-6-luna`、有効期限は2026-11-01 09:06:23 UTC（同日18:06:23 JST）、最大300 API試行。金額上限を保証する値ではなく、プロバイダーの支払い設定は変更していない。
- grant IDは `a2fe56b1-fa21-47ba-90b1-eac06934a533`。秘密コードはGit・チャットに記載せず、Partner CenterのAdditional Testing InfoのCredentialsに `Tanzakoo review access code (Windows)` として保存した。
- MSIX 1.0.1.0のpayloadを専用データ領域で起動。別の起動済みテストアプリとの競合を避け、`WEBVIEW2_USER_DATA_FOLDER` も専用領域へ分離した。
- 実画面でコード入力・送信同意・接続に成功し、モデルと期限の表示を確認した。
- 実APIと同梱ランタイム・ボードツールで「Windows審査接続確認」を1枚作成。本文「元の本文」が保持された状態で「変更案」への未承認提案が1件表示され、UIの「適用する」で保存済み本文が「変更案」になり、未承認表示が消えた。
- 検証後の `/review/status` は残り293試行。テストアプリは終了した。検証先は `.local/windows-review-access-20261002/`。これはインストール済みMSIXでの検証ではない。
- [英語審査手順](review-notes.txt)にバージョン・期限・資格情報の参照方法を反映し、同ページの説明欄へ保存。ページ再読み込み後、全文一致と資格情報1件の保存を確認した。説明欄には秘密コードを含めていない。
- 秘密値を表示しない画面証跡は `.local/windows-review-access-20261002/applied.png` と `partner-center-saved.jpg`。審査提出は未実施。期限・残量が不足する場合はコードを再発行して資格情報と手順を更新し、審査・追加確認中はRelayを稼働させる。

## インストール・WACKの準備（2026-10-02）

- 利用者からインストール後検証とWACK実行の依頼を受けた。開始時点で `Huruikagi.Tanzakoo` のパッケージ登録はない。環境はWindows 11 Home build 26300、WACKは10.0.26100.7705。
- 提出済みMSIXは未署名。正式identityを変えず、検証用コピーに2日限定・コード署名専用・秘密鍵のエクスポート不可の自己署名証明書で署名した。元の提出ファイルは変更していない。
- 検証用コピーは `.local/windows-installed-validation-20261002/Tanzakoo-1.0.1.0-x64-local-test.msix`。SHA-256は `8c3d45b2e8c30d6d258e8ffe9ddba4da08fe3ca1d7eaa95d87c6b2927be57760`。追加された署名・CodeIntegrityカタログとContent Types以外、元の1,435エントリが一致し、マニフェストとpayloadに変更がないことを確認した。
- 同ディレクトリの `install-and-wack.ps1` は対象ハッシュ・既存登録の不在を確認し、証明書をLocalMachine TrustedPeopleへ一時登録してインストール、正式PFNの照合、WACKを行う。終了時は `finally` でこの証明書の信頼登録だけを除去する。WACK用データとWebView保存先は隔離する。
- 最初の管理者起動は取り消された。同日、利用者の続行依頼とUAC承認後、以下の検証まで完了した。
- Microsoftの手順: [テスト署名と信頼登録](https://learn.microsoft.com/en-us/windows/msix/package/create-certificate-package-signing)、[WACKの管理者実行](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-app-certification-kit)。

## インストール後の実機確認（2026-10-02）

- Windows PowerShellの実行ポリシーにより最初のスクリプト実行は開始されなかった。ポリシーを変更せず、既存のPowerShell 7から管理者実行した。
- テスト署名したMSIXのインストールが成功し、正式PFN `Huruikagi.Tanzakoo_022ffcc1y2108`、バージョン `1.0.1.0`、登録状態OKを確認した。WindowsApps内の1,434 payloadファイルは提出済みMSIXと全件ハッシュ一致。
- 非昇格でWindowsApps内の実行ファイルを起動し、パッケージのAUMIDが `Huruikagi.Tanzakoo_022ffcc1y2108!Tanzakoo` であることを確認した。アプリデータとWebViewデータは専用の検証ディレクトリに隔離した。
- 提出用コードで接続し、登録した参照フォルダーの `check.md` を実ツールで読めた。AIが `TANZAKOO_INSTALLED_REFERENCE_OK` を返し、「MSIXインストール確認」を1枚作成、本文「元の本文」から「変更案」への未適用提案を1件登録した。
- UIで差分を確認して「適用する」を押すと、保存済み本文が「変更案」になり、未承認表示が消えた。「決めたこと」へ列移動し、ネイティブダイアログで選んだフォルダーへのMarkdown出力が成功。出力された決定事項ファイルにも「変更案」が含まれた。
- 終了・再起動後もカード、列、本文、会話、参照資料の登録が保持された。審査コード・審査送信同意は仕様どおり再入力が必要だった。再接続後、新しい会話から同じ資料を読み、終了中に追記した `Restart reference check: TANZAKOO_AFTER_RESTART_OK` を確認できた。
- 検証後のコード残量は279 API試行。有効期限は変更なし。コードそのものは記録しない。
- アンインストールが成功し、今回のパッケージ登録がなくなったことを確認。今回のテスト署名証明書と秘密鍵をCurrentUser/Myから削除し、LocalMachine TrustedPeopleの一時信頼登録も残っていない。提出済みMSIXのSHA-256は作成時と一致した。
- ローカル証跡: `.local/windows-installed-validation-20261002/` 内の `installed-package.json`、`installed-payload-verification.json`、`applied.png`、`restart-reference.png`、`restart-ui.txt`、`export/`、`review-status.json`、`cleanup.json`。

## WACKの結果と残項目

WACK 10.0.26100.7705の全検査が完了した（`PARTIAL_RUN=FALSE`）。総合結果は **WARNING**。プロセス終了コード0を全項目合格と解釈しない。24検査の内訳は22 PASS、1 FAIL、1 WARNING。

| 検査                                 | 種別       | 結果    | 内容                                                                                                                                             |
| ------------------------------------ | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| ブロック済みの実行可能ファイル（88） | 任意       | FAIL    | 本体・同梱Node/Codex等の子プロセスAPI、cmd/PowerShell等の静的参照が検出された。必須検査の失敗ではないが、Sモードでの動作を確認した結果でもない。 |
| DPIAwarenessValidation（92）         | 必須       | WARNING | `tanzakoo.exe` を処理できなかった旨と、DPI未対応というメッセージ。EXEから抽出したマニフェストにはCommon Controls依存のみで、DPI宣言がない。      |
| その他22検査                         | 必須・任意 | PASS    | アプリマニフェスト、禁止ファイル、プライベートコード署名、特殊用途の機能等。                                                                     |

[Microsoftの説明](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-desktop-bridge-app-tests)では任意検査は情報提供目的で、Store登録判定には使用しない。ただし、この結果はStore承認や `runFullTrust` の許可を保証しない。

DPIについて、同梱ソースのTao 0.35.3には起動時にPer-monitor V2をAPIで設定する処理がある。したがってマニフェストの警告だけで実行中のDPI未対応とは断定しない。一方で、この検証では複数DPI環境の実測や警告の解消までは行っていない。提出前の改善候補はEXEへの明示的なDPI宣言と再ビルド後のWACK再確認。

元レポートはローカルの `wack-report.xml`、集計は `wack-tests.json`、EXEマニフェストは `exe-manifest.xml` に保存した。個人パス等を含む生レポートはGitに追加しない。

今回の結果はWindows 11 Home build 26300での確認。最小対応OS・クリーン環境のWebView2、旧版からの更新、通常のChatGPT実アカウント接続、通知、最終掲載画像との一致は今回未確認。アプリの再起動を確認したもので、OS再起動試験ではない。Partner Centerのパッケージ差し替えや審査提出はこの検証では行っていない。
