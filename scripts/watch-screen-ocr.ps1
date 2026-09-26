#Requires -Version 5.1
<#
  Captures the primary screen (downscaled) and runs Windows built-in OCR on it.
  The OCR engine is a tiny C# helper compiled once with csc.exe and cached in
  %TEMP% (no SDK, no downloads, no admin needed).
  Outputs exactly one JSON line:
    {"ok":true,"text":"..."}  or  {"ok":false,"error":"..."}
  Never throws — all failures are reported as JSON so the caller can fail safe.
#>
param([int]$MaxWidth = 1440, [string]$Region = 'full', [int]$UpdateHash = 1)

$ErrorActionPreference = 'Stop'

function Out-Result($obj) {
  Write-Output ($obj | ConvertTo-Json -Compress)
}

$PetOcrSource = @'
using System;
using Windows.Foundation;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Globalization;
using Windows.Storage;

public static class PetOcr
{
    private static T AwaitOp<T>(IAsyncOperation<T> op, int timeoutMs)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (op.Status == AsyncStatus.Started)
        {
            if (sw.ElapsedMilliseconds > timeoutMs) throw new TimeoutException("winrt-timeout");
            System.Threading.Thread.Sleep(50);
        }
        if (op.Status == AsyncStatus.Completed) return op.GetResults();
        throw new Exception("winrt-error");
    }

    public static string Recognize(string pngPath)
    {
        try
        {
            OcrEngine engine = OcrEngine.TryCreateFromUserProfileLanguages();
            if (engine == null)
            {
                try { engine = OcrEngine.TryCreateFromLanguage(new Language("en")); }
                catch { engine = null; }
            }
            if (engine == null) return null;
            var file = AwaitOp(StorageFile.GetFileFromPathAsync(pngPath), 10000);
            using (var stream = AwaitOp(file.OpenReadAsync(), 10000))
            {
                var decoder = AwaitOp(BitmapDecoder.CreateAsync(stream), 10000);
                var sb = AwaitOp(decoder.GetSoftwareBitmapAsync(), 10000);
                var res = AwaitOp(engine.RecognizeAsync(sb), 60000);
                return res.Text;
            }
        }
        catch
        {
            return string.Empty;
        }
    }
}
'@

function Get-PetOcrType {
  $dll = Join-Path ([System.IO.Path]::GetTempPath()) 'pet-ocr-helper.dll'
  if (-not (Test-Path $dll)) {
    $csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path $csc)) { throw 'no-csc' }
    $md = Join-Path $env:windir 'System32\WinMetadata'
    $refs = @('Media', 'Globalization', 'Graphics', 'Storage', 'Foundation') |
      ForEach-Object { Join-Path $md ("Windows.$_.winmd") }
    foreach ($r in $refs) { if (-not (Test-Path $r)) { throw 'no-winmd' } }
    $cs = Join-Path ([System.IO.Path]::GetTempPath()) 'pet-ocr-helper.cs'
    Set-Content -Path $cs -Value $PetOcrSource -Encoding UTF8
    $args = @('/t:library', '/nologo', "/out:$dll", $cs, '/r:System.Runtime.dll') +
      ($refs | ForEach-Object { "/r:$_" })
    & $csc @args 2>&1 | Out-Null
    Remove-Item $cs -ErrorAction SilentlyContinue
    if (-not (Test-Path $dll)) { throw 'compile-failed' }
  }
  Add-Type -Path $dll
}

