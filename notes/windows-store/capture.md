# Windows実機のストア画像

`scripts/capture-windows-store.ps1` は起動中のネイティブTanzakooのウィンドウを撮影する。PowerShell 7とWindows標準の描画APIを使い、新たなnpm/Python依存は追加しない。

## 撮影

撮影用プロジェクトを用意し、普段使うプロジェクトの個人情報を含めない。[Macと共通のサンプル題材](../app-store/screenshots/mac-capture.md#撮影用のサンプル)を利用できる。

Windows版を起動した状態で、リポジトリのルートからPowerShell 7で実行する。

```powershell
# ローカルのreleaseビルドを対象に日英3枚ずつ
pwsh -File scripts/capture-windows-store.ps1

# 開発中のネイティブアプリを撮る場合
pwsh -File scripts/capture-windows-store.ps1 -Executable src-tauri/target/debug/tanzakoo.exe

# 画面を整え済みの場合、日本語のボード1枚を確認待ちなしで撮影
pwsh -File scripts/capture-windows-store.ps1 -Languages ja -Scenes board -Ready
```

インストール先が違う場合は `-Executable` に対象の実際の `tanzakoo.exe` を指定する。MSIXのインストール先やStoreのパッケージバージョンを推測しない。

通常モードでは画面ごとにEnterを待つ。撮影の順序は次の通り。

1. `board`: 同じ言語のサンプルボード全体。不要なチャットやダイアログを閉じる。
2. `proposal`: 実際にAIに提案させた未承認の変更案を開き、差分と適用・却下の操作を見せる。
3. `export`: 決定事項のMarkdownエクスポート画面を開く。ファイル保存ダイアログは閉じる。

AIに接続せず撮影する場合は、2枚目に `memory`（保存済みプロジェクトメモリのプレビュー）を選べる。PowerShellからの呼び出し例:

```powershell
./scripts/capture-windows-store.ps1 -Scenes board,memory,export -Width 2160 -Height 1350
```

150%の表示スケールでは上のサイズで撮影し、ボードと詳細の境界を調整すると4列を見渡せる。モニターの作業領域に収まるサイズを選ぶ。

設定でUI言語を日本語・Englishに切り替え、カード本文も対応する言語のプロジェクトに切り替える。撮影スクリプトはカード・会話・認証を作成・変更しない。AI返答の注入、ブラウザーモック、Mac画像の流用は行わない。

実行ファイルのパスが一致するプロセスが1つ、タイトルが `Tanzakoo` のメインウィンドウが1つのときだけ撮影する。別のアプリや複数候補を自動で選ばない。撮影中にプロセスが再起動したり実行ファイルが変わった場合は止まる。

## サイズと記録

既定では対象ウィンドウを1600×1000物理ピクセルに調整して前面にする。終了後もウィンドウ位置・サイズはそのまま。デスクトップ全体ではなく対象ウィンドウを取得し、DWMの不可視な外枠だけを除いて不透明なPNGとして保存する。画像の拡大・縮小はしない。

小さいモニターでは `-Width 1400 -Height 850` などを指定する。不可視の枠を除いた画像が1366×768未満の場合や、指定サイズがモニターの作業領域に収まらない場合は失敗する。全画面表示や別のダイアログを閉じて実行する。

保存先は `.local/windows-store-captures/<日時とランダムID>/`。毎回新しいフォルダーを作り、既存画像を上書きしない。`-Output` で親フォルダーを変更できる。

`manifest.json` に実行ファイルのSHA-256、PIDと開始時刻、撮影時刻、画像サイズ、画像SHA-256、チェックアウトを記録する。**チェックアウトのコミットは実行ファイルのビルド元の証明ではない。** `submissionBuildMatch` は目視や最終ビルドの検証前に確認済みにしない。

提出前に全画像を目視し、黒い領域・エラー・文字切れ・個人情報・認証情報・別言語がないことを確認する。単純な空画像は自動で拒否するが、見た目の正しさを保証するものではない。最終提出ビルドとの表示一致も別途確認する。画像は自動アップロードしない。

API: [PrintWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow)、[DWMのフレーム境界](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)。

ウィンドウに触れずコンパイルだけを確認するには `-CheckOnly` を指定する。

2026-10-02にWindows上の実アプリで日英各3枚の取得を確認した。[選定画像と撮影記録](screenshots/native/20261002/README.md)を参照。
