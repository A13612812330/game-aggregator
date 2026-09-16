Option Explicit
' ===================================================================
'  GameHub aggregator - silent launcher (no console window)
'  Starts "node server.js" hidden, then opens the browser.
'  If the port is already listening it just opens the browser.
' ===================================================================
Const PORT = 8123
Dim shell, fso, root, nodeExe, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)

' ---- already running? ----
If PortBusy(PORT) Then
  shell.Run "http://localhost:" & PORT, 1, False
  WScript.Quit 0
End If

' ---- locate node ----
nodeExe = "C:\Users\komo\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"
If fso.FileExists(nodeExe) Then
  cmd = Chr(34) & nodeExe & Chr(34) & " server.js"
Else
  cmd = "node server.js"
End If

' ---- start hidden (set cwd instead of "cd /d" to avoid quote nesting) ----
shell.CurrentDirectory = root
shell.Run cmd, 0, False

' ---- wait for boot, then open the browser ----
WScript.Sleep 2600
If Not PortBusy(PORT) Then WScript.Sleep 2500
shell.Run "http://localhost:" & PORT, 1, False

' -------------------------------------------------------------------
Function PortBusy(p)
  Dim ex, line
  PortBusy = False
  On Error Resume Next
  Set ex = shell.Exec("cmd.exe /c netstat -ano -p tcp")
  Do While Not ex.StdOut.AtEndOfStream
    line = ex.StdOut.ReadLine()
    If InStr(line, ":" & p & " ") > 0 And InStr(line, "LISTENING") > 0 Then
      PortBusy = True
      Exit Do
    End If
  Loop
  On Error GoTo 0
End Function
