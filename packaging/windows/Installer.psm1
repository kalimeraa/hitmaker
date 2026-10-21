Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-FileSha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}

function ConvertTo-CygwinPath([string]$Path) {
  if ($Path -notmatch '^([A-Za-z]):[\\/]') { throw 'Redis data must be on a local Windows drive.' }
  return '/cygdrive/' + $Matches[1].ToLowerInvariant() + '/' + $Path.Substring(3).Replace('\', '/')
}

function Quote-WindowsArgument([string]$Value) {
  # CommandLineToArgvW: double backslashes before quotes and before the closing quote.
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

function Test-OwnedServicePath([string]$BinaryPath, [string]$InstallRoot, [string]$ServiceId) {
  $executable = ''
  if ($BinaryPath -match '^"([^"]+)"(?:\s|$)') { $executable = $Matches[1] }
  elseif ($BinaryPath -match '^([^\s]+)(?:\s|$)') { $executable = $Matches[1] }
  $expected = $InstallRoot.TrimEnd('\', '/') + '\services\' + $ServiceId + '.exe'
  return [string]::Equals($executable, $expected, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-InstallDirectories([string]$InstallRoot, [string]$DataRoot) {
  foreach ($directory in @($InstallRoot, $DataRoot)) {
    if ($directory -notmatch '^[A-Za-z]:[\\/][^\\/]' -or $directory.Contains('"') -or $directory.Contains("`n") -or $directory -match '(^|[\\/])\.\.([\\/]|$)') {
      throw "Unsafe install/data directory: $directory"
    }
  }
  $install = $InstallRoot.Replace('/', '\').TrimEnd('\') + '\'
  $data = $DataRoot.Replace('/', '\').TrimEnd('\') + '\'
  if ($install.StartsWith($data, [StringComparison]::OrdinalIgnoreCase) -or $data.StartsWith($install, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Application and persistent data directories must be separate.'
  }
}

function Assert-ProgramFilesLocation([string]$InstallRoot, [string]$ProgramFilesRoot) {
  $directory = $InstallRoot.Replace('/', '\').TrimEnd('\')
  $parent = $directory.Substring(0, $directory.LastIndexOf('\'))
  if (-not [string]::Equals($parent, $ProgramFilesRoot.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Choose a direct subdirectory of the protected 64-bit Program Files folder.'
  }
}

function Assert-TrustedDataTree([string]$DataRoot, [switch]$RootOnly) {
  if (-not (Test-Path -LiteralPath $DataRoot)) { return }
  $pending = [Collections.Generic.Queue[string]]::new()
  $pending.Enqueue($DataRoot)
  $trusted = @('S-1-5-18', 'S-1-5-32-544')
  $writes = [Security.AccessControl.FileSystemRights]'WriteData,AppendData,WriteExtendedAttributes,DeleteSubdirectoriesAndFiles,WriteAttributes,Delete,ChangePermissions,TakeOwnership'
  while ($pending.Count) {
    $directory = $pending.Dequeue()
    $items = @((Get-Item -LiteralPath $directory -Force))
    if (-not $RootOnly) { $items += @(Get-ChildItem -LiteralPath $directory -Force) }
    foreach ($item in $items) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Persistent data contains an unexpected reparse point: $($item.FullName)" }
      $acl = Get-Acl -LiteralPath $item.FullName
      $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
      if ($owner -notin $trusted) { throw "Persistent data has an untrusted owner: $($item.FullName)" }
      foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted -and ($rule.FileSystemRights -band $writes)) {
          throw "Persistent data permits untrusted writes: $($item.FullName)"
        }
      }
      if (-not $RootOnly -and $item.PSIsContainer -and $item.FullName -ne $directory) { $pending.Enqueue($item.FullName) }
    }
  }
}

function Get-HitmakerServiceDefinitions([string]$InstallRoot, [string]$DataRoot) {
  $current = $InstallRoot.TrimEnd('\') + '\current'
  $node = "$current\runtime\node\node.exe"
  $launcher = "$current\installer\runtime-launcher.js"
  $mongoData = $DataRoot.TrimEnd('\') + '\mongo'
  $redisData = ConvertTo-CygwinPath ($DataRoot.TrimEnd('\') + '\redis')
  @{
    Id = 'HitmakerAppMongo'; Name = 'Hitmaker Database'; Executable = "$current\runtime\mongodb\bin\mongod.exe"
    Arguments = '--dbpath ' + (Quote-WindowsArgument $mongoData) + ' --bind_ip 127.0.0.1 --port 27031 --logpath ' + (Quote-WindowsArgument "$DataRoot\logs\mongo.log") + ' --logappend'
    Directory = $DataRoot; Depends = @()
  }
  @{
    Id = 'HitmakerAppRedis'; Name = 'Hitmaker Queue'; Executable = "$current\runtime\redis\redis-server.exe"
    Arguments = '--bind 127.0.0.1 --port 6388 --dir ' + (Quote-WindowsArgument $redisData) + ' --appendonly yes --appendfsync everysec --save "" --maxmemory-policy noeviction --daemonize no --protected-mode yes'
    StopExecutable = "$current\runtime\redis\redis-cli.exe"; StopArguments = '-h 127.0.0.1 -p 6388 shutdown'
    Directory = $DataRoot; Depends = @()
  }
  foreach ($entry in @(
    @('HitmakerAppWeb', 'Hitmaker Web', 'server.js'),
    @('HitmakerAppWorker', 'Hitmaker Task Worker', 'worker.js'),
    @('HitmakerAppMrWorker', 'Hitmaker MR Worker', 'mrLoginWorker.js')
  )) {
    @{
      Id = $entry[0]; Name = $entry[1]; Executable = $node
      Arguments = (Quote-WindowsArgument $launcher) + ' ' + $entry[2]
      Directory = $DataRoot; Depends = @('HitmakerAppMongo', 'HitmakerAppRedis')
    }
  }
}

function ConvertTo-ServiceXml([hashtable]$Definition, [string]$LogRoot) {
  $builder = [Text.StringBuilder]::new()
  $settings = [Xml.XmlWriterSettings]::new()
  $settings.Indent = $true
  $settings.OmitXmlDeclaration = $true
  $writer = [Xml.XmlWriter]::Create($builder, $settings)
  try {
    $writer.WriteStartElement('service')
    foreach ($pair in @(
      @('id', $Definition.Id), @('name', $Definition.Name), @('description', 'Private Hitmaker application service'),
      @('executable', $Definition.Executable), @('workingdirectory', $Definition.Directory),
      @('startmode', 'Automatic'), @('stoptimeout', '60sec'), @('logpath', $LogRoot)
    )) { $writer.WriteElementString($pair[0], $pair[1]) }
    if ($Definition.ContainsKey('StopExecutable')) {
      $writer.WriteElementString('startarguments', $Definition.Arguments)
      $writer.WriteElementString('stopexecutable', $Definition.StopExecutable)
      $writer.WriteElementString('stoparguments', $Definition.StopArguments)
    } else { $writer.WriteElementString('arguments', $Definition.Arguments) }
    foreach ($dependency in $Definition.Depends) { $writer.WriteElementString('depend', $dependency) }
    $writer.WriteStartElement('onfailure'); $writer.WriteAttributeString('action', 'restart'); $writer.WriteAttributeString('delay', '10sec'); $writer.WriteEndElement()
    $writer.WriteStartElement('log'); $writer.WriteAttributeString('mode', 'roll-by-size')
    $writer.WriteElementString('sizeThreshold', '10240'); $writer.WriteElementString('keepFiles', '5'); $writer.WriteEndElement()
    $writer.WriteEndElement(); $writer.Flush()
    return $builder.ToString()
  } finally { $writer.Dispose() }
}

function Get-InstalledHitmakerServices([string]$InstallRoot) {
  foreach ($definition in @(Get-HitmakerServiceDefinitions $InstallRoot 'C:\ProgramData\Hitmaker')) {
    $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='$($definition.Id)'"
    if ($null -ne $service) {
      if (-not (Test-OwnedServicePath $service.PathName $InstallRoot $definition.Id)) {
        throw "Service $($definition.Id) belongs to another installation; no changes were made to it."
      }
      $service
    }
  }
}

function Stop-HitmakerServices([string]$InstallRoot) {
  $null = @(Get-InstalledHitmakerServices $InstallRoot)
  foreach ($id in @('HitmakerAppMrWorker', 'HitmakerAppWorker', 'HitmakerAppWeb', 'HitmakerAppRedis', 'HitmakerAppMongo')) {
    $service = Get-Service -Name $id -ErrorAction SilentlyContinue
    if ($null -ne $service -and $service.Status -ne 'Stopped') {
      Stop-Service -Name $id -ErrorAction Stop
      $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(90))
    }
  }
}

function Invoke-ServiceWrapper([string]$InstallRoot, [string]$Id, [string]$Action) {
  $executable = Join-Path $InstallRoot "services\$Id.exe"
  & $executable $Action | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Service $Id $Action failed (exit $LASTEXITCODE)." }
}

function Start-HitmakerServices([string]$InstallRoot) {
  $null = @(Get-InstalledHitmakerServices $InstallRoot)
  foreach ($id in @('HitmakerAppMongo', 'HitmakerAppRedis', 'HitmakerAppWeb', 'HitmakerAppWorker', 'HitmakerAppMrWorker')) {
    Start-Service -Name $id -ErrorAction Stop
  }
}

function Remove-HitmakerServices([string]$InstallRoot) {
  Stop-HitmakerServices $InstallRoot
  foreach ($id in @('HitmakerAppMrWorker', 'HitmakerAppWorker', 'HitmakerAppWeb', 'HitmakerAppRedis', 'HitmakerAppMongo')) {
    if ($null -ne (Get-Service -Name $id -ErrorAction SilentlyContinue)) {
      Invoke-ServiceWrapper $InstallRoot $id 'uninstall'
    }
  }
}

function Remove-HitmakerVersion([string]$Directory) {
  if (-not (Test-Path -LiteralPath $Directory)) { return }
  # Windows PowerShell 5.1 must never recurse through persistent-data junctions.
  foreach ($relative in @('app\storage', 'app\mock-sites')) {
    $link = Join-Path $Directory $relative
    if (Test-Path -LiteralPath $link) {
      $item = Get-Item -LiteralPath $link -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { [IO.Directory]::Delete($link) }
    }
  }
  Remove-Item -LiteralPath $Directory -Recurse -Force
}

Export-ModuleMember -Function *-*
