# Railwayで審査用サーバーを動かす

Railwayに公開し、`gpt-6-luna` の実API応答を確認済み。ストア提出はまだ行っていない。アプリの制限は [README](README.md) を参照。

## 現在の接続先と確認範囲（2026-09-27）

- 公開origin: `https://review-relay-production-4f29.up.railway.app`
- モデル: `gpt-6-luna` のみ。専用OpenAIプロジェクトの月額上限は$2、通知は$1、自動チャージOFFで設定を進め、ユーザーから設定完了の報告を受けた。管理画面の設定値自体は自動取得していない。
- 公開URLで `/health` の200、コードなしの `/review/status` の401、発行済みコードによる状態取得を確認した。
- 実Responses APIでSSEの完了イベントと応答、台帳の試行回数減算を確認した。隔離したボードで実Codex・ACP・MCPによる候補作成と未承認提案を確認し、元の本文を保持した。
- 検証コードは24時間・20試行に限定した。ストア提出用は日程に合わせて別途発行する。コードやAPIキーはGitへ保存しない。
- 公開URLを組み込んだWindows releaseビルドが成功し、同梱Node・Codex・ACPの初期化を確認した。開発用NodeをPATHから外し、専用データ保存先で空のボード画面まで起動できた。実画面での接続・承認操作、署名済みパッケージやMac版の検証は残っている。

## 構成

- リポジトリのルートから `packages/review-relay/Dockerfile` をビルドする。Node・pnpmは `mise.toml` と同じ固定バージョン。
- `pnpm deploy --prod --frozen-lockfile` でサーバーと本番依存だけを取り出す。Rust、デスクトップアプリ、開発依存は実行イメージに含めない。Dockerの送信対象も専用 `.dockerignore` で絞る。
- SQLiteは専用Volumeの `/data/relay.sqlite`。インスタンスは1つ、審査中のスリープは無効。Volume未設定やVolume外のDB指定では起動しない。
- HTTPSはRailwayで終端し、コンテナは `0.0.0.0:$PORT` を待ち受ける。`/health` は起動確認であり、実APIや継続的な稼働監視の代わりにはならない。
- RailwayのVolumeはroot所有でマウントされるため、この専用コンテナはrootで動かす。DB・バックアップの新規作成は `umask 077`。Volumeは他サービスと共有しない。

