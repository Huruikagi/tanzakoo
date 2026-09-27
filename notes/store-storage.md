# ストア配布の保存設計

## 今回の対応範囲

Mac版はApple Silicon（`aarch64-apple-darwin`）・macOS 26 Tahoe以上。初版はMac App Storeから署名・公証済みDMGの直接配布に変更した。Windowsの正式配布はMSIXによるMicrosoft Store公開とする。保存と同梱ランタイムは分離する。[Macの署名・公証ワークフロー](macos-distribution.md)の実装は、実行成功や実機検証の完了を意味しない。

| 種類                                   | 保存先・アクセス方法                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB・プロジェクト・エージェント作業領域 | 共通データルートの配下。WindowsはTauriの `app_local_data_dir()`、MacはFoundationのApplication Support検索APIに識別子を追加する                                                  |
| Codex認証・セッション                  | データルートの `agents/codex`。Windowsはユーザーデータ領域のACLを継承し、Macではディレクトリーを所有者のみアクセス可能な `0700` にする。普段のCLIの認証はコピーしない           |
| Node・Codex・ACPアダプター             | Tauriの `resource_dir()` で取得するインストール済みリソース。DBや認証の書き込み先として使わない                                                                                 |
| Markdownエクスポート                   | Rust側から開くネイティブのフォルダー選択ダイアログで毎回選ぶ。選択直後に新しい子フォルダーへ出力する                                                                            |
| 参照資料                               | ネイティブダイアログで選んだファイル・フォルダーの正規パスと種別をプロジェクトDBに保存。専用MCPで範囲を検査して読み取り、元ファイルへの書き込み権限は渡さない（2026-09-27追加） |

Macでは `HOME` の連結や `~/Library/Containers/<ID>` の固定パスを使わず、Foundationから現在の実行コンテキストに対応する場所を取得する。既存の間接依存 `objc2-foundation 0.3.2`（MIT、MSRV 1.71）をMac限定で直接利用する。プロジェクトのMSRV 1.88を満たし、新たな別ライブラリやサービスは追加しない。

`TANZAKOO_DATA_DIR` は開発・検証用に維持する。空文字列はエラー、相対パスはエージェント起動前に絶対パスへ解決する。保存先で失敗してもカレントディレクトリーやインストール先へフォールバックしない。未リリースのため旧Roaming領域からの移行・検出は実装しない。

## Macのファイル権限

`src-tauri/tauri.macos.conf.json` で最低OSを26.0に設定する。CPUはビルド時に `--target aarch64-apple-darwin` を指定する。

通常DMGではApp Sandboxを有効にせず、通常のユーザー領域のApplication Supportへ保存する。Hardened Runtimeを使い、Nodeと専用のcode-mode hostにだけJIT権限を付けて署名する。ファイル選択・同梱ランタイムとデータの分離は維持する。

参照資料は登録済みパスを都度読み取る。フォルダー名が同じでもリンクへの差し替えは拒否し、参照先の移動・削除・権限不足では再選択を案内する。macOSでは `O_NOFOLLOW_ANY` でパスの全要素についてリンク追跡を拒否し、選択したファイルの親フォルダーを開くための広い許可を要求しない。

`src-tauri/tauri.sandbox.conf.json` は `sandbox-validation` feature（`app-sandbox` を含む）を有効にする **別の検証用アプリ**。DMGワークフローの `sandbox=true` でビルドする。名称はTanzakoo Sandbox、識別子は `dev.huruikagi.tanzakoo.sandbox-test`。通常版のデータや認証を移行・共有しない。Foundationが返すコンテナ内のApplication Supportを使う。

- `com.apple.security.app-sandbox`: アプリのSandboxを有効化する。
- `com.apple.security.files.user-selected.read-write`: ダイアログで選ばれたフォルダーへエクスポートする。
- `com.apple.security.files.bookmarks.app-scope`: 選択した参照資料の読み取り専用security-scoped bookmarkをプロジェクトDBの非公開 `material_access` レコードに保存する。Snapshot・MCP応答・会話には含めない。再選択で更新し、登録解除と同時に削除する。
- 読み取り・一覧・検索の各操作で許可を復元し、操作終了時に解除する。欠落・破損・期限切れ扱いのbookmark、移動した参照元は再選択を案内し、保存パスだけでは読み取りを続けない。
- `network.client` はAI接続、`network.server` は通常認証のローカルコールバック等に使う。広いファイル権限やtemporary exceptionは追加しない。
- Node・Codex・専用MCP helper等の実行ファイルは `app-sandbox` と `inherit` だけをSandbox権限に持つ。JITはNodeとcode-mode hostだけ。親アプリにはinheritを付けない。MCP helperは親と同じアプリ識別子で署名し、自身でbookmarkを復元する。
- 出力先は保存せず毎回選ぶので、永続的なsecurity-scoped bookmarkは不要。Frontendに任意パスを書き込むIPCや広いファイル権限は追加しない。

