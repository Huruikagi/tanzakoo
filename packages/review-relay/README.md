# 審査用仲介サーバー（ローカル検証段階）

端末内のCodexからOpenAI Responses APIへの通信を中継する。カード・会話の正本やMCPは端末に残る。現段階はサーバー基盤と実Codexによるオフライン検証までで、アプリの接続設定画面にはまだ組み込んでいない。

## できること

- 管理CLIで審査トークンを発行・失効する。DBにはトークンのSHA-256のみを保存する。
- トークンごとのモデル・期限・累積試行回数を制限する。上流へ送る前にSQLiteで枠を消費し、再起動しても戻さない。通信失敗や中断も1回に数える。
- 同一トークンの並行リクエストを制限し、最短1秒の間隔を設ける。失効・期限切れは実行中の通信にも反映する。
- ストリームを中継し、端末の切断や120秒の期限で上流も中断する。使用量が返った場合は入力・出力トークンの累計を記録する。
- 接続確認は `GET /review/status`。モデル・期限・残り試行回数を返し、AI呼び出しを行わない。

本物のAPIキーはサーバーだけが保持する。上流URLは `https://api.openai.com/v1/responses` に固定し、クライアントの認証ヘッダーや任意の転送先を引き継がない。テストだけはコードから明示したloopbackの模擬APIを使える。通常ログは無効で、会話本文やトークンを出力しない。

## 現段階の制限

- **公開サービス・審査提出には未対応。** HTTPSのホスト、運用監視、秘密情報の管理、予算、データ保持説明、アプリの審査用UIと送信同意は別途必要。
- トークンは現在、期限付きのBearer資格情報を直接渡す形。短命トークンへの交換・更新とOS資格情報ストアは未実装。
- 金額の上限を保証する実装ではない。制限は試行回数、256KiBの入力、最大8192出力トークン、単一の許可モデル。モデル単価と追加料金を確定して金額管理を追加するまで、有料APIの運用に進めない。
- `POST /v1/responses` のSSEのみ。WebSocket、`/responses/compact`、上流のモデル一覧や会話IDによる復元は提供しない。長い会話の圧縮、実APIの細部、429後の再試行は実API検証が必要。
- 文字列中心の入力と端末内ツールを対象とする。画像・ファイル入力を拒否し、上流のWeb検索やremote MCP等のホスト型ツール定義を除去する。これは審査用接続の制限として説明する必要がある。
- 上流へは `store: false`、`background: false`、`service_tier: default` を指定する。OpenAI側のあらゆる保持を無効にする保証ではない。
- Node 24.21.0に固定して検証している。台帳には標準の `node:sqlite` を使うが、Node 24ではRelease Candidate扱い。更新時は永続化・同時利用テストを必ず通す。デスクトップアプリにはこのサーバー依存を同梱しない。

## 費用を使わない検証

リポジトリのルートから実行する。WindowsまたはMacの開発環境と、`mise`・Rustビルド環境が必要。

```powershell
mise exec -- pnpm test:review
```

現在のTanzakooをビルドし、サーバーの境界テストと、管理された起動ラッパー→固定ACP→固定Codex→ローカル仲介→模擬APIを通す。空の認証領域を使用し、開発者のChatGPTログインやAPIキーは使わない。実MCPの候補作成・変更提案を一時SQLiteで確認し、本文が未変更で提案が承認待ちであること、プロセス再起動後に会話を復元できること、審査トークンがCodex保存領域へ残らないことも確認する。

これはUI操作、実AIの判断、App Sandbox内の動作を検証したものではない。CIでもMacの通常プロセスとして実行し、Sandbox検証とは分ける。

## 有料API接続を準備するとき

以下は次段階の手順であり、今回実行していない。APIキー・公開先・金額管理を決めた後に使う。HTTPS終端はホスト側に用意し、受信ヘッダー・本文のログやストリームのバッファリングを無効にする。DBは専用ユーザーだけがアクセスできる永続領域へ置く。管理CLI用のHTTPエンドポイントは設けない。

必要な環境変数：

| 名前                    | 用途                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| `TANZAKOO_RELAY_DB`     | 永続SQLiteファイルの絶対パス。親ディレクトリーを事前に用意する    |
| `OPENAI_API_KEY`        | 専用APIプロジェクトのSecret。ファイルやコマンド引数へ直書きしない |
| `TANZAKOO_RELAY_MODELS` | 許可するモデルIDのカンマ区切り。実APIで利用可能なものを明示する   |
| `TANZAKOO_RELAY_HOST`   | 既定 `127.0.0.1`。ホストが必要とする場合のみ変更する              |
| `PORT`                  | 既定 `8787`                                                       |

起動は `mise exec -- pnpm --filter @tanzakoo/review-relay start`。台帳操作は次の形で行う。

```text
mise exec -- pnpm --filter @tanzakoo/review-relay grant issue <モデルID> <ISO形式の有効期限> <最大試行回数>
mise exec -- pnpm --filter @tanzakoo/review-relay grant list
mise exec -- pnpm --filter @tanzakoo/review-relay grant revoke <発行ID>
```

発行時のみトークンを標準出力へ表示する。審査提出先へ渡し、Git・通常ログ・共有チャットへ貼らない。`list`にはトークンを表示しない。延長や再審査は新しいトークンを発行し、不要なものを失効する。

## 依存の選定

- Fastify 5.12.5（MIT）：HTTP受付・JSON Schema検証・入力サイズ制限。独自のHTTPルーターを作らず、Node 24.21.0で実際のストリーム転送を検証した。[公式サポート方針](https://fastify.dev/docs/latest/Reference/LTS/)
- eventsource-parser 4.1.1（MIT、Node 22.12以上）：分割されたSSEの終端と使用量を読む。サイズ制限を設定し、ストリームパーサーを自作しない。
- `node:sqlite`：固定Nodeに同梱される台帳。別のネイティブDBアドオンは追加しない。[Node 24のSQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

設計全体とMacで残る確認は [検討文書](../../notes/store-review-relay.md) を参照。
