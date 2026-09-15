param([ValidateSet('codex', 'claude')][string]$Agent = 'codex')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$executable = Join-Path $projectRoot 'src-tauri/target/debug/tanzakoo.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw '先にcargo buildを実行してください。' }
$testRoot = Join-Path $projectRoot ".local/smoke-$Agent-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testRoot | Out-Null
function Invoke-Smoke([string]$Mode, [string]$Prompt, [string]$LogName) {
    $log = Join-Path $testRoot $LogName
    & $executable $Mode $Agent $testRoot $Prompt > $log 2>&1
    if ($LASTEXITCODE -ne 0) { throw "検証に失敗しました。ログ: $log" }
    $line = Get-Content -LiteralPath $log | Where-Object { $_.StartsWith('{"cards":') } | Select-Object -Last 1
    if (-not $line) { throw "結果がありません。ログ: $log" }
    return $line | ConvertFrom-Json
}
$initial = Invoke-Smoke '--smoke' '個人用TODOアプリを考えたい。論点を候補カードとして1枚だけ作成してください。' 'create.log'
if ($initial.cards.Count -ne 1) { throw '候補が1枚作成されていません。' }
$resumed = Invoke-Smoke '--smoke-resume' 'さっきのカードの本文を「毎朝、今日やることを三つ選ぶ」に変更する提案を1件作って。元のカードは変えず、追加カードも作らないで。' 'resume.log'
if ($resumed.cards.Count -ne 1 -or $resumed.proposals.Count -ne 1 -or $resumed.proposals[0].state -ne 'pending' -or $resumed.cards[0].revision -ne 1 -or $resumed.cards[0].body -ne $initial.cards[0].body -or $resumed.conversations[0].sessionId -ne $initial.conversations[0].sessionId) { throw '会話再開・変更提案の検証に失敗しました。' }
$null = Invoke-Smoke '--smoke-cancel' '停止動作の検証です。ツールを使わず、TODOアプリの利用場面を短く説明してください。' 'cancel.log'
if (-not (Select-String -LiteralPath (Join-Path $testRoot 'cancel.log') -SimpleMatch 'Cancellation and partial persistence: PASS' -Quiet)) { throw '停止の検証に失敗しました。' }
Write-Output "$Agent`: 起票・会話再開・変更提案・元の本文の保持・停止・部分応答の保存 PASS"
Write-Output "検証データ: $testRoot"
