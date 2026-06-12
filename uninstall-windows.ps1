Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$services = @("HitmakerWorker", "HitmakerWeb")
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScExe = Join-Path $env:SystemRoot "System32\sc.exe"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
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

  return ""
}

function Remove-HitmakerService {
  param(
    [Parameter(Mandatory = $true)][string]$ServiceName,
    [string]$NssmPath = ""
  )

  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($null -eq $service) {
    return
  }

  if ($service.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force
    Start-Sleep -Seconds 2
  }

  if (-not [string]::IsNullOrWhiteSpace($NssmPath)) {
    & $NssmPath remove $ServiceName confirm
    if ($LASTEXITCODE -eq 0) {
      return
    }
    Write-Host "$ServiceName NSSM ile kaldirilamadi, sc.exe deneniyor. Exit code: $LASTEXITCODE"
  }

  & $ScExe delete $ServiceName | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "$ServiceName service kaldirilamadi. Exit code: $LASTEXITCODE"
  }
}

function Remove-PanelShortcut {
  $shortcutPaths = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Hitmaker Panel.lnk"),
    (Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "Hitmaker Panel.lnk")
  )

  foreach ($shortcutPath in $shortcutPaths) {
    if (Test-Path $shortcutPath) {
      Remove-Item -Path $shortcutPath -Force
    }
  }
}

if (-not (Test-IsAdministrator)) {
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"") -Verb RunAs
  exit 0
}

$nssm = Find-Nssm
foreach ($serviceName in $services) {
  Remove-HitmakerService -ServiceName $serviceName -NssmPath $nssm
}

Remove-PanelShortcut

Write-Host "Hitmaker Windows servisleri kaldirildi. MongoDB/Redis/Memurai ve proje dosyalari silinmedi."
Write-Host "Log ve browser cache dosyalari korunuyor: $(Join-Path $RootDir 'storage')"
