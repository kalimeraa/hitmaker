param(
  [ValidateSet('Install', 'Uninstall')][string]$Action = 'Install',
  [string]$PayloadRoot = '',
  [Parameter(Mandatory = $true)][string]$InstallRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$DataRoot = Join-Path $env:ProgramData 'Hitmaker'
$LogRoot = Join-Path $DataRoot 'logs'
$Current = Join-Path $InstallRoot 'current'
$Previous = Join-Path $InstallRoot 'previous'
$Services = Join-Path $InstallRoot 'services'
$StatePath = Join-Path $DataRoot 'install-state.json'
$Stage = Join-Path $InstallRoot ('.staging-' + [Guid]::NewGuid().ToString('N'))
$HadPrevious = $false
$Swapped = $false
$Mutex = $null
$Locked = $false
$Transcript = $false
$CanSaveLog = $false
$BootLog = Join-Path $env:TEMP 'Hitmaker-setup.log'
$PreviousRunning = @()
$ExitCode = 0

function Assert-Platform {
  $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  if ($architecture -ne 'AMD64') { throw 'Windows x64 (Intel/AMD) is required. ARM64 and 32-bit Windows are not supported.' }
  $os = Get-CimInstance Win32_OperatingSystem
  $build = [int]$os.BuildNumber
  $supported = ($os.ProductType -eq 1 -and $build -ge 22000) -or ($os.ProductType -ne 1 -and $build -in @(17763, 20348))
  if (-not $supported) { throw 'Supported systems: Windows 11 x64, Windows Server 2019 or 2022 x64.' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator privileges are required.' }
}

function Assert-NoReparseAncestor([string]$Directory) {
  $cursor = $Directory
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Install/data directories may not use junction or symbolic-link ancestors: $cursor"
      }
    }
    $cursor = Split-Path -Parent $cursor
  }
}

function Assert-Payload {
  $manifest = Get-Content -LiteralPath (Join-Path $PayloadRoot 'integrity.json') -Raw | ConvertFrom-Json
  if (@($manifest.files).Count -lt 10) { throw 'Incomplete installer payload.' }
  foreach ($file in $manifest.files) {
    if ($file.path -match '(^|[\\/])\.\.([\\/]|$)' -or [IO.Path]::IsPathRooted($file.path)) { throw 'Unsafe payload manifest path.' }
    $absolute = Join-Path $PayloadRoot $file.path
    $item = Get-Item -LiteralPath $absolute
    if ($item.Length -ne $file.size -or (Get-FileSha256 $absolute) -ne $file.sha256) {
      throw "Installer file integrity check failed: $($file.path)"
    }
  }
  $bytes = ($manifest.files | Measure-Object -Property size -Sum).Sum
  $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($InstallRoot))
  if ($drive.AvailableFreeSpace -lt ($bytes * 2 + 300MB)) { throw 'Insufficient disk space. At least 2 GB free is recommended.' }
}

function Assert-FreePorts {
  foreach ($port in @(3100, 27031, 6388)) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
    try { $listener.Start() }
    catch { throw "Port $port is in use by another application. Close that application and run setup again." }
    finally { $listener.Stop() }
  }
}

