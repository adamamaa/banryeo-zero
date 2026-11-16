@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [공고패스 GongGoPass] 로컬 개발 서버를 시작합니다 (http://localhost:3000)...
start "" "http://localhost:3000"
call npm.cmd run dev
pause
