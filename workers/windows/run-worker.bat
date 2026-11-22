@echo off
setlocal
if "%POCKETMIND_COORDINATOR_URL%"=="" (
  echo Set POCKETMIND_COORDINATOR_URL first.
  exit /b 2
)
if "%POCKETMIND_ENROLLMENT_TOKEN%"=="" (
  echo Set POCKETMIND_ENROLLMENT_TOKEN first.
  exit /b 2
)
python "%~dp0worker.py"
