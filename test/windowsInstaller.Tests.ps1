Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '../packaging/windows/Installer.psm1') -Force
function Assert-Equal($Actual, $Expected, [string]$Name) {
  if ($Actual -cne $Expected) { throw "$Name failed. Expected [$Expected], got [$Actual]" }
  Write-Output "PASS $Name"
}
function Assert-Throws([scriptblock]$Action, [string]$Name) {
  $thrown = $false
  try { & $Action } catch { $thrown = $true }
  if (-not $thrown) { throw "$Name did not reject invalid input" }
  Write-Output "PASS $Name"
}

$hashFixture = Join-Path ([IO.Path]::GetTempPath()) ('hitmaker-hash-' + [Guid]::NewGuid().ToString('N'))
try {
  [IO.File]::WriteAllText($hashFixture, 'abc', [Text.UTF8Encoding]::new($false))
  Assert-Equal (Get-FileSha256 $hashFixture) 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' 'SHA-256 without Get-FileHash module'
} finally { [IO.File]::Delete($hashFixture) }

Assert-Equal (ConvertTo-CygwinPath 'C:\ProgramData\Hitmaker Veri\İstanbul') '/cygdrive/c/ProgramData/Hitmaker Veri/İstanbul' 'Cygwin spaces and Unicode'
Assert-Throws { ConvertTo-CygwinPath '\\server\share' } 'UNC Redis data rejected'
Assert-Equal (Quote-WindowsArgument 'C:\Program Files\Hitmaker\node.exe') '"C:\Program Files\Hitmaker\node.exe"' 'Windows argument spaces'
Assert-Equal (Quote-WindowsArgument 'C:\folder\') '"C:\folder\\"' 'Windows trailing slash'
Assert-Equal (Test-OwnedServicePath '"C:\Program Files\Hitmaker\services\HitmakerAppWeb.exe"' 'C:\Program Files\Hitmaker' 'HitmakerAppWeb') $true 'Owned service accepted'
Assert-Equal (Test-OwnedServicePath '"C:\Other\HitmakerAppWeb.exe"' 'C:\Program Files\Hitmaker' 'HitmakerAppWeb') $false 'Foreign service rejected'
Assert-Equal (Test-OwnedServicePath '"C:\Program Files\Hitmaker-copy\services\HitmakerAppWeb.exe"' 'C:\Program Files\Hitmaker' 'HitmakerAppWeb') $false 'Prefix collision rejected'
Assert-Throws { Assert-InstallDirectories 'C:\' 'C:\ProgramData\Hitmaker' } 'Drive root rejected'
Assert-Throws { Assert-InstallDirectories 'C:\Apps\Hitmaker' 'C:\Apps\Hitmaker\data' } 'Nested data directory rejected'
Assert-Throws { Assert-ProgramFilesLocation 'C:\Users\someone\Hitmaker' 'C:\Program Files' } 'User-writable application location rejected'
Assert-Throws { Assert-ProgramFilesLocation 'C:\Program Files (x86)\Hitmaker' 'C:\Program Files' } 'Program Files prefix collision rejected'
Assert-ProgramFilesLocation 'C:\Program Files\Hitmaker İstanbul' 'C:\Program Files'

$definitions = @(Get-HitmakerServiceDefinitions 'C:\Program Files\Hitmaker & Co' 'C:\ProgramData\Hitmaker Veri')
Assert-Equal $definitions.Count 5 'All five services included'
$web = $definitions | Where-Object { $_.Id -eq 'HitmakerAppWeb' }
$xml = [xml](ConvertTo-ServiceXml $web 'C:\ProgramData\Hitmaker Veri\logs')
Assert-Equal $xml.service.executable 'C:\Program Files\Hitmaker & Co\current\runtime\node\node.exe' 'XML path escaping'
Assert-Equal $xml.service.workingdirectory 'C:\ProgramData\Hitmaker Veri' 'Persistent working directory'
Assert-Equal @($xml.service.depend).Count 2 'App depends on both data services'
$redis = $definitions | Where-Object { $_.Id -eq 'HitmakerAppRedis' }
$redisXml = [xml](ConvertTo-ServiceXml $redis 'C:\logs')
Assert-Equal ($redisXml.service.startarguments.Contains('/cygdrive/c/ProgramData/Hitmaker Veri/redis')) $true 'Redis Cygwin path quoted'
Assert-Equal ($redisXml.service.startarguments.Contains('--appendonly yes')) $true 'Redis AOF persistence'
Assert-Equal $redisXml.service.stoparguments '-h 127.0.0.1 -p 6388 shutdown' 'Redis graceful shutdown'
Assert-Equal @((Get-HitmakerServiceDefinitions 'C:\app' 'C:\data') | Where-Object { $_.Id -eq 'HitmakerAppMrWorker' }).Count 1 'MR worker is installed'
