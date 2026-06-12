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
$MongoDbChocolateyVersion = "7.0.35"

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

function Test-DotNet48Installed {
  $release = Get-ItemPropertyValue `
    -Path "HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" `
    -Name Release `
    -ErrorAction SilentlyContinue

  return ($null -ne $release -and [int]$release -ge 528040)
}

function Install-DotNet48 {
  if (Test-DotNet48Installed) {
    return
  }

  $installerUrl = "https://download.visualstudio.microsoft.com/download/pr/2d6bb6b2-226a-4baa-bdec-798822606ff1/8494001c276a4b96804cde7829c04d7f/ndp48-x86-x64-allos-enu.exe"
  $installerPath = Join-Path $env:TEMP "ndp48-x86-x64-allos-enu.exe"

  Write-Host ".NET Framework 4.8 indiriliyor"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

  Write-Host ".NET Framework 4.8 kuruluyor"
  $process = Start-Process -FilePath $installerPath -ArgumentList "/quiet", "/norestart" -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) {
    throw ".NET Framework 4.8 kurulumu basarisiz oldu. Exit code: $($process.ExitCode)"
  }

  throw ".NET Framework 4.8 kuruldu veya kurulum tamamlanmak icin reboot istiyor. Sunucuyu reboot edip setup-windows.cmd komutunu tekrar calistir."
}

function Ensure-Chocolatey {
  Install-DotNet48

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
    & winget.exe install --id $WingetId --exact --silent --disable-interactivity --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -eq 0) {
      Update-ProcessPath
      return
    }
    Write-Host "winget kurulumu basarisiz oldu, Chocolatey deneniyor. Exit code: $LASTEXITCODE"
  }

  Ensure-Chocolatey
  Write-Host "$Label kuruluyor: choco $ChocolateyPackage"
  & choco.exe install $ChocolateyPackage -y --no-progress
  if ($LASTEXITCODE -ne 0) {
    throw "$Label Chocolatey kurulumu basarisiz oldu. Exit code: $LASTEXITCODE"
  }
  Update-ProcessPath
}

function Invoke-ChocolateyInstaller {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$ChocolateyPackage,
    [string]$Version = ""
  )

  Ensure-Chocolatey
  Write-Host "$Label kuruluyor: choco $ChocolateyPackage $Version"
  $arguments = @("install", $ChocolateyPackage, "-y", "--no-progress")
  if (-not [string]::IsNullOrWhiteSpace($Version)) {
    $arguments += "--version=$Version"
  }
  & choco.exe @arguments
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

function Resolve-ServiceName {
  param([Parameter(Mandatory = $true)][string[]]$ServiceNames)

  foreach ($serviceName in $ServiceNames) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -ne $service) {
      return $serviceName
    }
  }

  return ""
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
    $resolvedServiceName = Resolve-ServiceName -ServiceNames $ServiceNames
    return $resolvedServiceName
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
        return $serviceName
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
        return $serviceName
      }
    }
  }

  throw "$Label kuruldu ama port acilmadi: ${HostName}:${Port}. Denenen servisler: $($ServiceNames -join ', ')"
}

function Repair-MongoDbServiceConfig {
  $mongoService = Get-Service -Name "MongoDB" -ErrorAction SilentlyContinue
  if ($null -eq $mongoService) {
    return
  }

  $mongoBaseDir = Join-Path $env:ProgramData "MongoDB"
  $mongoDataDir = Join-Path $mongoBaseDir "data\db"
  $mongoLogDir = Join-Path $mongoBaseDir "log"
  $mongoConfigPath = Join-Path $mongoBaseDir "mongod.cfg"
  $mongoLogPath = Join-Path $mongoLogDir "mongod.log"

  New-Item -ItemType Directory -Force -Path $mongoDataDir, $mongoLogDir | Out-Null
  & icacls.exe $mongoBaseDir /grant "NT AUTHORITY\NetworkService:(OI)(CI)F" /T | Out-Null

  @"
systemLog:
  destination: file
  path: $($mongoLogPath.Replace("\", "/"))
  logAppend: true
storage:
  dbPath: $($mongoDataDir.Replace("\", "/"))
net:
  bindIp: 127.0.0.1
  port: 27017
"@ | Set-Content -Path $mongoConfigPath -Encoding ASCII

  $mongoBinary = Get-ChildItem -Path "C:\Program Files\MongoDB\Server" -Filter "mongod.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*\Server\7.0\*" } |
    Select-Object -First 1

  if ($null -eq $mongoBinary) {
    $mongoBinary = Get-ChildItem -Path "C:\Program Files\MongoDB\Server" -Filter "mongod.exe" -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notlike "*\Server\8.*\*" } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
  }

  if ($null -eq $mongoBinary) {
    throw "MongoDB binary bulunamadi: C:\Program Files\MongoDB\Server\**\mongod.exe"
  }

  $binaryPath = "`"$($mongoBinary.FullName)`" --config `"$mongoConfigPath`" --service"
  & sc.exe config MongoDB binPath= $binaryPath start= auto | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "MongoDB service config guncellenemedi. Exit code: $LASTEXITCODE"
  }
}

