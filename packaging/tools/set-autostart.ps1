param([switch]$Remove)

# 在「登录 Windows 后自动在后台启动工作台」和「取消」之间切换。
# 由「设置开机自启.bat」/「取消开机自启.bat」调用。

$ErrorActionPreference = "Stop"

$base = Split-Path -Parent $PSScriptRoot
$startup = [Environment]::GetFolderPath("Startup")
$vbsPath = Join-Path $startup "中医工作台-后台启动.vbs"
$exe = Join-Path $base "中医工作台.exe"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runName = "ZhongyiWorkbench"

function Pause2 {
  if ($env:ZYB_SILENT -eq "1") { return }
  Write-Host ""
  Write-Host "按任意键关闭…"
  [void]$Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

if ($Remove) {
  Remove-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $vbsPath) { Remove-Item -LiteralPath $vbsPath -Force }
  Write-Host "已取消开机自启。下次登录 Windows 不会自动在后台启动。"
  Pause2
  exit 0
}

if (-not (Test-Path -LiteralPath $exe)) {
  Write-Host "没找到「中医工作台.exe」，请把 tools 文件夹留在工作台目录里。"
  Pause2
  exit 1
}

$ok = $false
$how = ""

try {
  New-ItemProperty -Path $runKey -Name $runName -Value ('"' + $exe + '" --background') -PropertyType String -Force | Out-Null
  $check = (Get-ItemProperty -Path $runKey -Name $runName -ErrorAction Stop).$runName
  if ($check) { $ok = $true; $how = "注册表" }
} catch {
  try {
    $lineRun = 'sh.Run q & "' + $exe + '" & q & " --background", 0, False'
    $lines = @(
      "' 由「设置开机自启.bat」生成：登录后在后台把工作台服务准备好，不弹窗口。",
      'Set sh = CreateObject("WScript.Shell")',
      'q = Chr(34)',
      $lineRun,
      ''
    )
    $bytes = [Text.Encoding]::Unicode.GetBytes(($lines -join "`r`n"))
    [IO.File]::WriteAllBytes($vbsPath, [byte[]](0xFF, 0xFE) + $bytes)
    if (Test-Path -LiteralPath $vbsPath) { $ok = $true; $how = "启动文件夹" }
  } catch {
    $ok = $false
  }
}

if ($ok) {
  Write-Host "已设置开机自启（$how）。"
  Write-Host "登录 Windows 后工作台会在后台准备好，点桌面图标即可秒开（约 0.3 秒起窗口）。"
  Write-Host ""
  Write-Host "想取消：双击「取消开机自启.bat」。"
} else {
  Write-Host "设置失败：系统拒绝了写入启动项。"
  Write-Host "可以改用「启动工作台.bat」手动启动（也能正常用，只是每次要多等 1~2 秒）。"
}

Pause2
