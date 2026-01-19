# release.ps1
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "BungaaCord Desktop - Сборка с публикацией"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Загрузка переменных из .env.prod
if (Test-Path ".env.build") {
    Get-Content ".env.build" | ForEach-Object {
        if ($_ -match "^\s*([^=]+)=(.*)") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }
}

$GH_TOKEN = [Environment]::GetEnvironmentVariable("GH_TOKEN")
if (-not $GH_TOKEN) {
    Write-Host "Ошибка: GH_TOKEN не найден в .env.build" -ForegroundColor Red
    exit 1
}

# Установка зависимостей
npm install
# Сборка с публикацией
$env:GH_TOKEN = $GH_TOKEN
npm run build-and-publish


Write-Host ""
Write-Host "Сборка и публикация завершены успешно!" -ForegroundColor Green