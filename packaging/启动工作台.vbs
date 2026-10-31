Option Explicit
Dim shell, fso, base, q
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
q = Chr(34)
shell.CurrentDirectory = base
shell.Run q & base & "\node.exe" & q & " " & q & base & "\start.mjs" & q, 0, False