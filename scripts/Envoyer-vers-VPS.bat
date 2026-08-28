@echo off
REM Double-cliquable : envoie la base LOCALE vers le VPS (ecrase la production).
REM Passe la main a db-push.sh sous Git Bash ; la fenetre reste ouverte a la fin.
chcp 65001 >nul
title Envoyer la base vers le VPS
cd /d "%~dp0"

set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
if not exist "%BASH%" (
  echo.
  echo   Git Bash introuvable.
  echo   Installez Git pour Windows : https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

REM Chemin POSIX : bash -l repart de HOME, et dirname ne comprend pas les \ de Windows
set "DIR=%~dp0"
set "DIR=%DIR:\=/%"
"%BASH%" -l -c "cd '%DIR%' && exec ./db-push.sh"
set RC=%ERRORLEVEL%

echo.
if %RC%==0 (
  echo   --- Termine ---
) else (
  echo   --- Arrete ^(code %RC%^) : rien n'a ete ecrase si l'erreur est survenue avant la bascule ---
)
echo.
pause