function Initialize-Data {
  # Protect credentials and browser profiles from other local users.
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
  foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  $null = [IO.Directory]::CreateDirectory($DataRoot, $acl)
  Set-Acl -LiteralPath $DataRoot -AclObject $acl
  foreach ($folder in @('logs', 'mongo', 'redis', 'storage', 'mock-sites', 'cache')) {
    $null = [IO.Directory]::CreateDirectory((Join-Path $DataRoot $folder), $acl)
  }
  $environmentFile = Join-Path $DataRoot '.env'
  if (-not (Test-Path -LiteralPath $environmentFile)) {
    $binary = (Join-Path $Current 'runtime\browser\chrome.exe').Replace('\', '/')
    $cache = (Join-Path $DataRoot 'cache').Replace('\', '/')
    $secret = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    $settings = @(
      'HOST=127.0.0.1', 'PORT=3100', 'MONGODB_URI=mongodb://127.0.0.1:27031/hitmaker',
      'REDIS_URL=', 'REDIS_PRIVATE_URL=', 'REDIS_PUBLIC_URL=', 'REDIS_HOST=127.0.0.1', 'REDIS_PORT=6388', 'REDIS_PASSWORD=',
      'QUEUE_NAME=hitmaker-desktop', 'HEADLESS_DEFAULT=true', 'MAX_PARALLEL_BROWSERS=1', 'MR_LOGIN_MAX_BROWSERS=2',
      'AUTH_USERNAME=hitmaker', 'AUTH_PASSWORD=hitmaker34716', "AUTH_JWT_SECRET=$secret", 'REQUEST_BODY_LIMIT=25mb',
      'CLOAKBROWSER_AUTO_UPDATE=false', 'CLOAKBROWSER_HUMANIZE=true', 'CLOAKBROWSER_GEOIP=true',
      "CLOAKBROWSER_BINARY_PATH=`"$binary`"", "CLOAKBROWSER_CACHE_DIR=`"$cache`"", 'GOOGLE_SEARCH_HL=tr', 'GOOGLE_SEARCH_GL=tr'
    )
    [IO.File]::WriteAllLines($environmentFile, $settings, [Text.UTF8Encoding]::new($false))
    $fileAcl = Get-Acl -LiteralPath $environmentFile
    $fileAcl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    Set-Acl -LiteralPath $environmentFile -AclObject $fileAcl
  }
}

function Protect-ApplicationDirectory {
  $null = New-Item -ItemType Directory -Force -Path $InstallRoot
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
  foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'), 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  Set-Acl -LiteralPath $InstallRoot -AclObject $acl
}

function Install-Services {
  $null = New-Item -ItemType Directory -Force -Path $Services
  foreach ($definition in @(Get-HitmakerServiceDefinitions $InstallRoot $DataRoot)) {
    $wrapper = Join-Path $Services ($definition.Id + '.exe')
    Copy-Item -LiteralPath (Join-Path $Current 'runtime\winsw\WinSW.exe') -Destination $wrapper -Force
    [IO.File]::WriteAllText((Join-Path $Services ($definition.Id + '.xml')), (ConvertTo-ServiceXml $definition $LogRoot), [Text.UTF8Encoding]::new($false))
    Invoke-ServiceWrapper $InstallRoot $definition.Id 'install'
  }
}

try {
  # pwsh 7 -> NSIS -> Windows PowerShell 5.1 retains incompatible PS7 module paths.
  # Provisioning uses only the native Windows PowerShell built-in modules.
  $env:PSModulePath = Join-Path $PSHOME 'Modules'
  Start-Transcript -Path $BootLog -Append | Out-Null
  $Transcript = $true
  Write-Output "Preflight: 64-bit process=$([Environment]::Is64BitProcess); ProgramFiles=$([Environment]::GetFolderPath('ProgramFiles')); destination=$InstallRoot"
  Import-Module (Join-Path $PSScriptRoot 'Installer.psm1') -Force
  foreach ($command in @('Get-CimInstance', 'Get-Acl', 'Set-Acl', 'Start-Service', 'Stop-Service')) {
    $null = Get-Command $command -ErrorAction Stop
  }
  Assert-Platform
  Assert-InstallDirectories $InstallRoot $DataRoot
  Assert-ProgramFilesLocation $InstallRoot ([Environment]::GetFolderPath('ProgramFiles'))
  Assert-NoReparseAncestor $InstallRoot
  Assert-NoReparseAncestor $DataRoot
  $created = $false
  $Mutex = [Threading.Mutex]::new($false, 'Global\HitmakerInstaller', [ref]$created)
  $Locked = $Mutex.WaitOne(0)
  if (-not $Locked) { throw 'Another Hitmaker installer is running.' }
  Assert-TrustedDataTree $DataRoot -RootOnly
  $installed = @(Get-InstalledHitmakerServices $InstallRoot)
  $PreviousRunning = @($installed | Where-Object { $_.State -eq 'Running' } | ForEach-Object { $_.Name })
  if (Test-Path -LiteralPath $StatePath) {
    $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    if ($state.product -ne 'Hitmaker' -or $state.installRoot -ne $InstallRoot) {
      throw 'Hitmaker data belongs to a different installation directory. Use the original installation path.'
    }
  } elseif ($installed.Count -gt 0 -or (Test-Path -LiteralPath $Current)) {
    throw 'Existing files/services have no valid Hitmaker install record; refusing to overwrite them.'
  } elseif ((Test-Path -LiteralPath $InstallRoot) -and @(Get-ChildItem -LiteralPath $InstallRoot -Force).Count -gt 0) {
    throw 'Choose an empty application directory; unrelated files will not be overwritten.'
  }
  if ($Action -eq 'Uninstall') {
    if (-not (Test-Path -LiteralPath $StatePath)) { throw 'Hitmaker installation record was not found.' }
    Stop-HitmakerServices $InstallRoot
    Assert-TrustedDataTree $DataRoot
    Remove-HitmakerServices $InstallRoot
    Remove-HitmakerVersion $Current
    Remove-HitmakerVersion $Previous
    if (Test-Path -LiteralPath $Services) { Remove-Item -LiteralPath $Services -Recurse -Force }
    Write-Output "Hitmaker removed. Your data is preserved in $DataRoot"
  } else {
    Assert-Payload
    Stop-HitmakerServices $InstallRoot
    Assert-TrustedDataTree $DataRoot
    Assert-FreePorts
    Protect-ApplicationDirectory
    Initialize-Data
    $CanSaveLog = $true
    Write-Output 'Preparing private offline runtimes...'
    $runtimeInstaller = Join-Path $PayloadRoot 'runtime\vcredist\vc_redist.x64.exe'
    $vc = Start-Process -FilePath $runtimeInstaller -ArgumentList @('/install', '/quiet', '/norestart') -Wait -PassThru
    if ($vc.ExitCode -notin @(0, 1638, 3010)) { throw "Microsoft VC++ runtime installation failed (exit $($vc.ExitCode))." }
    if ($vc.ExitCode -eq 3010) { $ExitCode = 3010 }
    $null = New-Item -ItemType Directory -Force -Path $Stage
    Get-ChildItem -LiteralPath $PayloadRoot -Force | Copy-Item -Destination $Stage -Recurse -Force
    & (Join-Path $Stage 'runtime\node\node.exe') --version
    if ($LASTEXITCODE -ne 0) { throw 'Bundled Node.js cannot run on this system.' }
    & (Join-Path $Stage 'runtime\mongodb\bin\mongod.exe') --version
    if ($LASTEXITCODE -ne 0) { throw 'Bundled MongoDB cannot run. Check CPU/AVX support and restart Windows if requested.' }
    Remove-HitmakerVersion $Previous
    if (Test-Path -LiteralPath $Current) { Move-Item -LiteralPath $Current -Destination $Previous; $HadPrevious = $true }
    Move-Item -LiteralPath $Stage -Destination $Current
    $Swapped = $true
    foreach ($folder in @('storage', 'mock-sites')) {
      $null = New-Item -ItemType Junction -Path (Join-Path $Current "app\$folder") -Target (Join-Path $DataRoot $folder)
    }
    Remove-HitmakerServices $InstallRoot
    Install-Services
    Write-Output 'Starting Hitmaker services...'
    Start-HitmakerServices $InstallRoot
    Push-Location $DataRoot
    try {
      & (Join-Path $Current 'runtime\node\node.exe') (Join-Path $Current 'installer\check-runtime.js') --browser
      if ($LASTEXITCODE -ne 0) { throw 'Hitmaker readiness check failed. See setup and service logs.' }
    } finally { Pop-Location }
    $version = Get-Content -LiteralPath (Join-Path $Current 'version.json') -Raw | ConvertFrom-Json
    @{ product = 'Hitmaker'; installRoot = $InstallRoot; version = $version.version } | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
    $stateAcl = Get-Acl -LiteralPath $StatePath
    $stateAcl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    Set-Acl -LiteralPath $StatePath -AclObject $stateAcl
    Remove-HitmakerVersion $Previous
    Write-Output 'Hitmaker is ready: http://127.0.0.1:3100'
  }
} catch {
  $ExitCode = 1
  Write-Output "SETUP FAILED: $($_.Exception.Message)"
  Write-Output $_.InvocationInfo.PositionMessage
  Write-Output $_.ScriptStackTrace
  if ($Action -eq 'Install') {
    try {
      if ($Swapped) {
        Remove-HitmakerServices $InstallRoot
        Remove-HitmakerVersion $Current
        if ($HadPrevious) {
          Move-Item -LiteralPath $Previous -Destination $Current
          Install-Services
        }
      } elseif ($HadPrevious -and -not (Test-Path -LiteralPath $Current) -and (Test-Path -LiteralPath $Previous)) {
        # A failed second rename must also restore the original service paths.
        Move-Item -LiteralPath $Previous -Destination $Current
      }
      foreach ($id in $PreviousRunning) { Start-Service -Name $id -ErrorAction Stop }
      Remove-HitmakerVersion $Stage
    } catch { Write-Output "Rollback needs attention: $($_.Exception.Message). Data was preserved in $DataRoot" }
  }
} finally {
  if ($Transcript) { Stop-Transcript | Out-Null }
  if ($CanSaveLog) { Copy-Item -LiteralPath $BootLog -Destination (Join-Path $LogRoot 'setup.log') -Force }
  if ($Locked) { $Mutex.ReleaseMutex() }
  if ($null -ne $Mutex) { $Mutex.Dispose() }
}
exit $ExitCode
