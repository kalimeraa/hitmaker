param(
  [switch]$InstallDependencies,
  [switch]$VerifyOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

function Get-EnvOrDefault {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Default
  )

  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $Default
  }

  return $value
}

function Update-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-PackageInstall {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$WingetId,
    [Parameter(Mandatory = $true)][string]$ChocolateyPackage
  )

  if (-not (Test-IsAdministrator)) {
    throw "$Label kurulumu icin PowerShell'i Administrator olarak acip tekrar calistir."
  }

  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($null -ne $winget) {
    Write-Host "$Label kuruluyor: winget $WingetId"
    & winget.exe install --id $WingetId --exact --silent --disable-interactivity --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
      throw "$Label winget kurulumu basarisiz oldu. Exit code: $LASTEXITCODE"
    }
    Update-ProcessPath
    return
  }

  $choco = Get-Command choco.exe -ErrorAction SilentlyContinue
  if ($null -ne $choco) {
    Write-Host "$Label kuruluyor: choco $ChocolateyPackage"
    & choco.exe install $ChocolateyPackage -y --no-progress
    if ($LASTEXITCODE -ne 0) {
      throw "$Label Chocolatey kurulumu basarisiz oldu. Exit code: $LASTEXITCODE"
    }
    Update-ProcessPath
    return
  }

  throw "$Label kurulumu icin winget veya Chocolatey bulunamadi. Once winget/choco kur veya $Label'i manuel kur."
}

function Ensure-CommandAvailable {
  param(
    [Parameter(Mandatory = $true)][string]$CommandName,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$WingetId,
    [Parameter(Mandatory = $true)][string]$ChocolateyPackage
  )

  if ($null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    return
  }

  if (-not $InstallDependencies) {
    throw "$CommandName bulunamadi. $Label kurulu olmali. Otomatik kurulum icin: .\startwindows.ps1 -InstallDependencies"
  }

  Invoke-PackageInstall -Label $Label -WingetId $WingetId -ChocolateyPackage $ChocolateyPackage

  if ($null -eq (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "$Label kuruldu ama $CommandName bu terminalde gorunmuyor. Yeni PowerShell acip tekrar calistir."
  }
}

function Test-PortOpen {
  param(
    [Parameter(Mandatory = $true)][string]$HostName,
    [Parameter(Mandatory = $true)][int]$Port
  )

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(1000, $false)) {
      return $false
    }
    $client.EndConnect($connect)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Start-KnownService {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string[]]$ServiceNames
  )

  foreach ($serviceName in $ServiceNames) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $service) {
      continue
    }

    if ($service.Status -ne "Running") {
      Write-Host "$Label kapali gorunuyor, Windows service baslatiliyor: $serviceName"
      Start-Service -Name $serviceName
    }
    return $true
  }

  Write-Host "$Label icin bilinen Windows service bulunamadi. Denenenler: $($ServiceNames -join ', ')"
  return $false
}

function Ensure-Port {
  param(
    [Parameter(Mandatory = $true)][string]$HostName,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string[]]$ServiceNames
  )

  if (Test-PortOpen -HostName $HostName -Port $Port) {
    return
  }

  [void](Start-KnownService -Label $Label -ServiceNames $ServiceNames)
  Start-Sleep -Seconds 2

  if (Test-PortOpen -HostName $HostName -Port $Port) {
    return
  }

  throw "$Label bulunamadi: ${HostName}:${Port}. Windows service'i baslat veya env ayarlarini duzelt."
}

function Ensure-ServicePort {
  param(
    [Parameter(Mandatory = $true)][string]$HostName,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string[]]$ServiceNames,
    [Parameter(Mandatory = $true)][string]$WingetId,
    [Parameter(Mandatory = $true)][string]$ChocolateyPackage
  )

  if (Test-PortOpen -HostName $HostName -Port $Port) {
    return
  }

  [void](Start-KnownService -Label $Label -ServiceNames $ServiceNames)
  Start-Sleep -Seconds 2

  if (Test-PortOpen -HostName $HostName -Port $Port) {
    return
  }

  if ($InstallDependencies) {
    Invoke-PackageInstall -Label $Label -WingetId $WingetId -ChocolateyPackage $ChocolateyPackage
    Start-Sleep -Seconds 5
    [void](Start-KnownService -Label $Label -ServiceNames $ServiceNames)
    Start-Sleep -Seconds 2
  }

  if (Test-PortOpen -HostName $HostName -Port $Port) {
    return
  }

  throw "$Label bulunamadi: ${HostName}:${Port}. Servisi kontrol et veya env ayarlarini duzelt."
}

