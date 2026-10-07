' Starts the monitor without a window; the Startup folder runs it at login.
' The PATH a login gives may lack a node that only a shell profile adds
' (fnm, volta): say so, rather than fail where nobody can see it.
Dim sh, appDir
Set sh = CreateObject("WScript.Shell")
appDir = Replace(WScript.ScriptFullName, WScript.ScriptName, "")
If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "cc-footprint could not start: Node.js was not found." & vbCrLf & vbCrLf & _
    "Install it from https://nodejs.org/, or ask your AI assistant (Claude Code, say) " & _
    "to check why node is not on the PATH when you log in.", vbExclamation, "cc-footprint"
  WScript.Quit 1
End If
sh.Run "node """ & appDir & "app.js""", 0, False
