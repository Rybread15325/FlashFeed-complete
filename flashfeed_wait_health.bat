@echo off
setlocal enabledelayedexpansion
set max_attempts=120
set attempt=1
:loop
for /f "delims=" %%c in ('curl -s -o NUL -w "%%{http_code}" http://localhost:3001/api/health 2^>nul') do set code=%%c
if "%code%"=="200" (
  echo HEALTH:200
  exit /b 0
) else (
  echo Attempt !attempt! - status %code%
)
set /a attempt+=1
if %attempt% LEQ %max_attempts% (
  timeout /t 5 >nul
  goto loop
)
echo HEALTH:TIMEOUT
exit /b 1