function Ensure-MongoDbServicePort {
  if (Test-PortOpen -HostName "localhost" -Port 27017) {
    $resolvedServiceName = Resolve-ServiceName -ServiceNames @("MongoDB", "MongoDB Server", "mongodb")
    return $resolvedServiceName
  }

  $mongoService = Get-Service -Name "MongoDB" -ErrorAction SilentlyContinue
  if ($null -ne $mongoService) {
    $serviceConfig = & sc.exe qc MongoDB
    $usesMongo8 = ($serviceConfig -join "`n") -match "\\Server\\8\."
    if ($usesMongo8) {
      Write-Host "MongoDB 8.x bu Windows imajinda uyumsuz gorundu. 7.0.x'e geciliyor."
      if ($mongoService.Status -ne "Stopped") {
        Stop-Service -Name "MongoDB" -Force
        Start-Sleep -Seconds 2
      }
      & choco.exe uninstall mongodb -y --no-progress
      if ($LASTEXITCODE -ne 0) {
        Write-Host "MongoDB Chocolatey uninstall basarisiz oldu, devam ediliyor. Exit code: $LASTEXITCODE"
      }
      Start-Sleep -Seconds 2
    }
  }

  if ($null -eq (Get-ChildItem -Path "C:\Program Files\MongoDB\Server" -Filter "mongod.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*\Server\7.0\*" } |
    Select-Object -First 1)) {
    Invoke-ChocolateyInstaller -Label "MongoDB $MongoDbChocolateyVersion" -ChocolateyPackage "mongodb" -Version $MongoDbChocolateyVersion
  }

  Repair-MongoDbServiceConfig
  Start-Service -Name "MongoDB"
  Start-Sleep -Seconds 5
  if (-not (Test-PortOpen -HostName "localhost" -Port 27017)) {
    throw "MongoDB 7.0 kuruldu/config onarildi ama port acilmadi. Log: C:\ProgramData\MongoDB\log\mongod.log"
  }

  return "MongoDB"
}

function Ensure-RedisServicePort {
  if (Test-PortOpen -HostName $RedisHost -Port ([int]$RedisPort)) {
    $resolvedServiceName = Resolve-ServiceName -ServiceNames @("Redis", "Memurai", "Memurai Developer", "redis-server")
    return $resolvedServiceName
  }

  try {
    $memuraiServiceName = Ensure-WindowsServicePort `
      -Label "Redis/Memurai" `
      -HostName $RedisHost `
      -Port ([int]$RedisPort) `
      -ServiceNames @("Redis", "Memurai", "Memurai Developer", "redis-server") `
      -WingetId "Memurai.MemuraiDeveloper" `
      -ChocolateyPackage "memurai-developer"
    return $memuraiServiceName
  } catch {
    Write-Host "Memurai kurulumu/baslatma basarisiz oldu, Redis paketi deneniyor: $($_.Exception.Message)"
  }

  $redisServiceName = Ensure-WindowsServicePort `
    -Label "Redis" `
    -HostName $RedisHost `
    -Port ([int]$RedisPort) `
    -ServiceNames @("Redis", "redis-server") `
    -WingetId "Redis.Redis" `
    -ChocolateyPackage "redis-64"
  return $redisServiceName
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
    [Parameter(Mandatory = $true)][string]$ScriptFile,
    [string[]]$DependencyServiceNames = @()
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
  & $NssmPath set $Name AppExit Default Restart
  & $NssmPath set $Name AppThrottle 1500
  if ($DependencyServiceNames.Count) {
    & $NssmPath set $Name DependOnService $DependencyServiceNames
  }
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
$redisServiceName = Ensure-RedisServicePort
try {
$mongoServiceName = Ensure-MongoDbServicePort
} catch {
  throw "MongoDB kurulumu/baslatma basarisiz: $($_.Exception.Message)"
}
$dependencyServices = @($redisServiceName, $mongoServiceName) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

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
Install-HitmakerService -NssmPath $nssmPath -Name "HitmakerWeb" -DisplayName "Hitmaker Web" -ScriptFile "server.js" -DependencyServiceNames $dependencyServices
Install-HitmakerService -NssmPath $nssmPath -Name "HitmakerWorker" -DisplayName "Hitmaker Worker" -ScriptFile "worker.js" -DependencyServiceNames $dependencyServices
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
