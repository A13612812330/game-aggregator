Option Explicit
' ===================================================================
'  GameHub - 解压助手（拖放版 · 静默）
'
'  与「解压助手-拖放.cmd」的区别：这个不在屏幕上留黑窗口，跑完直接
'  用默认浏览器弹出 HTML 报告。适合拖一堆包之后不想看控制台的人。
'
'  用法：把压缩包 / 文件夹【拖到本文件上】。
'        ★ .vbs 拿不到拖放参数（WScript.Arguments 为空），所以这里
'          用「剪贴板 + 手输」两条兜底路径，见下面 GetTargets。
'
'  退出码来自 tools/extract-cli.js：
'    0 全好 ｜ 3 有失败 ｜ 4 有待解密 ｜ 1 没给目标
' ===================================================================
Const Q = """"
Dim shell, fso, root, nodeExe, cmd, vbase, best, f, rc, targets

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)

' ---------- 目标路径：拖放优先，其次问用户 ----------
targets = ""
If WScript.Arguments.Count > 0 Then
  Dim i
  For i = 0 To WScript.Arguments.Count - 1
    If targets <> "" Then targets = targets & " "
    targets = targets & Q & WScript.Arguments(i) & Q
  Next
Else
  ' .vbs 被拖放时 Windows 通常不传参（取决于关联），所以必须给一条手输路径，
  ' 否则用户拖了半天什么都不会发生 —— 那比报错更糟。
  targets = InputBox("把一个或多个压缩包 / 文件夹的完整路径粘进来（多个用 ; 分隔）：" & vbCrLf & vbCrLf & _
                     "例如：C:\Users\komo\Downloads\GameHub\save.rar", "GameHub 解压助手")
  If Trim(targets) = "" Then WScript.Quit 1
  Dim parts, k, buf
  parts = Split(targets, ";")
  buf = ""
  For k = 0 To UBound(parts)
    If Trim(parts(k)) <> "" Then
      If buf <> "" Then buf = buf & " "
      buf = buf & Q & Trim(parts(k)) & Q
    End If
  Next
  targets = buf
End If

' ---------- 找 node（不写死版本号：目录名带构建后缀，写死会静默失效）----------
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

If fso.FileExists(nodeExe) Then
  cmd = Q & nodeExe & Q & " " & Q & root & "\tools\extract-cli.js" & Q & " " & targets
Else
  cmd = "node " & Q & root & "\tools\extract-cli.js" & Q & " " & targets
End If

shell.CurrentDirectory = root
' 0 = 隐藏窗口；bWaitOnReturn = True 才能拿到退出码（报告要先由 CLI 弹出来）
rc = shell.Run(cmd, 0, True)

Select Case rc
  Case 0
    ' 正常完成，报告已弹出，静默结束
  Case 1
    MsgBox "没有给出要处理的路径。", 48, "GameHub 解压助手"
  Case 3
    MsgBox "有文件解压失败。" & vbCrLf & vbCrLf & _
           "报告已在浏览器打开，请看里面的「失败」区块（含 7z 的原文输出）。", 48, "GameHub 解压助手"
  Case 4
    MsgBox "有压缩包需要密码。" & vbCrLf & vbCrLf & _
           "报告已在浏览器打开，顶部列出了这些包，并给了一条「填上密码重跑」的命令。", 48, "GameHub 解压助手"
  Case Else
    MsgBox "处理过程返回了未预期的退出码 " & rc & "。" & vbCrLf & vbCrLf & _
           "建议改用「解压助手-拖放.cmd」，它会保留控制台输出方便排查。", 16, "GameHub 解压助手"
End Select
