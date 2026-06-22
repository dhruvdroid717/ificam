!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
!macroend

!macro customInstall
  SetShellVarContext current
  CreateDirectory "$SMPROGRAMS\Ungyani"
  CreateShortCut "$SMPROGRAMS\Ungyani\iFicam.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\icon.ico" 0
  CreateShortCut "$DESKTOP\iFicam.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\icon.ico" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Ungyani\iFicam.lnk"
  RMDir "$SMPROGRAMS\Ungyani"
  Delete "$DESKTOP\iFicam.lnk"
!macroend