try {
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Windows.Forms

  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  if ($screen.Width -le 0 -or $screen.Height -le 0) {
    Out-Result @{ ok = $false; error = 'no-screen' }
    exit 0
  }

  $bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
  } finally {
    $g.Dispose()
  }

  # Optional region crop (center / top). Smaller area = faster OCR and fewer
  # stray-text false matches from screen edges. Native Clone, near-free.
  $srcW = $screen.Width
  $srcH = $screen.Height
  if ($Region -eq 'center' -or $Region -eq 'top') {
    if ($Region -eq 'center') {
      $rx = [int]($screen.Width * 0.2); $ry = [int]($screen.Height * 0.25)
      $rw = [int]($screen.Width * 0.6); $rh = [int]($screen.Height * 0.5)
    } else {
      $rx = [int]($screen.Width * 0.25); $ry = [int]($screen.Height * 0.05)
      $rw = [int]($screen.Width * 0.5); $rh = [int]($screen.Height * 0.3)
    }
    $rect = New-Object System.Drawing.Rectangle($rx, $ry, $rw, $rh)
    $rect.Intersect((New-Object System.Drawing.Rectangle(0, 0, $screen.Width, $screen.Height)))
    if ($rect.Width -gt 0 -and $rect.Height -gt 0) {
      $crop = $bmp.Clone($rect, $bmp.PixelFormat)
      $bmp.Dispose()
      $bmp = $crop
      $srcW = $rect.Width
      $srcH = $rect.Height
    }
  }

  # Single high-quality pass: downscale (bicubic) + flatten to grayscale +
  # stretch contrast. Game fonts (outlines, glows, italics, textures) OCR far
  # better as harsh black-on-white than as raw color. Native GDI+ ops only,
  # so this costs ~100-200ms, not seconds like a pixel loop would.
  $scale = [Math]::Min(1.0, $MaxWidth / [double]$srcW)
  $w = [int]($srcW * $scale)
  $h = [int]($srcH * $scale)
  if ($w -lt 1) { $w = 1 }
  if ($h -lt 1) { $h = 1 }
  $contrast = 1.45
  $lift = [float](-0.5 * $contrast + 0.5 - 0.04)
  $r = [float](0.299 * $contrast)
  $g = [float](0.587 * $contrast)
  $b = [float](0.114 * $contrast)
  $zero = [float]0
  $one = [float]1
  # NOTE: pass NO array to the constructor — PowerShell splats nested arrays
  # into separate arguments (there is no 5-arg overload). Default is identity;
  # only the gray+contrast rows and the lift need setting.
  $matrix = New-Object System.Drawing.Imaging.ColorMatrix
  $matrix.Matrix00 = $r; $matrix.Matrix01 = $g; $matrix.Matrix02 = $b
  $matrix.Matrix10 = $r; $matrix.Matrix11 = $g; $matrix.Matrix12 = $b
  $matrix.Matrix20 = $r; $matrix.Matrix21 = $g; $matrix.Matrix22 = $b
  $matrix.Matrix40 = $lift; $matrix.Matrix41 = $lift; $matrix.Matrix42 = $lift
  $attrs = New-Object System.Drawing.Imaging.ImageAttributes
  $attrs.SetColorMatrix($matrix)
  $proc = New-Object System.Drawing.Bitmap($w, $h)
  $g2 = [System.Drawing.Graphics]::FromImage($proc)
  try {
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $dst = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $g2.DrawImage($bmp, $dst, 0, 0, $srcW, $srcH, [System.Drawing.GraphicsUnit]::Pixel, $attrs)
  } finally {
    $g2.Dispose()
    $attrs.Dispose()
    $bmp.Dispose()
  }
  $bmp = $proc

  $tmp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'pet-ocr-scan.png')
  $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()

  # Frame diffing: if the pixels are identical to the last scan, skip the
  # 1-3s OCR inference entirely. Hash is only LEARNED after a successful OCR
  # so a broken engine can never mask itself as "unchanged".
  $hashFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "pet-ocr-lasthash-$Region-$MaxWidth.txt")
  $hash = (Get-FileHash -Path $tmp -Algorithm MD5).Hash
  if ($UpdateHash -eq 1 -and (Test-Path $hashFile) -and ((Get-Content $hashFile -Raw).Trim() -eq $hash)) {
    Remove-Item $tmp -ErrorAction SilentlyContinue
    Out-Result @{ ok = $true; text = ''; unchanged = $true }
    exit 0
  }

  try {
    Get-PetOcrType
  } catch {
    Remove-Item $tmp -ErrorAction SilentlyContinue
    Out-Result @{ ok = $false; error = 'ocr-unavailable' }
    exit 0
  }

  $text = [PetOcr]::Recognize($tmp)
  Remove-Item $tmp -ErrorAction SilentlyContinue
  if ($null -eq $text) {
    Out-Result @{ ok = $false; error = 'ocr-unavailable' }
    exit 0
  }
  if ($UpdateHash -eq 1) {
    Set-Content -Path $hashFile -Value $hash -NoNewline -ErrorAction SilentlyContinue
  }
  Out-Result @{ ok = $true; text = [string]$text }
} catch {
  Out-Result @{ ok = $false; error = 'scan-failed'; detail = $_.Exception.Message }
}
