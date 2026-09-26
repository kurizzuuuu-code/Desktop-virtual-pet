$ErrorActionPreference = 'SilentlyContinue'

$skipTitles = @(
  'Virtual Pet',
  'Program Manager',
  'Windows Input Experience',
  'Task Manager',
  'Settings'
)

$candidates = New-Object System.Collections.ArrayList

Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowHandle -ne 0 } | ForEach-Object {
  $proc = $_
  $skip = $false

  foreach ($s in $skipTitles) {
    if ($proc.MainWindowTitle -like "*$s*") {
      $skip = $true
      break
    }
  }

  if ($proc.ProcessName -like '*electron*') { $skip = $true }
  if ($proc.ProcessName -like '*Virtual*Pet*') { $skip = $true }

  if (-not $skip) {
    [void]$candidates.Add($proc)
  }
}

if ($candidates.Count -eq 0) {
  Write-Output ''
  exit 0
}

$target = $candidates | Get-Random
$title = $target.MainWindowTitle
$procId = $target.Id

[void]$target.CloseMainWindow()
Start-Sleep -Milliseconds 450

$stillOpen = Get-Process -Id $procId -ErrorAction SilentlyContinue
if ($stillOpen -and $stillOpen.MainWindowHandle -ne 0) {
  Stop-Process -Id $procId -Force
}

Write-Output $title
exit 0
