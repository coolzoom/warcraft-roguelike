@echo off
cd /d "F:\M2\HTML\warcraft-roguelike2\warcraft-roguelike"

REM If the dev server is already running on port 5173, just open it.
netstat -ano | findstr /i ":5173" | findstr /i "LISTENING" >nul
if %errorlevel%==0 (
  echo Dev server already running at http://localhost:5173/
  echo Opening browser...
  start "" http://localhost:5173/
  goto :eof
)

echo Starting Warcraft Roguelike dev server...
echo URL: http://localhost:5173/
echo (Close this window, or run end.bat, to stop the server)
npm run dev
