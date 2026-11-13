#Requires -Version 5.1
<#
.SYNOPSIS
  Registers FireSocks as a real Windows browser app: StartMenuInternet
  capabilities, RegisteredApplications, ProgIDs, App Paths, AUMID-tagged
  shortcuts, and an Apps & Features uninstall entry.
  All keys are under HKCU - no admin rights needed.

.PARAMETER InstallDir
  Directory containing firesocks.exe. Defaults to %LOCALAPPDATA%\FireSocks.

.PARAMETER Uninstall
  Remove all registrations and shortcuts (keeps the profile and, by
  default, the install dir; use -RemoveFiles to delete it too).
#>
[CmdletBinding()]
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\FireSocks",
  [switch]$Uninstall,
  [switch]$RemoveFiles,
  [ValidateSet('auto', 'power', 'high')]
  [string]$GpuPreference = 'high'
)

$ErrorActionPreference = 'Stop'
$exe       = Join-Path $InstallDir 'firesocks.exe'
$ico       = Join-Path $InstallDir 'firesocks.ico'
$brand     = 'FireSocks'
$aumid     = 'FireSocks'
$smiKey    = "HKCU:\SOFTWARE\Clients\StartMenuInternet\$brand"
$capPath   = "SOFTWARE\Clients\StartMenuInternet\$brand\Capabilities"
$classes   = 'HKCU:\SOFTWARE\Classes'
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
$desktop   = [Environment]::GetFolderPath('Desktop')

$protocols = @{
  'http'  = 'FireSocksURL'
  'https' = 'FireSocksURL'
}
$fileTypes = @{
  '.htm'   = 'FireSocksHTM'
  '.html'  = 'FireSocksHTM'
  '.shtml' = 'FireSocksHTM'
  '.xht'   = 'FireSocksHTM'
  '.xhtml' = 'FireSocksHTM'
  '.webp'  = 'FireSocksHTM'
  '.svg'   = 'FireSocksHTM'
  '.pdf'   = 'FireSocksHTM'
}
$iconRef = if (Test-Path $ico) { "`"$ico`",0" } else { "`"$exe`",0" }

function Remove-FireSocks {
  foreach ($k in @($smiKey,
                   "$classes\FireSocksHTM",
                   "$classes\FireSocksURL",
                   "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firesocks.exe",
                   "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$brand",
                   "HKCU:\SOFTWARE\$brand")) {
    if (Test-Path $k) { Remove-Item $k -Recurse -Force }
  }
  Remove-ItemProperty 'HKCU:\SOFTWARE\RegisteredApplications' -Name $brand -ErrorAction SilentlyContinue
  foreach ($assoc in ($protocols.Keys + $fileTypes.Keys)) {
    $owp = "$classes\$assoc\OpenWithProgids"
    if (Test-Path $owp) {
      Remove-ItemProperty $owp -Name ($protocols[$assoc], $fileTypes[$assoc] |
        Where-Object {$_} | Select-Object -First 1) -ErrorAction SilentlyContinue
    }
  }
  foreach ($lnk in @("$startMenu\$brand.lnk",
                     "$startMenu\$brand Private Browsing.lnk",
                     "$desktop\$brand.lnk")) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force }
  }
  Remove-ItemProperty 'HKCU:\SOFTWARE\Microsoft\DirectX\UserGpuPreferences' `
    -Name $exe -ErrorAction SilentlyContinue
  if ($RemoveFiles -and (Test-Path $InstallDir)) {
    cmd /c "ping -n 2 127.0.0.1 >NUL & rmdir /s /q `"$InstallDir`""
  }
  Write-Host "FireSocks unregistered."
}

function Set-LinkAumid([string]$Path, [string]$Aumid) {
  $src = @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

public static class LinkAumid {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  private class CShellLink {}
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown),
   Guid("000214F9-0000-0000-C000-000000000046")]
  private interface IShellLinkW {}
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown),
   Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
  private interface IPropertyStore {
    void GetCount(out uint cProps);
    void GetAt(uint iProp, out PROPERTYKEY pkey);
    void GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
    void SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
    void Commit();
  }
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  private struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit)]
  private struct PROPVARIANT {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pwszVal;
  }
  public static void Set(string path, string aumid) {
    var link = (IShellLinkW)new CShellLink();
    ((IPersistFile)link).Load(path, 0x2 /* STGM_READWRITE */);
    var store = (IPropertyStore)link;
    var key = new PROPERTYKEY {
      fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    var pv = new PROPVARIANT { vt = 31 /* VT_LPWSTR */,
      pwszVal = Marshal.StringToCoTaskMemUni(aumid) };
    try { store.SetValue(ref key, ref pv); store.Commit(); }
    finally { Marshal.FreeCoTaskMem(pv.pwszVal); }
    ((IPersistFile)link).Save(path, true);
  }
}
'@
  Add-Type -TypeDefinition $src -ReferencedAssemblies @('System') -ErrorAction Stop
  [LinkAumid]::Set($Path, $Aumid)
}

