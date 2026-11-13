@echo off
cd /d "%~dp0"
if exist "%~dp0.local\runtimes\python-3.15.2\.ready" (
  "%~dp0.local\runtimes\python-3.15.2\python.exe" "%~dp0tools\launch.py" %*
) else (
  where py >nul 2>nul
  if errorlevel 1 (
    python "%~dp0tools\launch.py" %*
  ) else (
    py -3 "%~dp0tools\launch.py" %*
  )
)
if errorlevel 1 pause
