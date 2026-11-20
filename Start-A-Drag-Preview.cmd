@echo off
setlocal
chcp 65001 >nul
set "A_DRAG_PREVIEW_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%A_DRAG_PREVIEW_NODE%" goto start
set "A_DRAG_PREVIEW_NODE=node.exe"
where "%A_DRAG_PREVIEW_NODE%" >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or later is required to start the preview.
  pause
  exit /b 1
)
:start
"%A_DRAG_PREVIEW_NODE%" "%~dp0A-Drag-Preview.mjs"
if errorlevel 1 pause