function New-FireSocksShortcut([string]$Path, [string]$Arguments,
                               [string]$Description) {
  $sh = New-Object -ComObject WScript.Shell
  $s = $sh.CreateShortcut($Path)
  $s.TargetPath = $exe
  $s.Arguments = $Arguments
  $s.WorkingDirectory = $InstallDir
  $s.IconLocation = if (Test-Path $ico) { "$ico,0" } else { "$exe,0" }
  $s.Description = $Description
  $s.Save()
  Set-LinkAumid $Path $aumid
}

function Install-FireSocks {
  if (-not (Test-Path $exe)) { throw "firesocks.exe not found in $InstallDir" }
  $version = '0.0'
  $ini = Join-Path $InstallDir 'application.ini'
  if (Test-Path $ini) {
    $v = Select-String -Path $ini -Pattern '^Version=(.+)$' |
         Select-Object -First 1
    if ($v) { $version = $v.Matches[0].Groups[1].Value.Trim() }
  }

  # Ship enterprise/extension policy (uBOLite managed storage) alongside
  # the binary when a staged distribution dir is next to this script.
  $distSrc = Join-Path $PSScriptRoot 'distribution'
  if (Test-Path $distSrc) {
    Copy-Item -Path "$distSrc\*" -Destination (Join-Path $InstallDir 'distribution') `
      -Recurse -Force
  }

  New-Item -Path $smiKey -Force | Out-Null
  Set-ItemProperty $smiKey -Name '(Default)' -Value $brand
  New-Item -Path "$smiKey\DefaultIcon" -Force | Out-Null
  Set-ItemProperty "$smiKey\DefaultIcon" -Name '(Default)' -Value $iconRef
  New-Item -Path "$smiKey\shell\open\command" -Force | Out-Null
  Set-ItemProperty "$smiKey\shell\open\command" -Name '(Default)' `
    -Value "`"$exe`""
  New-Item -Path "$smiKey\shell\properties" -Force | Out-Null
  Set-ItemProperty "$smiKey\shell\properties" -Name '(Default)' `
    -Value "$brand &Options"
  New-Item -Path "$smiKey\shell\properties\command" -Force | Out-Null
  Set-ItemProperty "$smiKey\shell\properties\command" -Name '(Default)' `
    -Value "`"$exe`" -url about:preferences"
  New-Item -Path "$smiKey\InstallInfo" -Force | Out-Null
  Set-ItemProperty "$smiKey\InstallInfo" -Name 'IconsVisible' `
    -Value 1 -Type DWord
  Set-ItemProperty "$smiKey\InstallInfo" -Name 'ReinstallCommand' `
    -Value "`"$exe`" -url about:home"
  Set-ItemProperty "$smiKey\InstallInfo" -Name 'HideIconsCommand' `
    -Value "`"$exe`" /HideIcons"
  Set-ItemProperty "$smiKey\InstallInfo" -Name 'ShowIconsCommand' `
    -Value "`"$exe`" /ShowIcons"

  New-Item -Path "$smiKey\Capabilities" -Force | Out-Null
  Set-ItemProperty "$smiKey\Capabilities" -Name 'ApplicationName' -Value $brand
  Set-ItemProperty "$smiKey\Capabilities" -Name 'ApplicationIcon' -Value $iconRef
  Set-ItemProperty "$smiKey\Capabilities" -Name 'ApplicationDescription' `
    -Value 'FireSocks - performance-tuned web browser based on Firefox'
  Set-ItemProperty "$smiKey\Capabilities" -Name 'AppUserModelId' -Value $aumid
  Set-ItemProperty "$smiKey\Capabilities" -Name 'StartMenuInternet' -Value $brand
  New-Item -Path "$smiKey\Capabilities\URLAssociations" -Force | Out-Null
  foreach ($p in $protocols.GetEnumerator()) {
    Set-ItemProperty "$smiKey\Capabilities\URLAssociations" `
      -Name $p.Key -Value $p.Value
  }
  New-Item -Path "$smiKey\Capabilities\FileAssociations" -Force | Out-Null
  foreach ($f in $fileTypes.GetEnumerator()) {
    Set-ItemProperty "$smiKey\Capabilities\FileAssociations" `
      -Name $f.Key -Value $f.Value
  }

  New-Item -Path 'HKCU:\SOFTWARE\RegisteredApplications' -Force | Out-Null
  Set-ItemProperty 'HKCU:\SOFTWARE\RegisteredApplications' `
    -Name $brand -Value $capPath

  New-Item -Path "$classes\FireSocksHTM" -Force | Out-Null
  Set-ItemProperty "$classes\FireSocksHTM" -Name '(Default)' `
    -Value 'FireSocks Document'
  Set-ItemProperty "$classes\FireSocksHTM" -Name 'AppUserModelId' -Value $aumid
  Set-ItemProperty "$classes\FireSocksHTM" -Name 'ApplicationName' -Value $brand
  Set-ItemProperty "$classes\FireSocksHTM" -Name 'ApplicationIcon' -Value $iconRef
  New-Item -Path "$classes\FireSocksHTM\DefaultIcon" -Force | Out-Null
  Set-ItemProperty "$classes\FireSocksHTM\DefaultIcon" -Name '(Default)' `
    -Value $iconRef
  New-Item -Path "$classes\FireSocksHTM\shell\open\command" -Force | Out-Null
  Set-ItemProperty "$classes\FireSocksHTM\shell\open\command" `
    -Name '(Default)' -Value "`"$exe`" -osint -url `"%1`""

  New-Item -Path "$classes\FireSocksURL" -Force | Out-Null
  Set-ItemProperty "$classes\FireSocksURL" -Name '(Default)' `
    -Value 'FireSocks URL'
  Set-ItemProperty "$classes\FireSocksURL" -Name 'URL Protocol' -Value ''
  Set-ItemProperty "$classes\FireSocksURL" -Name 'AppUserModelId' -Value $aumid
  Set-ItemProperty "$classes\FireSocksURL" -Name 'EditFlags' `
    -Value 2 -Type DWord
  New-Item -Path "$classes\FireSocksURL\DefaultIcon" -Force | Out-Null
  Set-ItemProperty "$classes\FireSocksURL\DefaultIcon" -Name '(Default)' `
    -Value $iconRef
  New-Item -Path "$classes\FireSocksURL\shell\open\command" -Force | Out-Null
  Set-ItemProperty "$classes\FireSocksURL\shell\open\command" `
    -Name '(Default)' -Value "`"$exe`" -osint -url `"%1`""

  foreach ($a in $protocols.GetEnumerator()) {
    New-Item -Path "$classes\$($a.Key)\OpenWithProgids" -Force | Out-Null
    New-ItemProperty -Path "$classes\$($a.Key)\OpenWithProgids" `
      -Name $a.Value -PropertyType String -Value '' -Force | Out-Null
  }
  foreach ($f in $fileTypes.GetEnumerator()) {
    New-Item -Path "$classes\$($f.Key)\OpenWithProgids" -Force | Out-Null
    New-ItemProperty -Path "$classes\$($f.Key)\OpenWithProgids" `
      -Name $f.Value -PropertyType String -Value '' -Force | Out-Null
  }

  New-Item -Path `
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firesocks.exe' `
    -Force | Out-Null
  Set-ItemProperty `
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firesocks.exe' `
    -Name '(Default)' -Value $exe
  Set-ItemProperty `
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firesocks.exe' `
    -Name 'Path' -Value $InstallDir

  $uninst = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$brand"
  New-Item -Path $uninst -Force | Out-Null
  Set-ItemProperty $uninst -Name 'DisplayName' -Value $brand
  Set-ItemProperty $uninst -Name 'DisplayIcon' -Value "`"$exe`",0"
  Set-ItemProperty $uninst -Name 'DisplayVersion' -Value $version
  Set-ItemProperty $uninst -Name 'Publisher' -Value 'FireSocks'
  Set-ItemProperty $uninst -Name 'InstallLocation' -Value $InstallDir
  Set-ItemProperty $uninst -Name 'NoModify' -Value 1 -Type DWord
  Set-ItemProperty $uninst -Name 'NoRepair' -Value 1 -Type DWord
  $self = $MyInvocation.MyCommand.Path
  if ($self) {
    $helper = Join-Path $InstallDir 'uninstall-firesocks.ps1'
    Copy-Item $self $helper -Force
    Set-ItemProperty $uninst -Name 'UninstallString' -Value `
      "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$helper`" -Uninstall -InstallDir `"$InstallDir`""
  }

  New-FireSocksShortcut "$startMenu\$brand.lnk" '' 'FireSocks Web Browser'
  New-FireSocksShortcut "$startMenu\$brand Private Browsing.lnk" `
    '-private-window' 'FireSocks Private Browsing'
  New-FireSocksShortcut "$desktop\$brand.lnk" '' 'FireSocks Web Browser'

  # Hybrid-GPU laptops: prefer the high-performance GPU for FireSocks
  # (Windows Settings > System > Display > Graphics). 0=Let Windows
  # decide, 1=Power saving, 2=High performance.
  $gpuPrefs = 'HKCU:\SOFTWARE\Microsoft\DirectX\UserGpuPreferences'
  New-Item -Path $gpuPrefs -Force | Out-Null
  if ($GpuPreference -eq 'auto') {
    Remove-ItemProperty $gpuPrefs -Name $exe -ErrorAction SilentlyContinue
  } else {
    $pref = @{ 'power' = 1; 'high' = 2 }[$GpuPreference]
    if (-not $pref) { $pref = 2 }
    Set-ItemProperty $gpuPrefs -Name $exe -Value "GpuPreference=$pref;"
  }

  Write-Host "FireSocks registered as a browser (HKCU). Version: $version"
  Write-Host "Set as default: Settings > Apps > Default apps > FireSocks"
  Write-Host "  or run: start ms-settings:defaultapps?registeredAppMachine=$brand"
}

if ($Uninstall) { Remove-FireSocks } else { Install-FireSocks }