Volumeはビルド時・Pre-deploy時には使えない。発行・失効・バックアップは、稼働中コンテナへSSH接続して行う。[Volumeの仕様](https://docs.railway.com/volumes)

## 初回設定

新規サービスでは `railway.json` / `railway.toml` によるConfig as Codeを利用できないため、この手順ではサービス画面とVariablesを使う。既存サービス向けの旧JSON設定は削除した。将来コードで管理する場合はRailway IaCへ移行する。[公式の移行案内](https://docs.railway.com/config-as-code)

1. Railwayに空のプロジェクトと専用のEmpty Serviceを作成し、最初のデプロイ前に以下を設定する。
2. **Root Directoryはリポジトリのルートのまま**にする。Variablesの `RAILWAY_DOCKERFILE_PATH` でDockerfileを指定する。`packages/review-relay` をサービスのルートにすると、共有ロックファイルを読めない。[Dockerfileの指定](https://docs.railway.com/builds/dockerfiles)
3. 専用Volumeを作成し、サービスへ接続してマウント先を **`/data`** にする。
4. Variablesに下記を設定する。APIキーは管理画面から秘密情報として登録し、Git・Dockerfile・CLI引数へ書かない。
5. SettingsのDeployで下表の値を設定する。Build Command、Start Command、Pre-deploy Commandは空欄とし、Dockerfileの指定を使う。
6. コードをGitHubへpushしてコンテナCIの成功を確認した後、SettingsのSourceからリポジトリを接続する。審査期間だけ手動で運用するため、GitHubのAutodeployは **Disable** にする。初回ビルドが自動で始まった場合は設定が揃っているか確認し、不足していればAbortしてから設定する。[自動デプロイの無効化](https://docs.railway.com/deployments/github-autodeploys)
7. 確認済みコミットをデプロイし、NetworkingでRailwayの公開ドメインを生成する。転送ポートは `8787`。`PORT` を変える場合は転送ポートも合わせる。

| Settingsの項目      | 設定値       |
| ------------------- | ------------ |
| Healthcheck Path    | `/health`    |
| Healthcheck Timeout | `30` 秒      |
| Restart Policy      | `On Failure` |
| Max Retries         | `3`          |
| Enable Serverless   | OFF          |

Volumeを使うため、1リージョン・1インスタンスで運用する。[Volumeの制約](https://docs.railway.com/volumes/reference)

| Variable                              | 設定値                                        |
| ------------------------------------- | --------------------------------------------- |
| `RAILWAY_DOCKERFILE_PATH`             | `packages/review-relay/Dockerfile`            |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `15`（終了処理の猶予）                        |
| `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`  | `0`                                           |
| `OPENAI_API_KEY`                      | 審査用の専用APIキー                           |
| `TANZAKOO_RELAY_MODELS`               | 利用を決めたモデルID。初回は1モデルに限定する |
| `TANZAKOO_RELAY_DB`                   | `/data/relay.sqlite`（Dockerfileの既定値）    |
| `TANZAKOO_RELAY_HOST`                 | `0.0.0.0`（Dockerfileの既定値）               |
| `PORT`                                | `8787`（Variablesにも明示して設定する）       |

`RAILWAY_VOLUME_MOUNT_PATH` はRailwayが実際のVolumeから注入する値を使う。手動で追加して起動確認を回避しない。サーバー自身がVolumeの有無とDBの保存先を検証する。終了猶予とデプロイの重複時間はVariablesで設定する。[設定用変数](https://docs.railway.com/variables/reference)

`PORT` はDockerfileの既定値だけに依存しない。Railwayの実行時環境変数で上書きされると、公開ドメインの転送先 `8787` と一致せず、デプロイ成功後でも502になる。VariablesとドメインのTarget Portを同じ値にし、変更をDeployしてから `/health` を再確認する。[502の対処](https://docs.railway.com/networking/troubleshooting/application-failed-to-respond)

## 審査用コードの発行と接続確認

Railway管理画面のSSH接続コマンドで対象プロジェクト・環境・サービスを確認して接続する。以降はコンテナ内で実行する。`railway run` はローカル実行なので、台帳操作には使わない。

Railway CLI 5.62.1ではログインに加えてSSH鍵の登録が必要。専用鍵を作り、`railway ssh keys add --key <鍵のパス> --name tanzakoo-railway-review` で公開鍵を登録し、接続時は `railway ssh -i <秘密鍵のパス> ...` を使う。Windowsでは `--key` に秘密鍵のWindows形式パスを指定すると、対応する `.pub` が登録された。秘密鍵そのものはアップロードしない。標準SSHを使う場合もホスト鍵の確認を維持する。[公式SSH手順](https://docs.railway.com/cli/ssh)

```text
node /app/src/admin.mjs issue <モデルID> <ISO形式の有効期限> <最大試行回数>
node /app/src/admin.mjs list
node /app/src/admin.mjs revoke <発行ID>
```

発行したコードは一度だけ表示される。審査提出先へ渡し、共有ログやリポジトリへ貼らない。1回の会話操作でツール実行を挟み、複数回のAPI試行になることがある。試行回数は金額上限の保証ではない。

公開URLの `/health` が200を返し、コードなしの `/review/status` が401になることを確認する。公開HTTPSのoriginをビルド時の `TANZAKOO_REVIEW_URL` に設定したアプリで「審査用アクセス」を開き、コード確認・期限・モデルの表示を確認する。ここまではAI呼び出し枠を消費しない。実API・ストリーミング・カード提案の確認は、予算管理を用意してから行う。

### Windowsで公開URLを組み込んで検証する

同梱ランタイムは `mise exec -- pnpm runtime:stage` で準備する。ラッパーや固定依存を更新した後は、既存の `src-tauri/resources/agent-runtime` を作業用の退避先へ移してから再実行する。古い配置のままビルドしない。

```powershell
$env:TANZAKOO_REVIEW_URL = 'https://review-relay-production-4f29.up.railway.app'
mise exec -- pnpm build:desktop
```

生成物は `src-tauri/target/release/tanzakoo.exe` と、隣接する `agent-runtime` ディレクトリ。これは署名・インストーラー作成前の実行ファイルで、ストア提出用パッケージではない。検証では `TANZAKOO_DATA_DIR` に専用の絶対パスを指定し、通常のプロジェクトやCodex認証と分離して起動する。releaseの接続先は起動時の環境変数では変更できず、URL変更時には再ビルドが必要。

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

同じサービスとVolumeを残している場合は、APIキー・許可モデル・Volume・サービス設定を確認してデプロイし直す。`list` で過去の使用量・失効が残っていることを確認してから、新しい期限とコードを発行する。アプリに埋め込んだ公開originを維持する。

Volumeを作り直す場合は、停止時に取得した**失効済み台帳**を新しいVolumeへ復元し、DBの絶対パスを確認してから起動する。稼働中DBへの上書きや、古い有効コードを含むバックアップへの巻き戻しはしない。古い使用回数へ戻るため、復元後の再審査には必ず新しいコードを使う。

## 費用を使わない検証

サーバーのテストは `mise exec -- pnpm --filter @tanzakoo/review-relay test`。Volume設定の拒否と、稼働中台帳からのバックアップ・失効・使用回数の保持も検証する。

Dockerが使えるLinux / macOS環境では、リポジトリのルートで次を実行する。

```sh
docker build -f packages/review-relay/Dockerfile -t tanzakoo-review-relay:check .
bash scripts/review-container-smoke.sh tanzakoo-review-relay:check
```

CIの `review-relay-container` も同じイメージをビルドし、起動・失効・バックアップ・SIGTERM終了・Volumeを維持したコンテナ再作成を検証する。検証用コンテナの外部通信を無効にし、実APIキーは使わない。ローカル環境にDockerがない場合、コンテナ検証済みとは扱わずCI結果を確認する。
