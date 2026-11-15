' Gym Manager - lanzador sin ventana negra.
' Doble clic: arranca el sistema en segundo plano y abre el navegador.
Option Explicit
Dim sh, fso, dir, url, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
url = "http://localhost:3000"

Function Activo()
  On Error Resume Next
  Dim h
  Set h = CreateObject("MSXML2.ServerXMLHTTP")
  h.setTimeouts 800, 800, 800, 800
  h.open "GET", url & "/login", False
  h.send
  Activo = (Err.Number = 0)
  Err.Clear
End Function

If Activo() Then
  sh.Run url
  WScript.Quit
End If

If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "Node.js no esta instalado. Descargalo de https://nodejs.org (version LTS) e intenta de nuevo.", 48, "Gym Manager"
  WScript.Quit
End If

If Not fso.FolderExists(dir & "\node_modules") Then
  MsgBox "Primera vez: se instalaran los componentes. Puede tardar un momento; el sistema se abrira solo.", 64, "Gym Manager"
  If sh.Run("cmd /c npm install --omit=dev", 1, True) <> 0 Then
    MsgBox "Error instalando los componentes. Revisa la conexion a internet.", 16, "Gym Manager"
    WScript.Quit
  End If
End If

sh.Run "cmd /c if not exist data mkdir data & node --no-warnings app.js >> data\servidor.log 2>&1", 0, False

For i = 1 To 30
  WScript.Sleep 500
  If Activo() Then Exit For
Next

If Activo() Then
  sh.Run url
Else
  MsgBox "El sistema no pudo iniciar. Revisa el archivo data\servidor.log", 16, "Gym Manager"
End If
