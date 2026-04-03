const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Настройка CORS
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  // credentials: true
}));

// Middleware для парсинга JSON и URL-encoded данных
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Статические файлы из папки static
app.use('/static', express.static(path.join(__dirname, 'static')));

// Обслуживание HTML шаблонов
app.get('/', (req, res) => {
  const fs = require('fs');
  let html = fs.readFileSync(path.join(__dirname, 'templates/index.html'), 'utf8');
  const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8081';
  html = html.replace('</head>', `<script>window.BACKEND_URL = '${backendUrl}';</script></head>`);
  res.send(html);
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates/admin.html'));
});

// Обработка других маршрутов для шаблонов
// app.get('/templates/:templateName', (req, res) => {
//   const templateName = req.params.templateName;
//   const templatePath = path.join(__dirname, '../templates', templateName);
  
//   // Проверяем существует ли файл шаблона
//   const fs = require('fs');
//   if (fs.existsSync(templatePath)) {
//     res.sendFile(templatePath);
//   } else {
//     res.status(404).send('Template not found');
//   }
// });

// Обработка ошибок 404
app.use((req, res) => {
  res.status(404).send('Page not found');
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Frontend server running on port ${PORT}`);
  console.log(`Static files served at: http://localhost:${PORT}/static`);
  console.log(`Templates served at: http://localhost:${PORT}/`);
  console.log(`Admin panel at: http://localhost:${PORT}/admin`);
});

module.exports = app;