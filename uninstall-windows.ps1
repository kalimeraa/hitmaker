Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$services = @("HitmakerWorker", "HitmakerWeb")

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

  throw "NSSM bulunamadi. Servisleri kaldirmak icin NSSM gerekli."
}

if (-not (Test-IsAdministrator)) {
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"") -Verb RunAs
  exit 0
}

$nssm = Find-Nssm
foreach ($serviceName in $services) {
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($null -eq $service) {
    continue
  }
  if ($service.Status -ne "Stopped") {
    Stop-Service -Name $serviceName -Force
    Start-Sleep -Seconds 2
  }
  & $nssm remove $serviceName confirm
  if ($LASTEXITCODE -ne 0) {
    throw "$serviceName service kaldirilamadi. Exit code: $LASTEXITCODE"
  }
}

Write-Host "Hitmaker Windows servisleri kaldirildi. MongoDB/Redis/Memurai ve proje dosyalari silinmedi."
