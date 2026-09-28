# Mac実機の撮影スクリプト

MacにCodexを入れる必要はない。**起動中のTanzakoo、Python 3、macOS標準のコマンド**で撮影できる。インストールした.appと、クローン先から `pnpm tauri dev` で起動したネイティブアプリの両方に対応する。撮影処理にNode・Rust・Playwrightは不要だが、ローカルビルドで起動する場合は通常の開発環境が必要。Python 3の有無は `python3 --version` で確認する。

スクリプトはウィンドウの大きさ・位置の調整、アプリを前面にする操作、撮影、サイズ検査、記録保存を行う。**言語変更、カードや変更提案の準備、撮る画面を開く操作は手動**。画面ごとにTerminalでEnterを押すと撮影する。DBを書き込んだり、AIの返答を注入したりしない。

## 実行

### クローンしてローカル起動したアプリを撮る

通常の開発環境を用意したMacで、クローン先のルートから起動する。既に起動中なら、もう一度起動する必要はない。

```sh
# Terminal 1: ネイティブアプリを起動したままにする
mise exec -- pnpm tauri dev
```

別のTerminalで、同じクローン先から撮影する。

```sh
# Terminal 2: まず日本語ボード1枚
python3 scripts/capture-macos-store.py --running --languages ja --scenes board

# 日英の全画面を順に撮る場合
python3 scripts/capture-macos-store.py --running
```

`--running` は、撮影スクリプトを置いたリポジトリの `src-tauri/target/debug/tanzakoo` と実行ファイルのパスが一致するプロセスだけを選ぶ。インストール済み.appを起動し直さず、ローカルアプリの保存先や起動環境も引き継いだまま撮影する。標準と異なるビルド先なら、次のように実行ファイルを明示する。

```sh
python3 scripts/capture-macos-store.py --running ./src-tauri/target/release/tanzakoo --languages ja
```

同じ実行ファイルから複数のアプリが動いている場合は、撮影対象を1つにする。撮影中はコードの変更・再ビルドを止める。実行ファイルが更新された場合やPIDが変わった場合は撮影を中止し、スクリプトを再実行する。フロントエンドだけのホットリロードはPIDで検知できないため、撮影中は編集しない。`pnpm dev` のブラウザープレビューは対象外。

ローカル画像には `-local.jpg` を付け、記録には `kind: local-native-capture`、実行ファイルのSHA-256、撮影開始時のチェックアウトのコミットと未コミット変更の有無を残す。このコミットが実行ファイルのビルド元と一致する保証はなく、Storeの版・ビルド番号も推測しない。**提出前に最終提出ビルドと表示・機能が一致することを確認する。**

### インストールした.appを撮る

このスクリプトを含むリビジョンのリポジトリをMacに取得し、そのディレクトリで実行する。既に取得済みなら、そのリビジョンまで更新する。撮影キットZIPでも同じ構成で動く。

まずは日本語のボード1枚で動作を確認する。

```sh
python3 scripts/capture-macos-store.py --app "/Applications/Tanzakoo.app" --languages ja --scenes board
```

1. Tanzakooに新しい撮影用プロジェクトを作る。普段のプロジェクトと分け、個人情報を含めない。下のサンプルを使える。
2. スクリプトがアプリを開いたら、TerminalでEnter。macOSが求めた場合、Terminalに「画面収録」「アクセシビリティ」、System Eventsを操作する許可を与える。設定画面の名称はOSによって異なる。再起動を求められたらTerminalを開き直し、同じコマンドを再実行する。
3. 表示言語と同じ言語のプロジェクトを選び、撮る画面を準備する。Terminalに戻ってEnterを押すと、対象アプリを前面に戻して、そのウィンドウだけを撮影する。言語・内容が正しいかは目視で確認する。
4. 完了するとFinderで保存先が開く。画像と `manifest.json` を確認する。自動アップロードは行わない。

撮影中は全画面表示を解除し、メインウィンドウを1枚だけ表示する。別のコピーの同じアプリが動いている場合は停止する。ファイル選択等のネイティブダイアログは閉じる。スクリプトはアプリを終了したり、元のウィンドウ配置に戻したりはしない。

## ほかの撮り方

```sh
# 日英3枚ずつ。各画面を手動で整えてからEnterを押す
python3 scripts/capture-macos-store.py --app "/Applications/Tanzakoo.app"

# AIを使わず、ボードとエクスポートだけ
python3 scripts/capture-macos-store.py --app "/Applications/Tanzakoo.app" --languages ja --scenes board export

# 広い画面で撮る。指定ビルド以外なら起動前に止める
python3 scripts/capture-macos-store.py --app "/Applications/Tanzakoo.app" --size 1440x900 --expected-version 0.1.0 --expected-build 2

# Sandbox検証版でも撮影操作を試せるが、画像名にsandbox-previewが付く
python3 scripts/capture-macos-store.py --app "/Applications/Tanzakoo Sandbox.app" --languages ja --scenes board
```

