Option Explicit
' ===================================================================
'  GameHub aggregator - port 8123 keepalive  (silent, one-shot)
'
'  Called by a Windows Scheduled Task once a minute.
'    port 8123 listening  -> exit immediately (fast path, no process)
'    port 8123 free       -> start "node server.js" HIDDEN, wait for
'                            the port, append one line to the log
'
'  Why a .vbs and not a .ps1/.cmd:
'    wscript.exe belongs to the GUI subsystem, so it never allocates a
'    console. Run(cmd, 0, False) therefore creates the child with
'    SW_HIDE from the very first frame - no black window flashes.
'    A console host starts the window BEFORE a script can hide it,
'    which is exactly the "window flashes every minute" symptom.
'
'  Pure ASCII on purpose: WSH parses .vbs with the system ANSI code
'  page. Every path is derived at runtime (ScriptFullName) or from the
'  environment - none is typed as a literal.
' ===================================================================
Const PORT = 8123
Const WAIT_S = 20

Dim shell, fso, root, nodeExe, cmd, best, f, n, ok, vbase

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' <root>\tools\keepalive-8123.vbs  ->  <root>
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' ---- fast path: already listening, nothing to do -------------------
If PortBusy(PORT) Then WScript.Quit 0

' ---- locate node ---------------------------------------------------
'   Prefer the managed runtime, but never hard-code the version
'   folder: its name carries a build suffix that changes on update,
'   and a stale literal fails silently. Scan, take the newest name.
nodeExe = ""
vbase = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.workbuddy\binaries\node\versions"
If fso.FolderExists(vbase) Then
  best = ""
  For Each f In fso.GetFolder(vbase).SubFolders
    If fso.FileExists(f.Path & "\node.exe") Then
      If f.Name > best Then best = f.Name
    End If
  Next
  If best <> "" Then nodeExe = vbase & "\" & best & "\node.exe"
End If
If Not fso.FileExists(nodeExe) Then nodeExe = "node.exe"

cmd = Chr(34) & nodeExe & Chr(34) & " server.js"

' ---- start hidden --------------------------------------------------
shell.CurrentDirectory = root
On Error Resume Next
shell.Run cmd, 0, False
If Err.Number <> 0 Then
  WriteLog root, "START FAILED (spawn): " & Err.Description
  WScript.Quit 2
End If
On Error GoTo 0

' ---- do not trust the spawn: wait until the port really listens -----
ok = False
n = 0
Do While n < WAIT_S
  WScript.Sleep 1000
  n = n + 1
  If PortBusy(PORT) Then
    ok = True
    Exit Do
  End If
Loop

If ok Then
  WriteLog root, "started node server.js - port " & PORT & " listening after " & n & "s"
  WScript.Quit 0
Else
  WriteLog root, "START FAILED (timeout): port " & PORT & " not listening after " & WAIT_S & "s"
  WScript.Quit 3
End If


' -------------------------------------------------------------------
'  Port check.
'
'  WHY NOT WshShell Exec: Exec takes NO window-style argument (only Run
'  does), so for a console app it allocates a REAL, VISIBLE console window.
'  This once-a-minute health check therefore popped a cmd window every
'  minute - even when the fast path quit immediately.
'  Measured 2026-10-09: wscript pid=792 -> cmd.exe netstat -ano -p tcp
'  -> VISIBLE ConsoleWindowClass (twice inside the same minute).
'
'  Run(cmd, 0, True) passes SW_HIDE at CreateProcess time (the console is
'  never shown) and waits for the child, so the redirected output file is
'  complete before we read it. The temp name is unique per call and the
'  file is deleted right after it is read.
' -------------------------------------------------------------------
Function PortBusy(p)
  Dim line, tmp, fh
  PortBusy = False
  On Error Resume Next
  tmp = shell.ExpandEnvironmentStrings("%TEMP%") & "\" & fso.GetTempName()
  shell.Run "cmd.exe /c netstat -ano -p tcp > """ & tmp & """", 0, True
  Set fh = fso.OpenTextFile(tmp, 1, False)
  Do While Not fh.AtEndOfStream
    line = fh.ReadLine()
    If InStr(line, ":" & p & " ") > 0 And InStr(line, "LISTENING") > 0 Then
      PortBusy = True
      Exit Do
    End If
  Loop
  fh.Close
  fso.DeleteFile tmp, True
  On Error GoTo 0
End Function


Sub WriteLog(rootPath, msg)
  Dim p, t, s
  On Error Resume Next
  p = rootPath & "\_preview"
  If Not fso.FolderExists(p) Then fso.CreateFolder(p)
  t = CStr(Year(Now)) & "-" & Pad2(Month(Now)) & "-" & Pad2(Day(Now)) & " " & _
      Pad2(Hour(Now)) & ":" & Pad2(Minute(Now)) & ":" & Pad2(Second(Now))
  Set s = fso.OpenTextFile(p & "\keepalive.log", 8, True)
  s.WriteLine t & "  " & msg
  s.Close
  On Error GoTo 0
End Sub


Function Pad2(v)
  Pad2 = Right("0" & CStr(v), 2)
End Function