function Ensure-RedisServicePort {
  if (Test-PortOpen -HostName $RedisHost -Port $RedisPort) {
    return
  }

  try {
    Ensure-ServicePort `
      -HostName $RedisHost `
      -Port $RedisPort `
      -Label "Redis/Memurai" `
      -ServiceNames @("Redis", "Memurai", "Memurai Developer", "redis-server") `
      -WingetId "Memurai.MemuraiDeveloper" `
      -ChocolateyPackage "memurai-developer"
    return
  } catch {
    if (-not $InstallDependencies) {
      throw
    }
    Write-Host "Memurai bulunamadi, Redis paketi deneniyor: $($_.Exception.Message)"
  }

  Ensure-ServicePort `
    -HostName $RedisHost `
    -Port $RedisPort `
    -Label "Redis" `
    -ServiceNames @("Redis", "redis-server") `
    -WingetId "Redis.Redis" `
    -ChocolateyPackage "redis-64"
}

function Stop-ProcessTree {
  param([AllowNull()][System.Diagnostics.Process]$Process)

  if ($null -eq $Process -or $Process.HasExited) {
    return
  }

  & taskkill.exe /PID $Process.Id /T /F | Out-Null
}

function Invoke-JavaScriptSyntaxCheck {
  $files = Get-ChildItem -Path $RootDir -Recurse -Filter "*.js" -File |
    Where-Object {
      $_.FullName -notlike "*\node_modules\*" -and
      $_.FullName -notlike "*\.git\*"
    }

  foreach ($file in $files) {
    & node.exe --check $file.FullName
    if ($LASTEXITCODE -ne 0) {
      throw "JavaScript syntax kontrolu basarisiz: $($file.FullName)"
    }
  }
}

function Invoke-WindowsVerification {
  Write-Host "Windows dogrulama basladi"
  Write-Host "Node: $(& node.exe --version)"
  Write-Host "npm: $(& npm.cmd --version)"

  Write-Host "JavaScript syntax kontrolu"
  Invoke-JavaScriptSyntaxCheck

  Write-Host "CloakBrowser kontrolu"
  & npm.cmd run browser:info
  if ($LASTEXITCODE -ne 0) {
    throw "npm run browser:info basarisiz oldu. Exit code: $LASTEXITCODE"
  }

  Write-Host "Browser kapasite onerisi"
  & node.exe -e "const service=require('./app/Services/systemCapacityService'); console.log(JSON.stringify(service.browserCapacity()));"
  if ($LASTEXITCODE -ne 0) {
    throw "Browser kapasite kontrolu basarisiz oldu. Exit code: $LASTEXITCODE"
  }

  Write-Host "Redis port kontrolu: ${env:REDIS_HOST}:${env:REDIS_PORT}"
  if (-not (Test-PortOpen -HostName $env:REDIS_HOST -Port ([int]$env:REDIS_PORT))) {
    throw "Redis/Memurai portu kapali: ${env:REDIS_HOST}:${env:REDIS_PORT}"
  }

  Write-Host "MongoDB port kontrolu: ${MongoHost}:${MongoPort}"
  if (-not (Test-PortOpen -HostName $MongoHost -Port $MongoPort)) {
    throw "MongoDB portu kapali: ${MongoHost}:${MongoPort}"
  }

  Write-Host "Dogrulama tamam: OK"
}

Ensure-CommandAvailable -CommandName "node.exe" -Label "Node.js LTS" -WingetId "OpenJS.NodeJS.LTS" -ChocolateyPackage "nodejs-lts"
Ensure-CommandAvailable -CommandName "npm.cmd" -Label "npm" -WingetId "OpenJS.NodeJS.LTS" -ChocolateyPackage "nodejs-lts"

