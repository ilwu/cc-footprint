Dim appDir
appDir = Replace(WScript.ScriptFullName, WScript.ScriptName, "")
CreateObject("WScript.Shell").Run "node """ & appDir & "app.js""", 0, False
