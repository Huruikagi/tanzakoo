# Railwayで審査用サーバーを動かす

Dockerfileと設定を用意した段階。Railwayのプロジェクト作成・契約・公開、有料API呼び出しはまだ行っていない。初回公開前に、利用モデル・予算管理・データ保持説明を決め、コンテナのCIを通す。アプリの制限は [README](README.md) を参照。

## 構成

- リポジトリのルートから `packages/review-relay/Dockerfile` をビルドする。Node・pnpmは `mise.toml` と同じ固定バージョン。
- `pnpm deploy --prod --frozen-lockfile` でサーバーと本番依存だけを取り出す。Rust、デスクトップアプリ、開発依存は実行イメージに含めない。Dockerの送信対象も専用 `.dockerignore` で絞る。
- SQLiteは専用Volumeの `/data/relay.sqlite`。インスタンスは1つ、審査中のスリープは無効。Volume未設定やVolume外のDB指定では起動しない。
- HTTPSはRailwayで終端し、コンテナは `0.0.0.0:$PORT` を待ち受ける。`/health` は起動確認であり、実APIや継続的な稼働監視の代わりにはならない。
- RailwayのVolumeはroot所有でマウントされるため、この専用コンテナはrootで動かす。DB・バックアップの新規作成は `umask 077`。Volumeは他サービスと共有しない。

