; Stage 8g: our own uninstall window on top of Tauri's NSIS installer.
; Included by Tauri's installer.nsi (bundle.windows.nsis.installerHooks), before the languages
; are loaded - hence $LANGUAGE checks instead of LangString. Saved as UTF-8 with BOM: NSIS reads
; files without a BOM in the ANSI code page.

!macro ALMANAC_UNINSTALL_LINK
  ${If} $LANGUAGE = 1049
    StrCpy $R9 "Удалить Almanac Notch"
  ${Else}
    StrCpy $R9 "Uninstall Almanac Notch"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; "Apps" and the Start menu open the app's uninstall window (almanac-notch.exe --uninstall);
  ; uninstall.exe stays for silent removal (/S), which that window and the updater use
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --uninstall"
  WriteRegStr SHCTX "${UNINSTKEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
  ; Setup.exe passes /NODESKTOP when "Desktop shortcut" is off (silent NSIS always makes one)
  ClearErrors
  ${GetOptions} $CMDLINE "/NODESKTOP" $R8
  ${IfNot} ${Errors}
    Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
  ${If} $UpdateMode <> 1
    ${If} $AppStartMenuFolder == ""
      StrCpy $AppStartMenuFolder "${STARTMENUFOLDER}"
    ${EndIf}
    !insertmacro ALMANAC_UNINSTALL_LINK
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\$R9.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--uninstall" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ; Claude Code must not keep calling a deleted almanac-hook.exe: take our hooks out of
    ; ~/.claude/settings.json (other hooks stay), even when uninstall.exe was run directly
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --cleanup'
    ; our Start menu link goes first, so Tauri's RMDir of the folder succeeds
    !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
    ${If} $AppStartMenuFolder == ""
      StrCpy $AppStartMenuFolder "${STARTMENUFOLDER}"
    ${EndIf}
    Delete "$SMPROGRAMS\$AppStartMenuFolder\Удалить Almanac Notch.lnk"
    Delete "$SMPROGRAMS\$AppStartMenuFolder\Uninstall Almanac Notch.lnk"
  ${EndIf}
!macroend
