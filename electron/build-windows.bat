@echo off
echo ========================================
echo BungaaCord Desktop - Сборка для Windows
echo ========================================
echo.

REM Проверка Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Ошибка: Node.js не установлен или не найден в PATH
    echo Пожалуйста, установите Node.js с https://nodejs.org/
    pause
    exit /b 1
)

echo Проверка npm...
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Ошибка: npm не установлен или не найден в PATH
    pause
    exit /b 1
)

echo.
echo Установка зависимостей...
cd /d "%~dp0"
call npm install

if %errorlevel% neq 0 (
    echo Ошибка: Не удалось установить зависимости
    pause
    exit /b 1
)

echo.
echo Копирование файла .env.prod в .env...
copy ".env.prod" ".env" >nul 2>&1

echo.
echo Сборка приложения...
call npm run build

echo.
echo Удаление временного файла .env...
if exist ".env" (
    del ".env" >nul 2>&1
)

if %errorlevel% neq 0 (
    echo Ошибка: Не удалось собрать приложение
    pause
    exit /b 1
)

echo.
echo ========================================
echo Сборка завершена успешно!
echo.
echo Файлы сборки находятся в папке: dist\
echo.
echo Установщик: BungaaCord Desktop Setup 1.0.0.exe
echo Портативная версия: BungaaCord Desktop 1.0.0 Portable.exe
echo.
echo ========================================
pause