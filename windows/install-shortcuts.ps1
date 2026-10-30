# Ecelon Station on Windows: creates Desktop, Start menu and startup shortcuts (run install-shortcuts.bat).
# The shortcuts point to "Ecelon Station.vbs" in the project root, which starts the server in the
# background and opens the station as an app window (Chrome/Edge --app) without an address bar.
param([switch]$Uninstall)
$dir  = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$vbs  = Join-Path $dir 'Ecelon Station.vbs'
$icon = Join-Path $dir 'public\icon.ico'
$ws   = New-Object -ComObject WScript.Shell
$targets = @(
  @{ Folder = [Environment]::GetFolderPath('Desktop');  Args = '';              Label = 'Desktop' },
  @{ Folder = [Environment]::GetFolderPath('Programs'); Args = '';              Label = 'Start menu' },
  @{ Folder = [Environment]::GetFolderPath('Startup');  Args = ' --background'; Label = 'Windows startup (server in the background)' }
)
foreach ($t in $targets) {
  $lnk = Join-Path $t.Folder 'Ecelon Station.lnk'
  if ($Uninstall) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host "Removed: $($t.Label)" }
    continue
  }
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $s.Arguments = "`"$vbs`"$($t.Args)"
  $s.WorkingDirectory = $dir
  $s.IconLocation = "$icon,0"
  $s.Description = 'Ecelon Station: a control room for your Claude Code agent teams'
  $s.Save()
  Write-Host "Created: $($t.Label)"
}
if (-not $Uninstall) {
  Write-Host ''
  Write-Host 'Done. Open the station with the "Ecelon Station" icon on your Desktop.'
  Write-Host 'The server starts in the background when Windows starts.'
}
