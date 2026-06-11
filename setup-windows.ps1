param(
  [switch]$NoStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogsDir = Join-Path $RootDir "storage\logs"
$BrowserCacheDir = Join-Path $RootDir "storage\cloakbrowser"
$AppPort = if ([string]::IsNullOrWhiteSpace($env:PORT)) { 3100 } else { [int]$env:PORT }
$MongoUri = if ([string]::IsNullOrWhiteSpace($env:MONGODB_URI)) { "mongodb://localhost:27017/hitmaker" } else { $env:MONGODB_URI }
$RedisHost = if ([string]::IsNullOrWhiteSpace($env:REDIS_HOST)) { "localhost" } else { $env:REDIS_HOST }
$RedisPort = if ([string]::IsNullOrWhiteSpace($env:REDIS_PORT)) { "6379" } else { $env:REDIS_PORT }

Set-Location $RootDir

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Restart-Elevated {
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
  if ($NoStart) {
    $args += "-NoStart"
  }
  Start-Process -FilePath "powershell.exe" -ArgumentList $args -Verb RunAs
}

function Update-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Ensure-Chocolatey {
  if ($null -ne (Get-Command choco.exe -ErrorAction SilentlyContinue)) {
    return
  }

  Write-Host "Chocolatey kuruluyor"
  Set-ExecutionPolicy Bypass -Scope Process -Force
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-Expression ((New-Object Net.WebClient).DownloadString("https://community.chocolatey.org/install.ps1"))
  Update-ProcessPath

  if ($null -eq (Get-Command choco.exe -ErrorAction SilentlyContinue)) {
    throw "Chocolatey kuruldu ama bu terminalde gorunmuyor. Yeni Administrator PowerShell acip tekrar calistir."
  }
}

function Invoke-Installer {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$WingetId,
    [Parameter(Mandatory = $true)][string]$ChocolateyPackage
  )

  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($null -ne $winget) {
    Write-Host "$Label kuruluyor: winget $WingetId"
    & winget.exe install --id $WingetId --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -eq 0) {
      Update-ProcessPath
      return
    }
    Write-Host "winget kurulumu basarisiz oldu, Chocolatey deneniyor. Exit code: $LASTEXITCODE"
  }

  Ensure-Chocolatey
  Write-Host "$Label kuruluyor: choco $ChocolateyPackage"
  & choco.exe install $ChocolateyPackage -y
  if ($LASTEXITCODE -ne 0) {
    throw "$Label Chocolatey kurulumu basarisiz oldu. Exit code: $LASTEXITCODE"
  }
  Update-ProcessPath
}

function Ensure-Command {
  param(
    [Parameter(Mandatory = $true)][string]$CommandName,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$WingetId,
    [Parameter(Mandatory = $true)][string]$ChocolateyPackage
  )

  if ($null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    return
  }

  Invoke-Installer -Label $Label -WingetId $WingetId -ChocolateyPackage $ChocolateyPackage

  if ($null -eq (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "$Label kuruldu ama $CommandName bulunamadi. Yeni Administrator PowerShell acip tekrar calistir."
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
    if (-not $connect.AsyncWaitHandle.WaitOne(1500, $false)) {
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

function Ensure-WindowsServicePort {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$HostName,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string[]]$ServiceNames,
    [Parameter(Mandatory = $true)][string]$WingetId,
    [Parameter(Mandatory = $true)][string]$ChocolateyPackage
  )

  if (Test-PortOpen -HostName $HostName -Port $Port) {
    return
  }

  foreach ($serviceName in $ServiceNames) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -ne $service) {
      if ($service.Status -ne "Running") {
        Write-Host "$Label servisi baslatiliyor: $serviceName"
        Start-Service -Name $serviceName
        Start-Sleep -Seconds 4
      }
      if (Test-PortOpen -HostName $HostName -Port $Port) {
        return
      }
    }
  }

  Invoke-Installer -Label $Label -WingetId $WingetId -ChocolateyPackage $ChocolateyPackage

  foreach ($serviceName in $ServiceNames) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -ne $service) {
      if ($service.Status -ne "Running") {
        Start-Service -Name $serviceName
        Start-Sleep -Seconds 4
      }
      if (Test-PortOpen -HostName $HostName -Port $Port) {
        return
      }
    }
  }

  throw "$Label kuruldu ama port acilmadi: ${HostName}:${Port}. Denenen servisler: $($ServiceNames -join ', ')"
}

function Find-Nssm {
  $command = Get-Command nssm.exe -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  $chocoNssm = Join-Path $env:ProgramData "chocolatey\bin\nssm.exe"
  if (Test-Path $chocoNssm) {
    return $chocoNssm
  }

  Invoke-Installer -Label "NSSM" -WingetId "NSSM.NSSM" -ChocolateyPackage "nssm"
  $command = Get-Command nssm.exe -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }
  if (Test-Path $chocoNssm) {
    return $chocoNssm
  }

  throw "NSSM bulunamadi."
}

