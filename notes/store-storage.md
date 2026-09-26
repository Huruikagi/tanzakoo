# ストア配布の保存設計

## 今回の対応範囲

Mac版はApple Silicon（`aarch64-apple-darwin`）・macOS 26 Tahoe以上。将来のMicrosoft Store配布を考慮して保存と同梱ランタイムを分離する。ストア登録・署名・インストーラー作成やAIのSandbox対応完了を意味しない。

| 種類                                   | 保存先・アクセス方法                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB・プロジェクト・エージェント作業領域 | 共通データルートの配下。WindowsはTauriの `app_local_data_dir()`、MacはFoundationのApplication Support検索APIに識別子を追加する                                        |
| Codex認証・セッション                  | データルートの `agents/codex`。Windowsはユーザーデータ領域のACLを継承し、Macではディレクトリーを所有者のみアクセス可能な `0700` にする。普段のCLIの認証はコピーしない |
| Node・Codex・ACPアダプター             | Tauriの `resource_dir()` で取得するインストール済みリソース。DBや認証の書き込み先として使わない                                                                       |
| Markdownエクスポート                   | Rust側から開くネイティブのフォルダー選択ダイアログで毎回選ぶ。選択直後に新しい子フォルダーへ出力する                                                                  |

Macでは `HOME` の連結や `~/Library/Containers/<ID>` の固定パスを使わず、Foundationから現在の実行コンテキストに対応する場所を取得する。既存の間接依存 `objc2-foundation 0.3.2`（MIT、MSRV 1.71）をMac限定で直接利用する。プロジェクトのMSRV 1.88を満たし、新たな別ライブラリやサービスは追加しない。

`TANZAKOO_DATA_DIR` は開発・検証用に維持する。空文字列はエラー、相対パスはエージェント起動前に絶対パスへ解決する。保存先で失敗してもカレントディレクトリーやインストール先へフォールバックしない。未リリースのため旧Roaming領域からの移行・検出は実装しない。

## Macのファイル権限

`src-tauri/tauri.macos.conf.json` で最低OSを26.0に設定する。CPUはビルド時に `--target aarch64-apple-darwin` を指定する。

`src-tauri/tauri.sandbox.conf.json` は **ファイル保存の検証用** の設定で、`Entitlements.sandbox.plist` を参照する。

- `com.apple.security.app-sandbox`: アプリのSandboxを有効化する。
- `com.apple.security.files.user-selected.read-write`: ダイアログで選ばれたフォルダーへエクスポートする。
- 出力先は保存せず毎回選ぶので、永続的なsecurity-scoped bookmarkは不要。Frontendに任意パスを書き込むIPCや広いファイル権限は追加しない。

この設定だけではストア提出・AI接続は完成しない。通信権限、Node/Codex/MCP子プロセスへのSandbox継承と署名、ブラウザ認証、Team ID・App ID・プロファイルは、AI接続と配布の検証時に追加する。現時点のプロファイルには通信権限を含めていない。

## Microsoft Store

Tauri公式にはEXE/MSIインストーラー経由のStore配布がある。Store配布を理由にUWPのAppContainerを前提とせず、現段階では通常のデスクトップアプリとしてユーザーのLocal AppDataとネイティブダイアログを使う。

MSIXを選ぶ場合はパッケージID、ストレージのリダイレクト、更新・リセット・アンインストール時のデータの扱いを実パッケージで確認する。必要に応じて `storage::data_dir` のWindows実装をパッケージ向けAPIに差し替える。Package Family Nameや `WindowsApps` のパスをコードに埋め込まない。Macのファイル権限をWindowsにそのまま移植しない。

## 検証

共通のRustテストで保存・再起動、認証領域、相対パス、空の指定、保存先エラーを確認する。既存のエクスポートテストで出力内容・上書き防止・失敗時の後片付けを確認する。macOS 26のARM64 CIではFoundationの保存先取得・Unix権限を含めてテストするが、CI設定の追加は実行成功の証拠ではない。

署名したMac Sandbox版では次を実機で確認する必要がある。

1. Finderから起動し、データがコンテナ内に作られ、再起動してもカード・会話・プロジェクトが残る。
2. Desktop・Documents・外部ボリュームから選んだ保存先へエクスポートできる。キャンセル・権限拒否・読み取り専用・容量不足は既存データを壊さず扱える。
3. 再起動後は出力先を選び直し、保存済みの文字列パスだけで外部へ書き込まない。
4. 同梱ランタイムを読み取り専用にした配布状態でも、DB・認証・作業領域が動作する。AIの認証・通信・子プロセス検証は対応する署名と権限を整えてから行う。

Windowsは採用した配布形式で、標準ユーザーによる起動・保存・エクスポートとアプリ更新後のデータ保持を確認する。Mac Sandbox実機とWindows Storeパッケージでの通し確認は未実施。

## 根拠

- [Apple: App Sandboxのファイル権限](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html)
- [Apple: Application Support等のディレクトリー取得](<https://developer.apple.com/documentation/foundation/nssearchpathfordirectoriesindomains(_:_:_:)>)
- [Tauri: Mac App Storeへの配布](https://v2.tauri.app/distribute/app-store/)
- [Tauri: Microsoft Storeへの配布](https://v2.tauri.app/distribute/microsoft-store/)
- [Microsoft: パッケージ化の選択と保存先の違い](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/packaging/)
