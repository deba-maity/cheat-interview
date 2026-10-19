Option Explicit
Dim files, shell, root, executable
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = files.GetParentFolderName(WScript.ScriptFullName)
executable = files.BuildPath(root, "Stealth Overlay.exe")
If Not files.FileExists(executable) Then
  executable = files.BuildPath(root, "dist\win-unpacked\Stealth Overlay.exe")
End If
If files.FileExists(executable) Then
  shell.CurrentDirectory = root
  shell.Run Chr(34) & executable & Chr(34), 1, False
Else
  MsgBox "The built app is not in this folder yet." & vbCrLf & vbCrLf & "Copy Stealth Overlay.exe from your other computer, or install Node 24 LTS and double-click Build Windows App.cmd." & vbCrLf & vbCrLf & "Git pull downloads source code; it does not download the generated .exe.", vbInformation, "Stealth Overlay"
End If
