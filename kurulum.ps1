# Ecelon Station kurulumu: Masaüstü, Başlat menüsü ve Windows açılışı için kısayol oluşturur.
param([switch]$Kaldir)
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs  = Join-Path $dir 'Ecelon Station.vbs'
$icon = Join-Path $dir 'public\icon.ico'
$ws   = New-Object -ComObject WScript.Shell
$targets = @(
  @{ Folder = [Environment]::GetFolderPath('Desktop');  Args = '';             Label = 'Masaüstü' },
  @{ Folder = [Environment]::GetFolderPath('Programs'); Args = '';             Label = 'Başlat menüsü' },
  @{ Folder = [Environment]::GetFolderPath('Startup');  Args = ' --background'; Label = 'Windows açılışı (arka planda sunucu)' }
)
foreach ($t in $targets) {
  $lnk = Join-Path $t.Folder 'Ecelon Station.lnk'
  if ($Kaldir) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host "Kaldırıldı: $($t.Label)" }
    continue
  }
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $s.Arguments = "`"$vbs`"$($t.Args)"
  $s.WorkingDirectory = $dir
  $s.IconLocation = "$icon,0"
  $s.Description = 'Ecelon Station: projelerinin ajan istasyonu'
  $s.Save()
  Write-Host "Oluşturuldu: $($t.Label)"
}
if (-not $Kaldir) {
  Write-Host ''
  Write-Host 'Tamam. Masaüstündeki "Ecelon Station" simgesiyle açabilirsin.'
  Write-Host 'Bilgisayar açılınca sunucu arka planda kendiliğinden başlar.'
}
