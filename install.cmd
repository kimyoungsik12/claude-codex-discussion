@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -X utf8 install.py %*
) else (
  python -X utf8 install.py %*
)
set "pair_result=%errorlevel%"
if not "%pair_result%"=="0" echo Python 3.10+ required. Check README.md and the error above.
if "%~1"=="" pause
exit /b %pair_result%
