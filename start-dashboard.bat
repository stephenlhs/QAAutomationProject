@echo off
title QA Automation Dashboard
echo.
echo  ================================================
echo   QA Automation Dashboard
echo  ================================================
echo.
echo  Starting servers...
echo.

:: Start captcha server
start "Captcha Server" cmd /k "cd /d %~dp0 && node captcha-server.js"
timeout /t 2 /nobreak > nul

:: Start dashboard server
start "QA Dashboard Server" cmd /k "cd /d %~dp0 && node server.js"
timeout /t 3 /nobreak > nul

:: Open browser
echo  Opening browser at http://localhost:4000
start http://localhost:4000

echo.
echo  Dashboard is running!
echo  Captcha Server : port 3333
echo  QA Dashboard   : http://localhost:4000
echo.
echo  Close the two terminal windows to stop all servers.
echo.
pause