この検証版のDeveloper ID署名・公証はStoreへの提出ではない。Store用の証明書・App ID・プロビジョニングプロファイル・提出用pkgは [Storeパッケージ準備手順](macos-app-store.md) で扱う。Store版は `tauri.appstore.conf.json` の `app-sandbox` featureを使い、検証専用の `sandbox-validation` featureとテスト資材を含めない。ブラウザ認証、ネイティブ選択、再起動後の外部資料読み取りの実機結果は下記検証記録を参照する。

## Microsoft Store

2026-09-26合意：正式配布形式をMSIXに決定。TauriのWin32デスクトップアプリをfull trust（`mediumIL`、標準ユーザー権限）でパッケージ化する。UWP化やAppContainerへの移行は行わず、同梱Node・Codex・MCP子プロセスの構成を維持する。full trustは管理者権限を要求する意味ではない。

Tauri標準のEXE/MSI生成とは別に、MSIXマニフェスト・パッケージ化・署名の工程を追加する。ストア登録で取得するIdentity/Publisherと必要な権限宣言を設定する。これらは未実装で、値を仮定して固定しない。

- アプリ本体とNode・Codex・ACPアダプターはパッケージへ同梱し、Store経由のパッケージ更新で置き換える。インストール先への書き込みや同梱バイナリーの自己更新を行わない。
- DB・認証・作業領域はユーザー単位のアプリデータ領域に置く。現在のコードは未パッケージの開発実行用にTauriのLocal AppData APIを使っている。MSIX実装時にはパッケージのデータ領域を取得するAPIの採用を含めて `storage::data_dir` を整え、リダイレクトと子プロセスからの見え方を実パッケージで確認する。Package Family Nameや `WindowsApps` のパスは埋め込まない。
- 通常の更新ではデータを保持する。リセット・アンインストールではアプリ管理データが消える前提で、公開前にバックアップ・復元の扱いと案内を整える。既存の決定事項Markdownエクスポートは、会話や未決定カードを含む完全バックアップではない。
- ユーザーが選んだ外部フォルダーへのエクスポートは維持し、アプリ管理データの消去対象に含めない。
- WebView2の依存解決と、標準ユーザー環境での初回起動・ブラウザ認証・子プロセス起動を検証する。Macのファイル権限をWindowsにそのまま移植しない。

正式配布をMSIXに絞っても、開発用の未パッケージ実行と `TANZAKOO_DATA_DIR` は維持する。未リリースのため保存先変更の移行処理は追加しない。

## 検証

共通のRustテストで保存・再起動、認証領域、相対パス、空の指定、保存先エラーを確認する。既存のエクスポートテストで出力内容・上書き防止・失敗時の後片付けを確認する。macOS 26のARM64 CIではFoundationの保存先取得・Unix権限を含めてテストするが、CI設定の追加は実行成功の証拠ではない。

署名・公証したMac DMG版では次を実機で確認する必要がある。

1. DMGからApplicationsへコピーしてFinderから起動し、データがApplication Support内に作られ、再起動してもカード・会話・プロジェクトが残る。
2. Desktop・Documents・外部ボリュームから選んだ保存先へエクスポートできる。キャンセル・権限拒否・読み取り専用・容量不足は既存データを壊さず扱える。
3. 再起動後は出力先を選び直し、保存済みの文字列パスだけで外部へ書き込まない。
4. 同梱ランタイムを読み取り専用にした配布状態でも、DB・認証・作業領域が動作する。ブラウザからのChatGPTサインイン・会話・MCP操作・サインアウトを確認する。CIのACP初期化は、この実機確認を代替しない。

2026-09-27、通常DMGと別アプリのSandbox検証版について、主要な正常系の実機確認が完了した。対象ビルドと利用者からの報告は [Mac配布の検証記録](macos-distribution.md) を参照する。Sandbox版では通常Codexログイン・カード作成・Markdownエクスポートに加え、再起動後の参照資料の一覧・読み取り・検索、元ファイルへの追記の反映、登録解除後の読み取り不可が報告された。上記チェック項目の全条件が確認されたわけではなく、保存先ごとの差やキャンセル・権限拒否・読み取り専用・容量不足などは引き続き未確認として扱う。

WindowsはMSIXで、標準ユーザーによる初回起動・保存・エクスポート・Codex認証・子プロセス起動、アプリ更新後のデータ保持、リセット・アンインストール時のデータ消去と外部出力の保持を確認する。Windows MSIXでの通し確認は未実施。

## 根拠

- [Apple: App Sandboxのファイル権限](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html)
- [Apple: Application Support等のディレクトリー取得](<https://developer.apple.com/documentation/foundation/nssearchpathfordirectoriesindomains(_:_:_:)>)
- [Tauri: Mac App Storeへの配布](https://v2.tauri.app/distribute/app-store/)
- [Tauri: Microsoft Storeへの配布](https://v2.tauri.app/distribute/microsoft-store/)
- [Microsoft: パッケージ化の選択と保存先の違い](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/packaging/)
- [Microsoft: パッケージ化したデスクトップアプリの権限・ファイル配置・削除](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)
