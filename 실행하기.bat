@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [공고패스 GongGoPass] 로컬 개발 서버를 시작합니다 (http://localhost:3000)...
start "" "http://localhost:3000"
where npm.cmd >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  call npm.cmd run dev
) else (
  set ELECTRON_RUN_AS_NODE=1
  start "" /wait /b "C:\Users\user\AppData\Local\Programs\antigravity\Antigravity.exe" "node_modules\next\dist\bin\next" dev -p 3000
)
pause
