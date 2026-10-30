' Ecelon Station launcher (Windows): starts the server hidden (leaves it alone if it is already running),
' then opens Chrome/Edge as an app window without an address bar. Shortcuts: windows\install-shortcuts.bat
Option Explicit
Dim sh, fso, dir, url, i, browser, args
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://127.0.0.1:4777"

If Not IsUp() Then
  sh.CurrentDirectory = dir
  If Not fso.FolderExists(dir & "\data") Then fso.CreateFolder(dir & "\data")
  sh.Run "cmd /c node --watch server\index.js > data\server.log 2>&1", 0, False
  For i = 1 To 60
    WScript.Sleep 500
    If IsUp() Then Exit For
  Next
  If Not IsUp() Then
    MsgBox "Ecelon Station could not be started." & vbCrLf & "Details: " & dir & "\data\server.log" & vbCrLf & "Is Node.js installed? (node -v)", vbExclamation, "Ecelon Station"
    WScript.Quit 1
  End If
End If

' Called with "--background" at Windows startup: only start the server, do not open a window
For Each args In WScript.Arguments
  If LCase(args) = "--background" Then WScript.Quit 0
Next

browser = FindBrowser()
If browser <> "" Then
  sh.Run """" & browser & """ --app=" & url & " --window-size=1600,960", 1, False
Else
  sh.Run url
End If

Function IsUp()
  Dim h
  IsUp = False
  On Error Resume Next
  Set h = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  h.setTimeouts 400, 400, 800, 800
  h.Open "GET", url & "/api/meta", False
  h.Send
  If Err.Number = 0 Then
    If h.Status = 200 Then IsUp = True
  End If
  Err.Clear
  On Error GoTo 0
End Function

Function FindBrowser()
  Dim c, paths
  paths = Array( _
    sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe", _
    sh.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe", _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
    sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe")
  FindBrowser = ""
  For Each c In paths
    If fso.FileExists(c) Then
      FindBrowser = c
      Exit Function
    End If
  Next
End Function
