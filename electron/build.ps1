# release.ps1
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "BungaaCord Desktop - Сборка"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Загрузка переменных из .env.build
if (Test-Path ".env.build") {
    Get-Content ".env.build" | ForEach-Object {
        if ($_ -match "^\s*([^=]+)=(.*)") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }
}

$BACKEND_URL = [Environment]::GetEnvironmentVariable("BACKEND_URL")
if (-not $BACKEND_URL) {
    Write-Host "Ошибка: BACKEND_URL не найден в .env.build" -ForegroundColor Red
    exit 1
}

# Установка зависимостей
npm install

# Создание config.json с BACKEND_URL для собранного приложения
Write-Host "Создание config.json с BACKEND_URL = $BACKEND_URL" -ForegroundColor Green
$configContent = "{`"backendUrl`": `"$BACKEND_URL`"}"
Set-Content "config.json" $configContent

# Сборка
npm run build

# Удаление временного config.json
Remove-Item "config.json" -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Сборка завершена!" -ForegroundColor Green