# Windows MSIX 1.0.2.0のDPI宣言と再検証

2026-10-02、MSIX 1.0.1.0のWACKで報告されたDPI警告への対応として、Windows EXEのマニフェストへDPI宣言を追加した。

## 変更と作成元

- ソース: `4a6d53cd851e2547e9279338b09450cb341ac634`。クリーンなチェックアウトからローカルreleaseビルドした。アプリ本体は0.1.0、MSIXは1.0.2.0。
- `src-tauri/windows-app-manifest.xml` をTauriの `WindowsAttributes::app_manifest` で埋め込む。既存のCommon Controls v6依存を維持し、Win32 assembly identity、`dpiAware=true/pm`、`dpiAwareness=PerMonitorV2` を宣言した。assembly identityの1.0.0.0はWin32マニフェストの識別用で、MSIXの更新バージョンではない。
- 既存Taoが実行時に設定するPer-Monitor V2と揃えた。[Microsoftの推奨するマニフェストでの設定](https://learn.microsoft.com/en-us/windows/win32/hidpi/setting-the-default-dpi-awareness-for-a-process)を使用。依存追加はない。
- 出力: `.local/windows-store-candidate-20261002-dpi/Tanzakoo-1.0.2.0-x64.msix`。
- MSIX SHA-256: `f7cf25abe41f13776167579fbbb03af397e6f3b64b33567aa66184ffec0d2d97`。
- EXE SHA-256: `1f7827b471c9d0d3019069ecef055a2e344341ca2d305748a081737f0dc44db8`。
- 正式identityと審査接続URLは維持。旧版とのpayload差分は `tanzakoo.exe` とバージョンを更新した `AppxManifest.xml` のみ。同梱ランタイム等はハッシュ一致。

## ビルドと静的検証

- `cargo fmt --check` 成功。
- Windows SDK `mt.exe -validate_manifest` 成功。完成EXEからリソースを抽出し、両方のDPI宣言とCommon Controls依存を確認した。
- Tauri releaseビルド成功（TypeScript・Viteビルドを含む）。既存のbundleサイズ警告と、ライブラリ作成を通知するlinkerメッセージは残る。
- 既存のWindowsパッケージ検査6件成功。MakeAppxの意味検証とMSIX内1,434ファイルのハッシュ検証が成功。
- WACK用コピーのみ2日限定・非エクスポート鍵でテスト署名した。未署名候補との相違は署名・CodeIntegrityカタログ・Content Typesだけで、payloadに変更がないことを確認した。
- 証跡は `.local/windows-dpi-validation-20261002/` の `build.log`、`build-verification.json`、`exe-manifest.xml` 等に保存。

## インストールとWACK

2026-10-02の管理者実行はUAC取消で開始されなかった。2026-10-03、利用者の再開依頼とUAC承認を受け、同じ署名済みコピーでインストールとWACKの全検査を完了した。

初回取消後にCurrentUser/Myのテスト証明書と秘密鍵は削除済み。再検証では保持していた公開証明書だけを一時的に信頼登録した。正式PFN・バージョン1.0.2.0でインストールでき、インストール先の全1,434 payloadファイルが未署名候補とハッシュ一致した。

### WACK再実行の結果（2026-10-03）

- 環境: Windows 11 Home 10.0.26300.0、WACK 10.0.26100.7705。
- レポート生成: 2026-10-03 07:15:48 JST。`PARTIAL_RUN=FALSE`、総合 **WARNING**、終了コード0。
- 24検査中22 PASS、任意の「ブロック済みの実行可能ファイル」1 FAIL、必須の `DPIAwarenessValidation` 1 WARNING。必須検査のみでは12 PASS・1 WARNING。全検査合格ではない。
- 任意検査の失敗は前回同様、同梱実行系等の実行ファイル参照による。[Microsoftの説明](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-desktop-bridge-app-tests)では任意検査はStore登録判定に用いない。ただしSモードでの動作やStore承認を保証するものではない。

### DPI警告の切り分け

レポートの「バイナリを処理できませんでした」を調べると、WACKの診断ログに `BinaryInfoClass.IsPerMonitorV2DPIAwarenessSet()` 内のCOM `E_FAIL` が記録されていた。WACKは `SetProcessDpiAwarenessContext` のAPI参照も検出しているが、マニフェスト判定中の例外によりWARNINGを返している。例外の根本原因は未特定で、WACKの警告自体は解消していない。

一方、インストール済みEXEから `mt.exe` で抽出したマニフェストにも `PerMonitorV2` 宣言があることを再確認した。さらに隔離データでインストール版を非昇格で起動し、[GetDpiAwarenessContextForProcess](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdpiawarenesscontextforprocess) と [AreDpiAwarenessContextsEqual](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-aredpiawarenesscontextsequal) でOSが認識するDPI設定を照合した結果、**Per-Monitor V2との一致がtrue**だった。診断プロセスは終了済み。これは実行中のDPI設定の確認であり、異なる倍率のディスプレイ間移動や表示品質の実機確認ではない。

### 証跡と片付け

- 同じ検証ディレクトリに `wack-report.xml`、`wack-tests.json`、`installed-package.json`、`installed-payload-verification.json`、`installed-exe-manifest.xml`、`dpi-diagnostic-trace.txt`、`dpi-diagnostic-log.xml`、`runtime-dpi-verification.json` を保存した。生ログには個人パスがあるためGitには追加しない。
- 検証用パッケージをアンインストールし、パッケージ登録・一時信頼登録・今回の秘密鍵が残っていないことを確認した。未署名候補のSHA-256は変更なし。`revalidation-cleanup.json` に記録した。
- 審査メモに説明する場合は「DPI設定は実行時に確認済み、WACKのマニフェスト検査がCOM例外となる」と区別し、WACK合格とは記載しない。

### Partner Centerへの登録（2026-10-03）

利用者の依頼に基づき、上記の未署名1.0.2.0をSubmission 1へアップロードし、旧版1.0.1.0の置き換えを保存した。概要ページで `Tanzakoo-1.0.2.0-x64.msix` の `Validated`・パッケージ「完了」を確認した。受領時には従来どおり `runFullTrust` の承認が必要という警告がある。これはStoreの認定完了を意味しない。

`review-notes.txt` のバージョンを更新し、実行時のPer-Monitor V2確認、WACKの未解消警告とCOM例外、倍率の異なる画面間の未検証事項をAdditional Testing Infoへ保存した。再読み込み後、改行コードを除く原稿との全文一致を確認した。既存の非公開Credentialsは変更していない。審査コードの状態は有効期限2026-11-01 09:06:23 UTC、残量279 API試行だった。

保存後の画面は `.local/windows-dpi-validation-20261002/partner-center-1.0.2.0.png` に保持する。申請は下書きのままで、認定への送信・公開は行っていない。概要の価格・年齢区分は完了表示を確認できていないため、提出前の最終照合に残す。

### 認定への送信（2026-10-03）

[提出設定の照合](settings-check-20261003.md)後、利用者の継続依頼でSubmission 1を送信した。Partner Centerが「認定中」、申請完了・前処理中（手順2/4）に変わったことを確認した。無料・フランス以外の239市場、認定合格後すぐに公開を開始する設定。認定合格や公開の完了はまだ確認していない。画面証跡は `.local/windows-dpi-validation-20261002/partner-submitted-20261003.png`。
