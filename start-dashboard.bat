@echo off
echo.
echo  ==========================================
echo   QA Automation Dashboard - Starting...
echo  ==========================================
echo.

echo  [1/3] Starting Captcha Server (port 3333)...
start "Captcha Server" cmd /k "node captcha-server.js"
timeout /t 2 /nobreak >nul

echo  [2/3] Starting QA Dashboard (port 4000)...
start "QA Dashboard" cmd /k "node server.js"
timeout /t 2 /nobreak >nul

echo  [3/3] Opening browser...
start http://localhost:4000

echo.
echo  Both servers are running!
echo  Captcha Server : http://localhost:3333
echo  QA Dashboard   : http://localhost:4000
echo.
echo  Close the Captcha Server and QA Dashboard windows to stop.
echo.
pause