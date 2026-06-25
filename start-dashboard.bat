@echo off
echo.
echo  ==========================================
echo   QA Automation Dashboard - Starting...
echo  ==========================================
echo.

echo  [1/4] Starting Captcha Server (port 3333)...
start "Captcha Server" cmd /k "node captcha-server.js"
timeout /t 2 /nobreak >nul

echo  [2/4] Starting QA Dashboard (port 4000)...
start "QA Dashboard" cmd /k "node server.js"
timeout /t 2 /nobreak >nul

echo  [3/4] Opening local dashboard...
start http://localhost:4000

echo  [4/4] Starting ngrok tunnel (port 4000)...
set NGROK=%APPDATA%\npm\node_modules\ngrok\bin\ngrok.exe
start "ngrok" cmd /k ""%NGROK%" http 4000"

echo.
echo  Servers running:
echo    Captcha Server : http://localhost:3333
echo    QA Dashboard   : http://localhost:4000 (local)
echo.
echo  Check the ngrok window for your public HTTPS URL.
echo  Share that URL to access the dashboard from anywhere.
echo.
pause
