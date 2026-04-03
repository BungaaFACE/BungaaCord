// app.js - WebSocket клиент для Discord-like голосового чата
let currentRoom = '';
let currentUsername = '';
let params = getQueryParams();
let currentUserUUID = params.user;
const isElectronEnvironment = !!(window.electronAPI);

let connectedPeers = {}; // Хранит информацию об участниках { user_uuidv4: username }


// Отправка обновления статуса на сервер
function sendStatusUpdate() {
    sendWsMessage({
        type: 'user_status_update',
        room: currentRoom,
        is_mic_muted: isMicMuted,
        is_deafened: isDeafened,
        is_streaming: isScreenSharing
    });
}

// Инициализация при загрузке страницы
window.addEventListener('DOMContentLoaded', async () => {
    if (isElectronEnvironment) {
        window.BACKEND_URL = window.electronAPI.getBackendUrl();
    }
    
    // Загружаем информацию о текущем пользователе
    const userLoaded = await loadCurrentUser();
    
    if (!userLoaded) {
        // Если пользователь не загружен, блокируем все элементы
        joinBtn.disabled = true;
        return;
    }
    
    // Загружаем список комнат
    await loadVoiceRooms();
    
    connectWebSocket();
    
    // Загружаем сохраненные настройки
    loadSettings();
    
    // Инициализируем модальное окно настроек
    initializeSettingsModal();
    
    // Инициализируем панель управления голосовым каналом
    initializeVoiceControlPanel();
    
    
    if (isElectronEnvironment) {
        loadScript('../static/js/rtc/screen/electron-screen-stream.js');
    } else {
        loadScript('../static/js/rtc/screen/web-screen-stream.js');
    };
});

// Обработка закрытия страницы
window.addEventListener('beforeunload', () => {
    if (currentRoom && currentUsername) {
        // Отправляем сообщение о выходе (может не успеть отправиться)
        sendWsMessage({
            type: 'leave'
        });
    }
    
    // Закрываем WebSocket соединение
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Пользователь покинул страницу');
    }
});

function loadScript (src) {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => {
        console.log(`${src} loaded successfully!`);
        // You can call functions from the loaded script here
    };
    script.onerror = () => {
        console.error(`Error loading ${src}`);
    };
    document.head.appendChild(script);
}
