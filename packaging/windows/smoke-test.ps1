param([Parameter(Mandatory = $true)][string]$Installer)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$InstallRoot = Join-Path $env:ProgramFiles 'Hitmaker Test İstanbul'
$DataRoot = Join-Path $env:ProgramData 'Hitmaker'
$ServiceIds = @('HitmakerAppMongo', 'HitmakerAppRedis', 'HitmakerAppWeb', 'HitmakerAppWorker', 'HitmakerAppMrWorker')
$Setup = (Resolve-Path -LiteralPath $Installer).Path
$listener = $null

function Invoke-Setup([bool]$ExpectFailure = $false, [string]$ExpectedFailure = 'Port 3100 is in use') {
  # NSIS requires /D= to be the final, unquoted remainder of the command line.
  $process = Start-Process -FilePath $Setup -ArgumentList "/S /D=$InstallRoot" -PassThru
  if (-not $process.WaitForExit(360000)) { $process.Kill(); throw 'Installer timeout' }
  if ($ExpectFailure) {
    if ($process.ExitCode -eq 0) { throw 'Installer unexpectedly accepted an invalid runtime or occupied port' }
    $bootLog = Join-Path $env:TEMP 'Hitmaker-setup.log'
    if (-not (Test-Path $bootLog) -or (Get-Content $bootLog -Raw) -notmatch [regex]::Escape($ExpectedFailure)) {
      throw "Installer did not report the expected failure: $ExpectedFailure. Inspect early diagnostics."
    }
  } elseif ($process.ExitCode -notin @(0, 3010)) { throw "Installer failed: $($process.ExitCode)" }
}

function Invoke-NodeCheck([string]$File, [string[]]$Extra = @()) {
  Push-Location $DataRoot
  try {
    & (Join-Path $InstallRoot 'current\runtime\node\node.exe') $File @Extra
    if ($LASTEXITCODE -ne 0) { throw "Runtime test failed: $File" }
  } finally { Pop-Location }
}

try {
  if (Test-Path -LiteralPath $DataRoot) { throw 'Smoke test requires a clean Windows runner; existing user data will not be touched.' }
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 3100)
  $listener.Start()
  Invoke-Setup $true
  $listener.Stop(); $listener = $null
  Write-Output 'PASS occupied port rejected'
  Invoke-Setup
  if (@(Get-Service -Name $ServiceIds | Where-Object { $_.Status -eq 'Running' }).Count -ne 5) { throw 'Not all services are running' }
  if (-not (Test-Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Hitmaker')) { throw 'Windows uninstall entry missing' }
  $check = Join-Path $InstallRoot 'current\installer\check-runtime.js'
  Invoke-NodeCheck $check @('--browser')
  $stateProbe = Join-Path $PSScriptRoot 'smoke-state.js'
  Invoke-NodeCheck $stateProbe @($InstallRoot, 'write')
  $sentinel = Join-Path $DataRoot 'storage\synthetic-smoke.txt'
  Set-Content -LiteralPath $sentinel -Value 'preserve-me'
  $config = Join-Path $DataRoot '.env'
  $configHash = (Get-FileHash -LiteralPath $config).Hash
  Write-Output 'PASS clean offline installation, all services, UI, browser and registration'

  foreach ($id in @('HitmakerAppMrWorker', 'HitmakerAppWorker', 'HitmakerAppWeb', 'HitmakerAppRedis', 'HitmakerAppMongo')) { Stop-Service $id }
  foreach ($id in $ServiceIds) { Start-Service $id }
  Invoke-NodeCheck $check
  Invoke-NodeCheck $stateProbe @($InstallRoot, 'read')
  Write-Output 'PASS service restart and persistent data'

  Invoke-Setup
  if ((Get-FileHash -LiteralPath $config).Hash -ne $configHash) { throw 'Upgrade changed persistent settings' }
  Invoke-NodeCheck $check @('--browser')
  Invoke-NodeCheck $stateProbe @($InstallRoot, 'read')
  Write-Output 'PASS upgrade preserves configuration, MongoDB, Redis and files'

  # _?= disables NSIS's temp self-copy so this process owns the actual teardown.
  # As with /D=, the unquoted install directory must be the final remainder.
  $uninstaller = Start-Process -FilePath (Join-Path $InstallRoot 'Uninstall.exe') -ArgumentList "/S _?=$InstallRoot" -PassThru
  if (-not $uninstaller.WaitForExit(180000) -or $uninstaller.ExitCode -ne 0) { throw 'Uninstall failed' }
  if (@(Get-Service -Name $ServiceIds -ErrorAction SilentlyContinue).Count) { throw 'Services remain after uninstall' }
  if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Uninstall deleted persistent user data' }
  if ((Get-FileHash -LiteralPath $config).Hash -ne $configHash) { throw 'Uninstall changed persistent settings' }
  Write-Output 'PASS uninstall preserves user data'

  # _?= leaves the running uninstaller behind; remove only its known file/root.
  Remove-Item -LiteralPath (Join-Path $InstallRoot 'Uninstall.exe') -Force -ErrorAction SilentlyContinue
  if ((Test-Path -LiteralPath $InstallRoot) -and @(Get-ChildItem -LiteralPath $InstallRoot -Force).Count -eq 0) {
    Remove-Item -LiteralPath $InstallRoot
  }

  # Only synthetic data exists on this clean runner. Simulate a first install
  # with a retained private config, then verify rollback allows an immediate retry.
  Remove-Item -LiteralPath (Join-Path $DataRoot 'install-state.json')
  $configBytes = [IO.File]::ReadAllBytes($config)
  try {
    $brokenConfig = [Text.Encoding]::UTF8.GetString($configBytes) -replace '(?m)^CLOAKBROWSER_BINARY_PATH=.*$', 'CLOAKBROWSER_BINARY_PATH=C:/Hitmaker-missing-browser.exe'
    [IO.File]::WriteAllText($config, $brokenConfig, [Text.UTF8Encoding]::new($false))
    Invoke-Setup $true 'Hitmaker readiness check failed'
    if (@(Get-Service -Name $ServiceIds -ErrorAction SilentlyContinue).Count) { throw 'Failed install left registered services' }
    if ((Test-Path -LiteralPath $InstallRoot) -and @(Get-ChildItem -LiteralPath $InstallRoot -Force).Count) { throw 'Failed first install left application files that prevent retry' }
    if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Failed installation deleted persistent user data' }
  } finally { [IO.File]::WriteAllBytes($config, $configBytes) }
  Write-Output 'PASS failed first install rolls back and permits retry'

  Invoke-Setup
  Invoke-NodeCheck $check @('--browser')
  Invoke-NodeCheck $stateProbe @($InstallRoot, 'read')
  if ((Get-FileHash -LiteralPath $config).Hash -ne $configHash) { throw 'Reinstall changed persistent settings' }
  Write-Output 'PASS reinstall restores access to preserved data'
} finally {
  if ($null -ne $listener) { $listener.Stop() }
}
