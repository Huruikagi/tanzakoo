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

管理者実行を要求したが、Windowsから「この操作はユーザーによって取り消されました」と返り、インストールとWACKは開始されなかった。DPI警告の解消をまだ確定していない。

今回作成したCurrentUser/Myのテスト証明書と秘密鍵を削除した。パッケージ登録とLocalMachine TrustedPeopleへの信頼登録が存在しないこと、1.0.1.0の元ファイルが変更されていないことを確認した。`cleanup.json` に結果を保存。署名済みコピーと公開証明書は検証用ディレクトリに保持しており、有効期限内（2026-10-04 23:36:47 JST）なら、準備済み `install-and-wack.ps1` をUAC承認後に再実行できる。期限後は新しいテスト署名が必要。

現在Partner Centerに登録されているのは1.0.1.0であり、今回の1.0.2.0は未アップロード・審査未提出。
