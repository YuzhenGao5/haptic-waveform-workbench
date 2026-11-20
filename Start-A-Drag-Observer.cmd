@echo off
setlocal
chcp 65001 >nul
set "A_DRAG_OBSERVER_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%A_DRAG_OBSERVER_NODE%" goto start
set "A_DRAG_OBSERVER_NODE=node.exe"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or later is required to start the waveform workbench.
  pause
  exit /b 1
)
:start
"%A_DRAG_OBSERVER_NODE%" "%~dp0A-Drag-Observer.mjs"
if errorlevel 1 pause
