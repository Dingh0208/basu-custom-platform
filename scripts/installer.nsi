Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
!include "MUI2.nsh"

!ifndef APP_DIR
  !define APP_DIR "D:\code\Basu-Custom-Platform\release\win-unpacked"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "D:\code\Basu-Custom-Platform\release\ClientHub Setup 0.1.0.exe"
!endif

Name "ClientHub 客户信息聚合工作台"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\ClientHub"
InstallDirRegKey HKCU "Software\ClientHub" "InstallDir"
RequestExecutionLevel user
BrandingText "ClientHub"

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "ClientHub" SecMain
  SetOutPath "$INSTDIR"
  File /r "${APP_DIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\ClientHub"
  CreateShortcut "$SMPROGRAMS\ClientHub\ClientHub.lnk" "$INSTDIR\ClientHub.exe"
  CreateShortcut "$DESKTOP\ClientHub.lnk" "$INSTDIR\ClientHub.exe"

  WriteRegStr HKCU "Software\ClientHub" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClientHub" "DisplayName" "ClientHub 客户信息聚合工作台"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClientHub" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClientHub" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClientHub" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClientHub" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\ClientHub.lnk"
  Delete "$SMPROGRAMS\ClientHub\ClientHub.lnk"
  RMDir "$SMPROGRAMS\ClientHub"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClientHub"
  DeleteRegKey HKCU "Software\ClientHub"
SectionEnd