$AppPort = [int](Get-EnvOrDefault -Name "PORT" -Default "3100")
$MongoUri = Get-EnvOrDefault -Name "MONGODB_URI" -Default "mongodb://localhost:27017/hitmaker"
$RedisHost = Get-EnvOrDefault -Name "REDIS_HOST" -Default "localhost"
$RedisPort = [int](Get-EnvOrDefault -Name "REDIS_PORT" -Default "6379")
$MongoHost = Get-EnvOrDefault -Name "MONGO_HOST" -Default "localhost"
$MongoPort = [int](Get-EnvOrDefault -Name "MONGO_PORT" -Default "27017")
$BrowserCacheDir = Join-Path $RootDir "storage\cloakbrowser"
New-Item -ItemType Directory -Force -Path $BrowserCacheDir | Out-Null
$env:CLOAKBROWSER_CACHE_DIR = Get-EnvOrDefault -Name "CLOAKBROWSER_CACHE_DIR" -Default $BrowserCacheDir

if (-not (Test-Path (Join-Path $RootDir "node_modules"))) {
  if (-not $InstallDependencies) {
    throw "node_modules yok. Once npm install calistir. Otomatik kurulum icin: .\startwindows.ps1 -InstallDependencies"
  }

  Write-Host "Node paketleri kuruluyor: npm install"
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install basarisiz oldu. Exit code: $LASTEXITCODE"
  }
}

if ($InstallDependencies) {
  Write-Host "CloakBrowser Chromium kontrol ediliyor/indiriliyor"
  & npm.cmd run browser:install
  if ($LASTEXITCODE -ne 0) {
    throw "npm run browser:install basarisiz oldu. Exit code: $LASTEXITCODE"
  }
}

Ensure-RedisServicePort
Ensure-ServicePort -HostName $MongoHost -Port $MongoPort -Label "MongoDB" -ServiceNames @("MongoDB", "MongoDB Server", "mongodb") -WingetId "MongoDB.Server" -ChocolateyPackage "mongodb"

$env:PORT = [string]$AppPort
$env:MONGODB_URI = $MongoUri
$env:REDIS_HOST = $RedisHost
$env:REDIS_PORT = [string]$RedisPort
$env:HEADLESS_DEFAULT = Get-EnvOrDefault -Name "HEADLESS_DEFAULT" -Default "true"
$env:MAX_PARALLEL_BROWSERS = Get-EnvOrDefault -Name "MAX_PARALLEL_BROWSERS" -Default "4"
$env:GOOGLE_MAX_RESULT_PAGES = Get-EnvOrDefault -Name "GOOGLE_MAX_RESULT_PAGES" -Default "10"
$env:GOOGLE_SEARCH_HL = Get-EnvOrDefault -Name "GOOGLE_SEARCH_HL" -Default "tr"
$env:GOOGLE_SEARCH_GL = Get-EnvOrDefault -Name "GOOGLE_SEARCH_GL" -Default "tr"
$env:CLOAKBROWSER_HUMANIZE = Get-EnvOrDefault -Name "CLOAKBROWSER_HUMANIZE" -Default "true"
$env:CLOAKBROWSER_HUMAN_PRESET = Get-EnvOrDefault -Name "CLOAKBROWSER_HUMAN_PRESET" -Default "careful"
$env:CLOAKBROWSER_AUTO_UPDATE = Get-EnvOrDefault -Name "CLOAKBROWSER_AUTO_UPDATE" -Default "false"
$env:CLOAKBROWSER_CACHE_DIR = Get-EnvOrDefault -Name "CLOAKBROWSER_CACHE_DIR" -Default $BrowserCacheDir
$env:REQUEST_BODY_LIMIT = Get-EnvOrDefault -Name "REQUEST_BODY_LIMIT" -Default "25mb"

Write-Host "Hitmaker Windows local mode"
Write-Host "UI: http://localhost:$env:PORT"
Write-Host "Mongo: $env:MONGODB_URI"
Write-Host "Redis: ${env:REDIS_HOST}:${env:REDIS_PORT}"
Write-Host "Headless default: $env:HEADLESS_DEFAULT"
Write-Host ""

if ($VerifyOnly) {
  Invoke-WindowsVerification
  return
}

$AppProcess = $null
$WorkerProcess = $null

try {
  $AppProcess = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") -WorkingDirectory $RootDir -NoNewWindow -PassThru
  $WorkerProcess = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "worker") -WorkingDirectory $RootDir -NoNewWindow -PassThru

  while (-not $AppProcess.HasExited -and -not $WorkerProcess.HasExited) {
    Start-Sleep -Seconds 1
    $AppProcess.Refresh()
    $WorkerProcess.Refresh()
  }
} finally {
  Stop-ProcessTree -Process $AppProcess
  Stop-ProcessTree -Process $WorkerProcess
}
