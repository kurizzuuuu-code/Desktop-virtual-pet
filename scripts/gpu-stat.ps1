# GPU stats via Windows built-in GPU counters (vendor-neutral: AMD / NVIDIA / Intel).
# Outputs one JSON line: {"ok":true,"util":12.3,"usedMB":1234.5,"totalMB":8192,"name":"..."}
$ErrorActionPreference = 'SilentlyContinue'
try {
  # Utilization needs 2 samples; sum 3D engines, cap at 100.
  $util = 0
  $eng = Get-Counter -Counter '\GPU Engine(*)\Utilization Percentage' -MaxSamples 2 -SampleInterval 1
  if ($eng) {
    $last = $eng.CounterSamples | Where-Object { $_.Path -like '*engtype_3D*' } | Group-Object Path | ForEach-Object { $_.Group | Select-Object -Last 1 }
    $util = ($last | Measure-Object -Property CookedValue -Sum).Sum
    if (-not $util) { $util = 0 }
    if ($util -gt 100) { $util = 100 }
  }
  # Memory counters are instantaneous: 1 sample is enough.
  $memOk = $false
  $used = 0; $total = 0
  $mu = Get-Counter -Counter '\GPU Adapter Memory(*)\Dedicated Usage' -MaxSamples 1
  if ($mu) {
    $memOk = $true
    $used = (($mu.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum) / 1MB
  }
  $ml = Get-Counter -Counter '\GPU Adapter Memory(*)\Dedicated Limit' -MaxSamples 1
  if ($ml) {
    $total = (($ml.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum) / 1MB
  }
  $name = ''
  try {
    $vc = Get-CimInstance Win32_VideoController | Sort-Object { [double]$_.AdapterRAM } -Descending | Select-Object -First 1
    if ($vc) {
      $name = $vc.Name
      if ($total -le 0 -and $vc.AdapterRAM -gt 0) { $total = [double]$vc.AdapterRAM / 1MB }
    }
  } catch {}
  # NOTE: Dedicated Limit doesn't exist on all drivers, and AdapterRAM wraps
  # above 4GB — so total is best-effort and may be 0 (unknown).
  $out = @{ ok = $memOk; util = [math]::Round([double]$util, 1); usedMB = [math]::Round([double]$used, 1); totalMB = [math]::Round([double]$total, 1); name = "$name" }
  $out | ConvertTo-Json -Compress
} catch {
  '{"ok":false}'
}
