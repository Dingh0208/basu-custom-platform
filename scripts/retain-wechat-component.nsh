!macro retainWechatFrom LOCATION
  ${If} ${FileExists} "${LOCATION}\resources\wechat-engine\wechat-backend.exe"
  ${AndIfNot} ${FileExists} "$APPDATA\ClientHub\components\wechat-engine\wechat-backend.exe"
    CreateDirectory "$APPDATA\ClientHub\components\wechat-engine\native"
    CopyFiles /SILENT "${LOCATION}\resources\wechat-engine\wechat-backend.exe" "$APPDATA\ClientHub\components\wechat-engine"
    CopyFiles /SILENT "${LOCATION}\resources\wechat-engine\native\*.*" "$APPDATA\ClientHub\components\wechat-engine\native"
  ${EndIf}
!macroend

!macro customInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  !insertmacro retainWechatFrom "$0"
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  !insertmacro retainWechatFrom "$0"
  ReadRegStr $0 HKCU "Software\ClientHub" InstallDir
  !insertmacro retainWechatFrom "$0"
!macroend
