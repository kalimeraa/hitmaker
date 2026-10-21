Unicode true
ManifestDPIAware true
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 32
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

Name "Hitmaker"
OutFile "${OUTPUT}"
InstallDir "$PROGRAMFILES64\Hitmaker"
InstallDirRegKey HKLM "Software\Hitmaker" "InstallLocation"
ShowInstDetails show
ShowUninstDetails show
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Hitmaker"
VIAddVersionKey "FileDescription" "Hitmaker Windows Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Hitmaker"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Hitmaker Kurulumu"
!define MUI_WELCOMEPAGE_TEXT "Hitmaker bilgisayarınıza kurulacak ve masaüstüne panel kısayolu eklenecek.$\r$\n$\r$\nKurulum internete ihtiyaç duymaz. Windows 11 veya Windows Server 2019/2022, Intel/AMD 64 bit işlemci ve en az 2 GB boş alan gerekir.$\r$\n$\r$\nGörev ve hesap verileri güncelleme ve kaldırma sırasında korunur."
!define MUI_FINISHPAGE_RUN "$WINDIR\explorer.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS "http://127.0.0.1:3100"
!define MUI_FINISHPAGE_RUN_TEXT "Hitmaker panelini aç"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"

Function .onInit
  SetShellVarContext all
  SetRegView 64
  ${IfNot} ${IsNativeAMD64}
    MessageBox MB_ICONSTOP "Bu paket Intel/AMD x64 Windows içindir. ARM64 ve 32 bit Windows desteklenmez."
    SetErrorLevel 1
    Abort
  ${EndIf}
FunctionEnd

Function un.onInit
  SetShellVarContext all
  SetRegView 64
FunctionEnd

Section "Hitmaker" MainSection
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\payload"
  File /r "${PAYLOAD}/*"
  DetailPrint "Paket bütünlüğü, bağımlılıklar ve servisler kontrol ediliyor..."
  ${DisableX64FSRedirection}
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\payload\installer\install.ps1" -InstallRoot "$INSTDIR" -PayloadRoot "$PLUGINSDIR\payload"'
  Pop $0
  ${EnableX64FSRedirection}
  ${If} $0 == 3010
    SetRebootFlag true
  ${ElseIf} $0 != 0
    DetailPrint "Kurulum tamamlanamadı. Varsa önceki sürüm geri yüklendi; veriler korundu."
    IfSilent +2
    MessageBox MB_ICONSTOP "Hitmaker kurulumu tamamlanamadı.$\r$\nAyrıntılar yukarıdaki günlükte ve $APPDATA\Hitmaker\logs klasöründe.$\r$\nGörev ve hesap verileri silinmedi."
    SetErrorLevel 1
    Abort
  ${EndIf}
  CreateDirectory "$INSTDIR\maintenance"
  CopyFiles /SILENT "$PLUGINSDIR\payload\installer\install.ps1" "$INSTDIR\maintenance\install.ps1"
  CopyFiles /SILENT "$PLUGINSDIR\payload\installer\Installer.psm1" "$INSTDIR\maintenance\Installer.psm1"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Hitmaker" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hitmaker" "DisplayName" "Hitmaker"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hitmaker" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hitmaker" "Publisher" "Hitmaker"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hitmaker" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hitmaker" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hitmaker" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hitmaker" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hitmaker" "NoRepair" 1
  CreateDirectory "$SMPROGRAMS\Hitmaker"
  CreateShortCut "$DESKTOP\Hitmaker.lnk" "$WINDIR\explorer.exe" "http://127.0.0.1:3100"
  CreateShortCut "$SMPROGRAMS\Hitmaker\Hitmaker.lnk" "$WINDIR\explorer.exe" "http://127.0.0.1:3100"
  CreateShortCut "$SMPROGRAMS\Hitmaker\Hitmaker Kaldır.lnk" "$INSTDIR\Uninstall.exe"
  SetErrorLevel 0
SectionEnd

Section "Uninstall"
  InitPluginsDir
  CreateDirectory "$PLUGINSDIR\maintenance"
  CopyFiles /SILENT "$INSTDIR\maintenance\install.ps1" "$PLUGINSDIR\maintenance\install.ps1"
  CopyFiles /SILENT "$INSTDIR\maintenance\Installer.psm1" "$PLUGINSDIR\maintenance\Installer.psm1"
  ${DisableX64FSRedirection}
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\maintenance\install.ps1" -Action Uninstall -InstallRoot "$INSTDIR"'
  Pop $0
  ${EnableX64FSRedirection}
  ${If} $0 != 0
    IfSilent +2
    MessageBox MB_ICONSTOP "Servisler kaldırılamadı. Program kaydı ve veriler korundu. Günlüğü kontrol edin."
    SetErrorLevel 1
    Abort
  ${EndIf}
  Delete "$DESKTOP\Hitmaker.lnk"
  Delete "$SMPROGRAMS\Hitmaker\Hitmaker.lnk"
  Delete "$SMPROGRAMS\Hitmaker\Hitmaker Kaldır.lnk"
  RMDir "$SMPROGRAMS\Hitmaker"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hitmaker"
  DeleteRegKey HKLM "Software\Hitmaker"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\maintenance\install.ps1"
  Delete "$INSTDIR\maintenance\Installer.psm1"
  RMDir "$INSTDIR\maintenance"
  RMDir "$INSTDIR"
  SetErrorLevel 0
SectionEnd
