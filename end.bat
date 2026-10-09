@echo off
set PORT=5173
echo Stopping dev server on port %PORT%...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /i ":%PORT%" ^| findstr /i "LISTENING"') do (
  taskkill /f /pid %%a >nul 2>&1
  echo Killed process PID %%a
)
echo Done.
pause
