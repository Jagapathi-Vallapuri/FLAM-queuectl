param(
  [switch]$Fast,
  [int]$Workers = 2,
  [int]$Poll = 300,
  [int]$DelaySeconds = 5,
  [switch]$UseGlobal
)

$ErrorActionPreference = 'Stop'

function Write-Section($text) {
  Write-Host "`n== $text ==" -ForegroundColor Cyan
}

function Queuectl {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Cmd
  )
  $cmdLine = "queuectl " + ($Cmd -join ' ')
  Write-Host "`n> $cmdLine" -ForegroundColor Yellow
  if ($UseGlobal) {
    & queuectl @Cmd
  } else {
    $bin = Join-Path (Join-Path (Join-Path $PSScriptRoot '..') 'bin') 'queuectl.js'
    & node $bin @Cmd
  }
}

try {
  $demoHome = Join-Path $env:TEMP ("queuectl-demo-" + [guid]::NewGuid().ToString())
  $env:QUEUECTL_HOME = $demoHome
  Write-Host "Using QUEUECTL_HOME=$demoHome" -ForegroundColor Green

  # 1. Help
  Write-Section 'CLI help'
  Queuectl --help

  # 2. Enqueue jobs
  Write-Section 'Enqueue jobs (success, failing, delayed+priority)'
  Queuectl enqueue 'echo "Hello Demo"'
  Queuectl enqueue 'node -e "process.exit(1)"'
  $runAt = ([DateTime]::UtcNow.AddSeconds($DelaySeconds)).ToString('o')
  $json = '{"command":"echo Delayed","run_at":"' + $runAt + '","priority":5}'
  Queuectl enqueue $json

  # 3. Status
  Write-Section 'Status before workers'
  Queuectl status

  # 4. Start workers
  Write-Section "Start $Workers worker(s)"
  Queuectl worker start --count "$Workers" --poll-interval "$Poll"

  $wait1 = if ($Fast) { 3 } else { 8 }
  Write-Host "Waiting $wait1 second(s) for processing..." -ForegroundColor DarkCyan
  Start-Sleep -Seconds $wait1

  # 5. Status after processing
  Write-Section 'Status after processing'
  Queuectl status

  # 6. Logs listing
  Write-Section 'Job logs summary'
  $logDir = Join-Path $demoHome 'logs'
  if (Test-Path $logDir) { Get-ChildItem -Path $logDir | Select-Object Name, Length } else { Write-Host '(no logs yet)' }

  # 7. DLQ list and retry
  Write-Section 'DLQ list'
  $dlqJson = & {
    if ($UseGlobal) { queuectl dlq list } else { $bin = Join-Path (Join-Path (Join-Path $PSScriptRoot '..') 'bin') 'queuectl.js'; node $bin dlq list }
  } | Out-String
  Write-Host $dlqJson
  try {
    $dlq = $dlqJson | ConvertFrom-Json
    if ($dlq -and $dlq.Count -ge 1) {
      $id = $dlq[0].id
      Write-Section "Retry DLQ id: $id"
      Queuectl dlq retry $id
      $wait2 = if ($Fast) { 2 } else { 4 }
      Start-Sleep -Seconds $wait2
      Queuectl status
    }
  } catch {}

  # 8. List dead via list --state dead
  Write-Section 'List dead via list --state dead'
  Queuectl list --state dead

  # 9. Config get/set
  Write-Section 'Config get/set demo'
  Queuectl config get max_retries
  Queuectl config set max_retries 5
  Queuectl config get max_retries

  # 10. Stop workers
  Write-Section 'Stop workers'
  Queuectl worker stop
  Queuectl status

  Write-Host "`nDemo complete. You can remove $demoHome when done." -ForegroundColor Green
} catch {
  Write-Error $_
  exit 1
}
