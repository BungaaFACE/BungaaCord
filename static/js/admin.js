// admin.js - Панель администратора для управления пользователями

let currentAdminUUID = '';
let currentAdminUsername = '';

// Генерация UUID v4
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Получение параметров из URL
function getQueryParams() {
    const params = {};
    const queryString = window.location.search.substring(1);
    const pairs = queryString.split('&');
    
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i].split('=');
        if (pair.length === 2) {
            params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
        }
    }
    return params;
}

// Проверка прав администратора
async function checkAdminAccess() {
    const params = getQueryParams();
    const userUUID = params.user;
    
    if (!userUUID) {
        return false;
    }
    
    try {
        const response = await fetch(`/api/user?user=${userUUID}`);
        const data = await response.json();
        
        if (data.status === 'ok' && data.user.is_admin) {
            currentAdminUUID = userUUID;
            currentAdminUsername = data.user.username;
            document.getElementById('currentAdminUsername').textContent = currentAdminUsername;
            return true;
        }
    } catch (error) {
        console.error('Ошибка проверки прав:', error);
    }
    
    return false;
}

// Загрузка списка пользователей
async function loadUsers() {
    try {
        const response = await fetch(`/admin/api/users?user=${currentAdminUUID}`);
        
        if (response.status === 403) {
            showError('Доступ запрещен: требуются права администратора');
            return;
        }
        
        if (response.status === 401) {
            showError('Доступ запрещен: неверный пользователь');
            return;
        }
        
        const data = await response.json();
        
        if (data.status === 'ok') {
            renderUsersTable(data.users);
        } else {
            showError('Ошибка загрузки пользователей: ' + data.error);
        }
    } catch (error) {
        showError('Ошибка загрузки пользователей: ' + error.message);
    }
}

// Отрисовка таблицы пользователей
function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';
    
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #b9bbbe;">Нет пользователей</td></tr>';
        return;
    }
    
    users.forEach(user => {
        const row = document.createElement('tr');
        
        const protocol = window.location.protocol;
        const host = window.location.host;
        const loginLink = `${protocol}//${host}/?user=${user.uuid}`;
        
        row.innerHTML = `
            <td>${escapeHtml(user.username)}</td>
            <td><code>${escapeHtml(user.uuid)}</code></td>
            <td>${user.is_admin ? '<span class="admin-badge">Администратор</span>' : 'Пользователь'}</td>
            <td><a href="${loginLink}" class="login-link" target="_blank">Войти</a></td>
            <td><button class="delete-btn" data-uuid="${escapeHtml(user.uuid)}" data-username="${escapeHtml(user.username)}" ${user.uuid === currentAdminUUID ? 'disabled' : ''}>Удалить</button></td>
        `;
        
        tbody.appendChild(row);
    });
    
    document.getElementById('usersTableLoading').style.display = 'none';
    document.getElementById('usersTable').style.display = 'table';

    // Добавляем обработчики для кнопок удаления
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', handleDeleteUser);
    });
}

// Создание нового пользователя
async function createUser(username, uuid, isAdmin) {
    try {
        const response = await fetch(`/admin/api/users?user=${currentAdminUUID}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: username,
                uuid: uuid,
                is_admin: isAdmin
            })
        });
        
        if (response.status === 403) {
            return { status: 'error', error: 'Доступ запрещен: требуются права администратора' };
        }
        
        if (response.status === 401) {
            return { status: 'error', error: 'Доступ запрещен: неверный пользователь' };
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: 'Ошибка сети: ' + error.message };
    }
}

// Показать сообщение об успехе
function showSuccess(message) {
    const messageDiv = document.getElementById('formMessage');
    messageDiv.innerHTML = `<div class="success-message">${escapeHtml(message)}</div>`;
    messageDiv.style.display = 'block';
    
    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 5000);
}

// Показать сообщение об ошибке
function showError(message) {
    const messageDiv = document.getElementById('formMessage');
    messageDiv.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
    messageDiv.style.display = 'block';
    
    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 5000);
}

// Экранирование HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Удаление пользователя
async function deleteUser(uuid) {
    try {
        const response = await fetch(`/admin/api/users?user=${currentAdminUUID}&uuid=${uuid}`, {
            method: 'DELETE'
        });

        if (response.status === 403) {
            return { status: 'error', error: 'Доступ запрещен: требуются права администратора' };
        }

        if (response.status === 401) {
            return { status: 'error', error: 'Доступ запрещен: неверный пользователь' };
        }

        if (response.status === 400) {
            return { status: 'error', error: 'Нельзя удалить самого себя' };
        }

        const data = await response.json();
        return data;
    } catch (error) {
        return { status: 'error', error: 'Ошибка сети: ' + error.message };
    }
}

// Обработчик удаления пользователя
async function handleDeleteUser(e) {
    const btn = e.target;
    const uuid = btn.getAttribute('data-uuid');
    const username = btn.getAttribute('data-username');

    // Подтверждение удаления
    const confirmed = confirm(`Вы уверены, что хотите удалить пользователя "${username}"?`);
    
    if (!confirmed) {
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Удаление...';

    const result = await deleteUser(uuid);

    if (result.status === 'ok') {
        showSuccess(`Пользователь "${username}" успешно удален`);
        // Обновляем таблицу пользователей
        await loadUsers();
    } else {
        showError(result.error || 'Неизвестная ошибка');
        btn.disabled = false;
        btn.textContent = 'Удалить';
    }
}

// Инициализация страницы
async function init() {
    // Проверяем права доступа
    const hasAccess = await checkAdminAccess();
    
    if (!hasAccess) {
        // Если нет доступа, показываем 404
        document.body.innerHTML = '<div style="text-align: center; padding: 100px; font-family: sans-serif;"><h1>404 Not Found</h1><p>Страница не найдена</p></div>';
        return;
    }
    
    // Генерируем UUID по умолчанию
    document.getElementById('uuid').value = generateUUID();
    
    // Обработчик отправки формы
    document.getElementById('createUserForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const uuid = document.getElementById('uuid').value.trim();
        const isAdmin = document.getElementById('is_admin').checked;
        
        if (!username) {
            showError('Введите имя пользователя');
            return;
        }
        
        if (!uuid) {
            showError('UUID не может быть пустым');
            return;
        }
        
        const btn = document.getElementById('createUserBtn');
        btn.disabled = true;
        btn.textContent = 'Создание...';
        
        const result = await createUser(username, uuid, isAdmin);
        
        if (result.status === 'ok') {
            showSuccess(`${username} успешно создан. Вход по ссылке: ${window.location.protocol}//${window.location.host}/?user=${uuid}`);
            
            // Очищаем форму и генерируем новый UUID
            document.getElementById('username').value = '';
            document.getElementById('uuid').value = generateUUID();
            document.getElementById('is_admin').checked = false;
            
            // Обновляем таблицу пользователей
            await loadUsers();
        } else {
            showError(result.error || 'Неизвестная ошибка');
        }
        
        btn.disabled = false;
        btn.textContent = 'Создать пользователя';
    });
    
    // Загружаем список пользователей
    await loadUsers();
}

// Запускаем инициализацию при загрузке страницы
window.addEventListener('DOMContentLoaded', init);