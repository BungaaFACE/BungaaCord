# BungaaCord Frontend Server

Фронтенд сервер для обслуживания статических файлов и HTML шаблонов BungaaCord.

## Функциональность

- Обслуживание статических файлов из папки `../static`
- Отдача HTML шаблонов из папки `../templates`
- Поддержка CORS
- Конфигурируемый порт через переменные окружения
- Обработка ошибок 404 и 500

## Быстрый старт

### Windows

1. Запустите скрипт запуска:
   ```bash
   start-server.bat
   ```

### Ручной запуск

1. Установите зависимости:
   ```bash
   npm install
   ```

2. Создайте файл `.env` из `.env.example`:
   ```bash
   copy .env.example .env
   ```

3. Запустите сервер:
   ```bash
   npm start
   ```

## Доступные URL

- Главная страница: `http://localhost:8080/`
- Админ панель: `http://localhost:8080/admin`
- Статические файлы: `http://localhost:8080/static/`
- Другие шаблоны: `http://localhost:8080/templates/[имя_шаблона]`

## Конфигурация

Скопируйте `.env.example` в `.env` и настройте переменные окружения:

```env
PORT=3000
FRONTEND_URL=http://localhost:3000
NODE_ENV=development
```

## Разработка

Для запуска в режиме разработки с автоматической перезагрузкой:

```bash
npm run dev
```

## Структура проекта

```
frontend/
├── server.js          # Основной файл сервера
├── package.json       # Зависимости и скрипты
├── .env.example       # Пример конфигурации
├── .gitignore         # Игнорируемые файлы
├── start-server.bat   # Скрипт запуска для Windows
└── README.md          # Этот файл
```

## Зависимости

- `express` - Веб-фреймворк
- `cors` - Поддержка CORS
- `path` - Работа с путями файлов
- `dotenv` - Управление переменными окружения

## Лицензия

MIT License