function Remove-ServiceIfExists {
  param(
    [Parameter(Mandatory = $true)][string]$NssmPath,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if ($null -eq $service) {
    return
  }

  if ($service.Status -ne "Stopped") {
    Stop-Service -Name $Name -Force
    Start-Sleep -Seconds 2
  }
  & $NssmPath remove $Name confirm
  if ($LASTEXITCODE -ne 0) {
    throw "$Name service kaldirilamadi. Exit code: $LASTEXITCODE"
  }
}

function Install-HitmakerService {
  param(
    [Parameter(Mandatory = $true)][string]$NssmPath,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$DisplayName,
    [Parameter(Mandatory = $true)][string]$ScriptFile
  )

  $nodePath = (Get-Command node.exe).Source
  $scriptPath = Join-Path $RootDir $ScriptFile
  $stdoutPath = Join-Path $LogsDir "$Name.out.log"
  $stderrPath = Join-Path $LogsDir "$Name.err.log"
  $envPairs = @(
    "PORT=$AppPort",
    "MONGODB_URI=$MongoUri",
    "REDIS_HOST=$RedisHost",
    "REDIS_PORT=$RedisPort",
    "HEADLESS_DEFAULT=true",
    "MAX_PARALLEL_BROWSERS=4",
    "GOOGLE_MAX_RESULT_PAGES=10",
    "GOOGLE_SEARCH_HL=tr",
    "GOOGLE_SEARCH_GL=tr",
    "CLOAKBROWSER_HUMANIZE=true",
    "CLOAKBROWSER_HUMAN_PRESET=careful",
    "CLOAKBROWSER_AUTO_UPDATE=false",
    "CLOAKBROWSER_CACHE_DIR=$BrowserCacheDir",
    "REQUEST_BODY_LIMIT=25mb"
  )

  Remove-ServiceIfExists -NssmPath $NssmPath -Name $Name

  & $NssmPath install $Name $nodePath $scriptPath
  if ($LASTEXITCODE -ne 0) {
    throw "$Name service kurulumu basarisiz. Exit code: $LASTEXITCODE"
  }

  & $NssmPath set $Name DisplayName $DisplayName
  & $NssmPath set $Name AppDirectory $RootDir
  & $NssmPath set $Name AppStdout $stdoutPath
  & $NssmPath set $Name AppStderr $stderrPath
  & $NssmPath set $Name AppRotateFiles 1
  & $NssmPath set $Name AppRotateOnline 1
  & $NssmPath set $Name AppRotateBytes 10485760
  & $NssmPath set $Name Start SERVICE_AUTO_START
  & $NssmPath set $Name AppEnvironmentExtra $envPairs

  Write-Host "$DisplayName service kuruldu"
}

function New-PanelShortcut {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktop "Hitmaker Panel.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "$env:SystemRoot\explorer.exe"
  $shortcut.Arguments = "http://localhost:$AppPort"
  $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
  $shortcut.Save()
}

function Test-HttpHealth {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$AppPort/api/health" -UseBasicParsing -TimeoutSec 10
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-IsAdministrator)) {
  Write-Host "Administrator izni gerekiyor. Script yukseltilmis PowerShell olarak yeniden aciliyor."
  Restart-Elevated
  exit 0
}

New-Item -ItemType Directory -Force -Path $LogsDir, $BrowserCacheDir | Out-Null

Ensure-Command -CommandName "node.exe" -Label "Node.js LTS" -WingetId "OpenJS.NodeJS.LTS" -ChocolateyPackage "nodejs-lts"
Ensure-Command -CommandName "npm.cmd" -Label "npm" -WingetId "OpenJS.NodeJS.LTS" -ChocolateyPackage "nodejs-lts"
Ensure-WindowsServicePort -Label "Redis/Memurai" -HostName "localhost" -Port 6379 -ServiceNames @("Redis", "Memurai") -WingetId "Memurai.MemuraiDeveloper" -ChocolateyPackage "memurai-developer"
Ensure-WindowsServicePort -Label "MongoDB" -HostName "localhost" -Port 27017 -ServiceNames @("MongoDB", "MongoDB Server") -WingetId "MongoDB.Server" -ChocolateyPackage "mongodb"

Write-Host "Node paketleri kuruluyor/kontrol ediliyor"
& npm.cmd install
if ($LASTEXITCODE -ne 0) {
  throw "npm install basarisiz oldu. Exit code: $LASTEXITCODE"
}

$env:CLOAKBROWSER_CACHE_DIR = $BrowserCacheDir
Write-Host "CloakBrowser Chromium kuruluyor/kontrol ediliyor"
& npm.cmd run browser:install
if ($LASTEXITCODE -ne 0) {
  throw "npm run browser:install basarisiz oldu. Exit code: $LASTEXITCODE"
}

$nssmPath = Find-Nssm
Install-HitmakerService -NssmPath $nssmPath -Name "HitmakerWeb" -DisplayName "Hitmaker Web" -ScriptFile "server.js"
Install-HitmakerService -NssmPath $nssmPath -Name "HitmakerWorker" -DisplayName "Hitmaker Worker" -ScriptFile "worker.js"
New-PanelShortcut

if (-not $NoStart) {
  Start-Service -Name "HitmakerWeb"
  Start-Service -Name "HitmakerWorker"
  Start-Sleep -Seconds 5
}

Write-Host "Servis durumu:"
Get-Service -Name "HitmakerWeb", "HitmakerWorker" | Format-Table -AutoSize

if (-not $NoStart) {
  if (Test-HttpHealth) {
    Write-Host "Hitmaker hazir: http://localhost:$AppPort"
  } else {
    Write-Host "Hitmaker service basladi ama health endpoint henuz cevap vermedi. Loglar: $LogsDir"
  }
}

Write-Host "Kurulum tamam."
