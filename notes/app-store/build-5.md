# Mac App Store build 5（準備中）

2026-10-04、build 4の次の候補を準備した。**未作成・未アップロード**。App Store Connectで選択中なのは引き続き0.1.0 (4)。

## 含める変更と検証

- `4fee286` の計測無効化とACP起動時パッチを含むmainを使用する。通常接続と審査用接続に適用する。[変更範囲](privacy-assessment.md)を参照。
- macOS Store packageに、参照ポリシー・OAuthと、配布用に展開したACPの接続・再接続テストを追加した。実APIを呼ばないローカルfixtureで、解析不能な継承設定を起動引数で上書きできることも確認する。MCP本体を必要とするboardルートはこの追加工程の対象外。
- Windowsでは `pnpm check` が成功（lint、整形、22ファイル134テスト、TypeScript/Viteビルド）。追加工程と同じ5つの接続ルートを展開済みランタイムで実行して成功した。前の変更時にはboardルートも通常・審査接続で検証済み。Mac上の今回の検証はworkflow実行後に記録する。
- 既存の署名workflowの最新成功runは `37108624235`、ソース `83949a2` のbuild 4。2026-10-04の確認時点で後続の署名runはない。

## 次の実行

1. 未pushの変更範囲を確認してGitHubへ反映する。計測無効化以外にもIssue Forms／公開サポート・ポリシー、WindowsのDPI／テスト修正・画像、両ストアの準備記録がある。mainへのpushで既存CIやPages公開、Railwayの連携デプロイが動く可能性がある。
2. `macos-store.yml` をmainで `build_number=5`、`review_access=true` として実行する。成功runのソースSHA、署名とartifactを記録する。
3. `macos-store-upload.yml` にその成功runを指定し、Apple事前検証とApp Store Connectへのアップロードを行う。ビルドの登録とApp Reviewへの最終送信は別。
4. Appleの処理完了を確認してbuildを差し替え、`metadata.json` と審査メモを実際の成果物に合わせる。作成前に登録済みの版を5と書き換えない。
5. OpenAIケース16386634の追加回答をプライバシー申告へ反映する。2026-10-04の今回の確認時点では追加質問への返信なし。

TestFlightの実機確認を見送る既存の判断は維持する。CIのローカルfixture通過をMac Store版の実機検証済みとは扱わない。
