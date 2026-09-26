$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class VirtualPetForeground {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@

$hwnd = [VirtualPetForeground]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
    Write-Error 'No foreground window handle.'
    exit 1
}

$builder = New-Object System.Text.StringBuilder 512
$written = [VirtualPetForeground]::GetWindowText($hwnd, $builder, $builder.Capacity)
if ($written -le 0) {
    exit 0
}

Write-Output $builder.ToString()
