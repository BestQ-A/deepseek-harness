Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Window {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
}
"@
$procs = Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue
foreach ($p in $procs) {
  if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
    [Win32Window]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null
    Start-Sleep -Milliseconds 300
    [Win32Window]::MoveWindow($p.MainWindowHandle, 120, 80, 1280, 820, $true) | Out-Null
    Write-Output "HWND: $($p.MainWindowHandle) IsIconic: $([Win32Window]::IsIconic($p.MainWindowHandle))"
  }
}
