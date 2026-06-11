param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("status", "start", "stop", "restart")]
  [string]$Action
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$services = @("HitmakerWeb", "HitmakerWorker")

function Get-HitmakerServices {
  Get-Service -Name $services -ErrorAction SilentlyContinue
}

switch ($Action) {
  "status" {
    Get-HitmakerServices | Format-Table -AutoSize
  }
  "start" {
    foreach ($serviceName in $services) {
      $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
      if ($null -eq $service) {
        throw "$serviceName service bulunamadi. Once setup-windows.ps1 calistir."
      }
      if ($service.Status -ne "Running") {
        Start-Service -Name $serviceName
      }
    }
    Get-HitmakerServices | Format-Table -AutoSize
  }
  "stop" {
    foreach ($serviceName in $services) {
      $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
      if ($null -ne $service -and $service.Status -ne "Stopped") {
        Stop-Service -Name $serviceName -Force
      }
    }
    Get-HitmakerServices | Format-Table -AutoSize
  }
  "restart" {
    foreach ($serviceName in $services) {
      $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
      if ($null -eq $service) {
        throw "$serviceName service bulunamadi. Once setup-windows.ps1 calistir."
      }
      if ($service.Status -ne "Stopped") {
        Stop-Service -Name $serviceName -Force
      }
      Start-Service -Name $serviceName
    }
    Get-HitmakerServices | Format-Table -AutoSize
  }
}
