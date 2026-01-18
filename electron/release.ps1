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

# Получение версии из package.json
$packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
$version = $packageJson.version
Write-Host "Текущая версия: $version" -ForegroundColor Green

# Сохранение текущей ветки
$currentBranch = git branch --show-current
Write-Host "Текущая ветка: $currentBranch" -ForegroundColor Green

# Создание тега
$tag = "v$version"
try {
    git tag -a $tag -m "Релиз $tag"
    git push origin $tag
    Write-Host "Тег $tag создан и отправлен" -ForegroundColor Green
}
catch {
    Write-Host "Предупреждение: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Сборка с публикацией
$env:GH_TOKEN = $GH_TOKEN
try {
    npm run build-and-publish
}
finally {
    # Возврат к исходной ветке
    git checkout $currentBranch
    Write-Host "Возврат к ветке: $currentBranch" -ForegroundColor Green
    
    # Очистка
    if (Test-Path ".env") { Remove-Item ".env" }
}

Write-Host ""
Write-Host "Сборка и публикация завершены успешно!" -ForegroundColor Green