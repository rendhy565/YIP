@echo off
REM ============================================================================
REM ARC Business Suite — Windows Start Script
REM Double-click file ini untuk jalanin backend + frontend sekaligus
REM ============================================================================

setlocal

set ROOT=%~dp0
echo.
echo ============================================================
echo   ARC Business Suite — Starting Local Server
echo ============================================================
echo   Root: %ROOT%
echo.

REM Cek MongoDB jalan
sc query MongoDB | findstr RUNNING >nul
if errorlevel 1 (
    echo [!] MongoDB service tidak jalan. Mulai dengan:
    echo     net start MongoDB
    pause
    exit /b 1
)
echo [OK] MongoDB jalan

REM Cek backend venv
if not exist "%ROOT%backend\venv\Scripts\activate.bat" (
    echo [!] Virtual env backend belum dibuat.
    echo     Jalankan: cd backend ^&^& python -m venv venv ^&^& venv\Scripts\activate ^&^& pip install -r requirements.txt
    pause
    exit /b 1
)

REM Cek frontend node_modules
if not exist "%ROOT%frontend\node_modules" (
    echo [!] Dependencies frontend belum di-install.
    echo     Jalankan: cd frontend ^&^& yarn install
    pause
    exit /b 1
)

REM Cek .env files
if not exist "%ROOT%backend\.env" (
    echo [!] backend\.env belum ada. Salin dari .env.example dan edit.
    pause
    exit /b 1
)
if not exist "%ROOT%frontend\.env" (
    echo [!] frontend\.env belum ada. Buat dengan: echo REACT_APP_BACKEND_URL=http://localhost:8001 ^> .env
    pause
    exit /b 1
)

echo.
echo [*] Memulai Backend (port 8001)...
start "ARC Backend" cmd /k "cd /d %ROOT%backend && venv\Scripts\activate && uvicorn server:app --host 0.0.0.0 --port 8001 --reload"

timeout /t 3 /nobreak >nul

echo [*] Memulai Frontend (port 3000)...
start "ARC Frontend" cmd /k "cd /d %ROOT%frontend && yarn start"

echo.
echo ============================================================
echo   ARC sedang start. Tunggu 30 detik, browser akan otomatis buka.
echo.
echo   URL:   http://localhost:3000
echo   API:   http://localhost:8001/api/health
echo.
echo   Tutup window CMD masing-masing untuk stop server.
echo ============================================================
echo.
pause