Volumeはビルド時・Pre-deploy時には使えない。発行・失効・バックアップは、稼働中コンテナへSSH接続して行う。[Volumeの仕様](https://docs.railway.com/volumes)

## 初回設定

1. Railwayに専用サービスを作成し、このリポジトリを接続する。最初のデプロイ前に以下を設定する。
2. **Root Directoryはリポジトリのルートのまま**にする。Railway Config Fileには **`/packages/review-relay/railway.json`** を指定する。Dockerfileだけをサービスのルートにすると、共有ロックファイルを読めない。
3. 専用Volumeを作成し、マウント先を **`/data`** にする。JSON設定はVolume自体を作成しない。
4. Variablesに下記を設定する。APIキーは管理画面から秘密情報として登録し、Git・Dockerfile・CLI引数へ書かない。
5. 審査期間だけ手動で運用するため、GitHubのAutodeployは **Disable** にする。Build Command、Start Command、Pre-deploy Commandは空欄とし、DockerfileとJSONの指定を使う。
6. コンテナCI成功を確認したコミットをデプロイし、NetworkingでRailwayの公開ドメインを生成する。転送ポートは `8787`。`PORT` を変える場合は転送ポートも合わせる。

| Variable                | 設定値                                        |
| ----------------------- | --------------------------------------------- |
| `OPENAI_API_KEY`        | 審査用の専用APIキー                           |
| `TANZAKOO_RELAY_MODELS` | 利用を決めたモデルID。初回は1モデルに限定する |
| `TANZAKOO_RELAY_DB`     | `/data/relay.sqlite`（Dockerfileの既定値）    |
| `TANZAKOO_RELAY_HOST`   | `0.0.0.0`（Dockerfileの既定値）               |
| `PORT`                  | `8787`（Dockerfileの既定値）                  |

`RAILWAY_VOLUME_MOUNT_PATH` はRailwayが実際のVolumeから注入する値を使う。手動で追加して起動確認を回避しない。JSONは1レプリカ・`/data` 必須・起動ヘルスチェック30秒・異常終了時の再試行3回・終了猶予15秒を指定する。[設定ファイル](https://docs.railway.com/config-as-code/reference)、[自動デプロイの無効化](https://docs.railway.com/deployments/github-autodeploys)

## 審査用コードの発行と接続確認

Railway管理画面のSSH接続コマンドで対象プロジェクト・環境・サービスを確認して接続する。以降はコンテナ内で実行する。`railway run` はローカル実行なので、台帳操作には使わない。

```text
node /app/src/admin.mjs issue <モデルID> <ISO形式の有効期限> <最大試行回数>
node /app/src/admin.mjs list
node /app/src/admin.mjs revoke <発行ID>
```

発行したコードは一度だけ表示される。審査提出先へ渡し、共有ログやリポジトリへ貼らない。1回の会話操作でツール実行を挟み、複数回のAPI試行になることがある。試行回数は金額上限の保証ではない。

公開URLの `/health` が200を返し、コードなしの `/review/status` が401になることを確認する。公開HTTPSのoriginをビルド時の `TANZAKOO_REVIEW_URL` に設定したアプリで「審査用アクセス」を開き、コード確認・期限・モデルの表示を確認する。ここまではAI呼び出し枠を消費しない。実API・ストリーミング・カード提案の確認は、予算管理を用意してから行う。

提出時は仲介の目的、送信先、指定モデルと期限付きアクセスであること、通常接続との違いを審査メモに明記する。追加確認や再審査が終わるまではサーバーを止めない。

## 審査後に停止する

1. GitHub AutodeployがDisableで、待機中・実行中の別デプロイがないことを確認する。
2. 管理CLIの `list` にある有効コードを `revoke` で失効する。実行中のリクエストが終了するまで待つ。
3. コンテナ内で、未使用の保存先へバックアップする。

   ```text
   node /app/src/admin.mjs backup /data/relay-retired-YYYYMMDD.sqlite
   ```

   SQLiteの `VACUUM INTO` で、WALを含む整合性のあるスナップショットを作る。稼働中の `relay.sqlite` だけをコピーしない。非空の既存バックアップは上書きしない。

4. ローカル端末で対象プロジェクト・環境をリンク済みであることを確認し、バックアップを非共有領域へ取得する。Volume内のパスはマウント先 `/data` を除いて指定する。

   ```text
   railway volume files --volume <Volume名> download /relay-retired-YYYYMMDD.sqlite <ローカル保存先>
   ```

   ファイルサイズと、取得したDBを `TANZAKOO_RELAY_DB` に指定した管理CLIの `list` で失効済みの台帳が読めることを確認する。[RailwayのVolume操作](https://docs.railway.com/cli/volume)

5. 対象を確認して、稼働中デプロイの **Remove**、またはリンク済み環境で `railway down --service <サービス名> --environment <環境名>` を実行する。公開URLが応答しなくなり、稼働中デプロイがないことを管理画面で確認する。

`railway down` は最新の成功デプロイを停止し、サービス設定を残す。[停止コマンド](https://docs.railway.com/cli/down)

停止だけではプランの基本料金やVolume等の費用がなくなるとは限らない。契約を解約する場合は、同じWorkspaceの他サービスへの影響とデータ保持期間を確認し、外部バックアップを先に取得する。[料金FAQ](https://docs.railway.com/pricing/faqs)

## 再審査で再開する

同じサービスとVolumeを残している場合は、APIキー・許可モデル・Volume・設定ファイルを確認してデプロイし直す。`list` で過去の使用量・失効が残っていることを確認してから、新しい期限とコードを発行する。アプリに埋め込んだ公開originを維持する。

Volumeを作り直す場合は、停止時に取得した**失効済み台帳**を新しいVolumeへ復元し、DBの絶対パスを確認してから起動する。稼働中DBへの上書きや、古い有効コードを含むバックアップへの巻き戻しはしない。古い使用回数へ戻るため、復元後の再審査には必ず新しいコードを使う。

## 費用を使わない検証

サーバーのテストは `mise exec -- pnpm --filter @tanzakoo/review-relay test`。Volume設定の拒否と、稼働中台帳からのバックアップ・失効・使用回数の保持も検証する。

Dockerが使えるLinux / macOS環境では、リポジトリのルートで次を実行する。

```sh
docker build -f packages/review-relay/Dockerfile -t tanzakoo-review-relay:check .
bash scripts/review-container-smoke.sh tanzakoo-review-relay:check
```

CIの `review-relay-container` も同じイメージをビルドし、起動・失効・バックアップ・SIGTERM終了・Volumeを維持したコンテナ再作成を検証する。検証用コンテナの外部通信を無効にし、実APIキーは使わない。ローカル環境にDockerがない場合、コンテナ検証済みとは扱わずCI結果を確認する。