ビルド番号の指定は.app用の任意指定で、`--running` とは併用できない。上記の `2` は既存のアップロード済みビルドの例で、最終提出ビルドが変わったら置き換える。Sandbox版の撮影成功はStoreビルドの確認を意味しない。

## サイズと保存先

既定のウィンドウサイズは論理1280×800。Retinaで2560×1600として保存される場合も、そのまま使う。`--size 1440x900` は1440×900または2880×1800になる。画像を引き伸ばしてサイズ合わせする処理はない。画面の作業領域が足りないときは、macOSのディスプレイ設定で表示領域を広げるか、広い外部ディスプレイにアプリを移す。

出力は `.local/mac-store-captures/<日時とランダム文字列>/`。実行ごとに新しいフォルダを作る。`--output "$HOME/Desktop/Tanzakoo-shots"` で親フォルダを指定できる。既存の画像は上書きしない。失敗した画像は `.rejected.jpg` として残し、正常画像に数えない。

画像はmacOS標準の `screencapture` が保存する影なしJPEG。対象アプリのウィンドウ枠を含む。`sips` では形式・ピクセル寸法・アルファなしを検査するだけで、画像は加工しない。記録にはアプリのID、版、ビルド、実行ファイルのSHA-256、macOS、撮影日時、画像SHA-256を含める。

**提出前には目視確認が必要。** 機密情報、エラー、未意図の画面、言語違い、文字切れがないことと、最終提出ビルドの表示との一致を確認する。スクリプトはこの判断を自動で「確認済み」にしない。空の画像・黒い画像も目視で確認する。

## 撮影用のサンプル

プロジェクト名: **週末の小さなアプリ / A small weekend app**

メモリ: 「忙しい平日でも、次の一歩が見つかる個人用メモ。最初は一人で使う。」 / “A personal notebook that makes the next step clear, even on busy days. Start with one user.”

| 列                    | 日本語: タイトル / 本文                                           | English: Title / Content                                                    |
| --------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| アイデアの山 / Ideas  | あとで考える箱 / 思いついたことを短く残す。整理はあとで。         | An inbox for later / Capture a short thought now. Organize it later.        |
| アイデアの山 / Ideas  | 週末の振り返り / 今週進んだことを、数分で見返したい。             | A weekend reflection / Review the week's progress in a few minutes.         |
| 検討する / Exploring  | 最初に使う場面 / 朝、今日の作業を始める前に開く。                 | The first moment of use / Open it in the morning, before starting work.     |
| 検討する / Exploring  | 入力の手間を減らす / タイトルだけでも保存できるようにする。       | Make capture easy / A title should be enough to save a thought.             |
| 話し合う / Discussing | 今日の一歩を選ぶ / 今日取り組むことを選べるようにする。           | Choose today's next step / Let me choose what to work on today.             |
| 決めたこと / Decided  | まずは一人で使う / 初版は個人向け。共有機能は後から検討する。     | Start with one user / Build for personal use first. Consider sharing later. |
| 決めたこと / Decided  | 文章で持ち出せる / 決まった内容をMarkdownで保存できるようにする。 | Take decisions with you / Save decisions as Markdown files.                 |

AIを使う場合も、CodexアプリをMacに別途インストールする必要はない。Tanzakooの通常接続または有効な審査用接続を使う。撮影スクリプトにコード・APIキーを渡さない。カードを作るときは表の片方の言語だけを貼り、「以下の7枚だけを候補カードとして作成して」と依頼し、必要な列へ画面上で移す。

変更提案の撮影前に「今日の一歩を選ぶ」を会話に参照し、「一度に一つを選び、終わったら次を選ぶ内容にする変更案を1件出して。まだ適用しないで」と依頼する。英語では “Propose one change: choose one thing to work on, then choose the next step when it is done. Do not apply the proposal.” を使える。実際に返ってきた提案を確認して撮影する。返答をブラウザー構図案に合わせる必要はない。

## 検証範囲

Windowsで、誤ったアプリ・複数ウィンドウ・画面サイズ不足・アルファ付き画像・指定外寸法の拒否、既存画像の保持、失敗画像の分離、撮影記録を単体検証した。ローカル対象のパス照合、複数候補の拒否、再起動・再ビルドの拒否もテストしている。macOS上の権限ダイアログ、実際のJXA/AppleScriptと実ウィンドウ撮影はまだ未検証。最初は1枚で確認する。

参照: [AppleのMac自動化ガイド](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/HowMacScriptingWorks.html)、[App Store画像仕様](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)。
