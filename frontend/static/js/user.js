
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

// Загрузка информации о пользователе из БД
async function loadCurrentUser() {
    const params = getQueryParams();
    const userUUID = params.user;
    
    if (!userUUID) {
        console.log('❌ Ошибка: отсутствует параметр user в URL');
        alert('Ошибка: отсутствует параметр user в URL. Доступ запрещен.');
        return false;
    }
    
    try {
        const response = await fetch(`${backendAdress}/api/user?user=${userUUID}`);
        const data = await response.json();
        
        if (data.status === 'ok') {
            currentUserUUID = userUUID;
            currentUsername = data.user.username;
            console.log(`✓ Пользователь: ${currentUsername}`);
            
            // Обновляем профиль в боковой панели
            const sidebarUsername = document.getElementById('sidebarUsername');
            const userAvatar = document.getElementById('userAvatar');
            if (sidebarUsername) {
                sidebarUsername.textContent = currentUsername;
            }

            const img = new Image();
            const avatarUrl = `${backendAdress}/static/avatars/${currentUserUUID}_avatar.jpg`
            img.src = avatarUrl;
            img.onload = () => {
                // Картинка есть, ставим её
                userAvatar.style.backgroundImage = `url(${avatarUrl})`;
                userAvatar.style.backgroundSize = 'cover';
                userAvatar.style.backgroundPosition = 'center';
                userAvatar.textContent = '';
            };

            img.onerror = () => {
                // Ошибка — ставим только цвет и букву
                userAvatar.style.background = 'hsl(248, 53%, 58%)';
                userAvatar.textContent = (currentUsername || 'U').charAt(0).toUpperCase();
            };
            
            // Обработка клика на аватарку для загрузки новой
            const userAvatarContainer = document.getElementById('userAvatarContainer');
            if (userAvatarContainer) {
                userAvatarContainer.addEventListener('click', () => {
                    // Создаем скрытый input для выбора файла
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.accept = 'image/*';
                    fileInput.style.display = 'none';
                    
                    fileInput.addEventListener('change', async (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            await uploadUserAvatar(file);
                        }
                    });
                    
                    document.body.appendChild(fileInput);
                    fileInput.click();
                    document.body.removeChild(fileInput);
                });
            }
            
            // Сохраняем данные пользователя в глобальной области для chatManager
            window.currentUserUUID = currentUserUUID;
            window.currentUsername = currentUsername;
            
            // Если chatManager уже создан, обновляем его данные
            if (window.chatManager) {
                window.chatManager.currentUserUUID = currentUserUUID;
                window.chatManager.currentUsername = currentUsername;
            }
            
            return true;
        } else {
            console.log(`❌ Ошибка: ${data.error}`);
            alert(`Ошибка: ${data.error}. Доступ запрещен.`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Ошибка загрузки пользователя: ${error.message}`);
        alert('Ошибка загрузки пользователя. Доступ запрещен.');
        return false;
    }
}

// Функции для работы с localStorage
function saveSettings() {
    try {
        const settings = {
            peerVolumes: peerVolumes,
            savedMicrophone: selectedMicrophoneId,
            enableRNNoise: enableRNNoise
        };
        localStorage.setItem('bungaaCordSettings', JSON.stringify(settings));
        console.log('✓ Настройки сохранены в localStorage');
    } catch (error) {
        console.error('❌ Ошибка сохранения настроек:', error);
    }
}

function loadSettings() {
    try {
        const savedSettings = localStorage.getItem('bungaaCordSettings');
        if (!savedSettings) {
            console.log('✓ Сохраненных настроек не найдено, используются значения по умолчанию');
            return;
        }
        
        const settings = JSON.parse(savedSettings);
        
        // Загружаем громкость участников
        if (settings.peerVolumes) {
            peerVolumes = { ...settings.peerVolumes };
        }
        
        // Загружаем выбранный микрофон
        if (settings.enableRNNoise) {
            selectedMicrophoneId = settings.savedMicrophone;
            enableRNNoise = settings.enableRNNoise;
        } else {
            enableRNNoise = false;
        }

        console.log('✓ Настройки загружены из localStorage');
    } catch (error) {
        console.error('❌ Ошибка загрузки настроек:', error);
    }
}

// Загрузка аватарки пользователя на сервер
async function uploadUserAvatar(file) {
    try {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch(`${backendAdress}/api/upload_avatar?user=${currentUserUUID}`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.status === 'ok') {
            // Обновляем аватарку в интерфейсе
            const userAvatar = document.getElementById('userAvatar');
            if (userAvatar) {
                userAvatar.style.backgroundImage = `url(${backendAdress}/${data.avatar.url})`;
                userAvatar.style.backgroundSize = 'cover';
                userAvatar.style.backgroundPosition = 'center';
                userAvatar.textContent = '';
            }
            
            console.log('Аватарка успешно загружена:', data.avatar.url);
        } else {
            console.error('Ошибка загрузки аватарки:', data.error);
            alert('Ошибка загрузки аватарки: ' + data.error);
        }
    } catch (error) {
        console.error('Ошибка загрузки аватарки:', error);
        alert('Ошибка загрузки аватарки: ' + error.message);
    }
}
