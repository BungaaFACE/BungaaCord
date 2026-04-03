@echo off
echo Starting BungaaCord Frontend Server...
echo.

REM Проверяем, установлен ли Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Проверяем, установлен ли npm
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: npm is not installed!
    echo Please install npm from https://nodejs.org/
    pause
    exit /b 1
)

REM Копируем .env.example в .env, если .env не существует
if not exist ".env" (
    echo Creating .env file from .env.example...
    copy .env.example .env >nul
    echo .env file created successfully!
)

REM Устанавливаем зависимости, если их нет
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    echo Dependencies installed successfully!
)

REM Запускаем сервер
echo Starting server on port 3000...
echo Open http://localhost:3000 in your browser
echo.
node server.js

pause