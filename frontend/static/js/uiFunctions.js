// Загрузка списка комнат и создание каналов
async function loadVoiceRooms() {
    try {
        const response = await fetch(`${window.BACKEND_URL}/api/rooms?user=${window.currentUserUUID}`);
        const data = await response.json();
        
        if (data.status === 'ok') {
            const channelsList = document.getElementById('channelsList');
            channelsList.innerHTML = '';
            
            if (data.rooms.length === 0) {
                const noChannels = document.createElement('div');
                noChannels.className = 'channel-item';
                noChannels.innerHTML = '<span class="channel-name">Нет доступных каналов</span>';
                channelsList.appendChild(noChannels);
                return;
            }
            
            data.rooms.forEach(room => {
                if (!connectedVoiceUsers[room]) {
                    connectedVoiceUsers[room] = {};
                }

                const channelItem = document.createElement('div');
                channelItem.className = 'channel-item';
                channelItem.setAttribute('data-room-name', room.name);
                
                channelItem.innerHTML = `
                    <span class="channel-icon">🔊</span>
                    <span class="channel-name">${room.name}</span>
                `;
                
                // Обработчик клика по каналу
                channelItem.addEventListener('click', () => {
                    handleChannelClick(room.name, channelItem);
                });
                
                channelsList.appendChild(channelItem);

                const channelUsers = document.createElement('div');
                channelUsers.className = 'voice-members-section';
                channelUsers.id = `voiceMembersSection${room.name}`;
                channelUsers.style.display = 'none';
                channelUsers.innerHTML = `<div class="members-list" id="membersList${room.name}"></div>`
                channelsList.appendChild(channelUsers);

            });
            
            console.log(`✓ Загружено ${data.rooms.length} каналов`);
        } else {
            console.log(`❌ Ошибка загрузки каналов: ${data.error}`);
            const channelsList = document.getElementById('channelsList');
            channelsList.innerHTML = '<div class="channel-item"><span class="channel-name">Ошибка загрузки</span></div>';
        }
    } catch (error) {
        console.log(`❌ Ошибка загрузки каналов: ${error.message}`);
        const channelsList = document.getElementById('channelsList');
        channelsList.innerHTML = '<div class="channel-item"><span class="channel-name">Ошибка загрузки</span></div>';
    }
}

// Обновление индикатора громкости участника
function updatePeerVolumeIndicator(peerUuid, isSpeaking) {
    const memberElement = document.querySelector(`[data-peer-uuid="${peerUuid}"]`);
    if (!memberElement) return;
    
    const statusIndicator = memberElement.querySelector('.status-indicator');
    if (!statusIndicator) return;
    
    if (isSpeaking) {
        statusIndicator.classList.add('speaking');
        memberElement.classList.add('speaking');
    } else {
        statusIndicator.classList.remove('speaking');
        memberElement.classList.remove('speaking');
    }
}


// Показ контекстного меню для участника
function showMemberContextMenu(event, user_uuid, username) {
    // Удаляем старое меню, если есть
    const oldMenu = document.getElementById('memberContextMenu');
    if (oldMenu) {
        oldMenu.remove();
    }
    
    // Создаем контекстное меню
    const menu = document.createElement('div');
    menu.id = 'memberContextMenu';
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.style.zIndex = '10000';
    menu.style.background = '#36393f';
    menu.style.border = '1px solid #4f545c';
    menu.style.borderRadius = '8px';
    menu.style.padding = '8px';
    menu.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.5)';
    menu.style.minWidth = '200px';
    
    // Заголовок с именем пользователя
    const header = document.createElement('div');
    header.style.padding = '8px 12px';
    header.style.color = '#ffffff';
    header.style.fontWeight = '600';
    header.style.fontSize = '14px';
    header.style.borderBottom = '1px solid #4f545c';
    header.style.marginBottom = '8px';
    header.textContent = username;
    menu.appendChild(header);
    
    // Ползунок громкости
    const volumeContainer = document.createElement('div');
    volumeContainer.style.padding = '8px 12px';
    volumeContainer.style.display = 'flex';
    volumeContainer.style.alignItems = 'center';
    volumeContainer.style.gap = '10px';
    
    const volumeLabel = document.createElement('span');
    volumeLabel.textContent = '🔊 Громкость';
    volumeLabel.style.color = '#b9bbbe';
    volumeLabel.style.fontSize = '14px';
    
    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.min = '0';
    volumeSlider.max = '250';
    volumeSlider.value = '100';
    volumeSlider.step = '1';
    volumeSlider.style.flex = '1';
    volumeSlider.style.height = '6px';
    volumeSlider.style.background = '#4f545c';
    volumeSlider.style.borderRadius = '3px';
    volumeSlider.style.outline = 'none';
    volumeSlider.style.padding = '0px';
    
    const volumeValue = document.createElement('span');
    volumeValue.textContent = '100%';
    volumeValue.style.color = '#ffffff';
    volumeValue.style.fontSize = '12px';
    volumeValue.style.minWidth = '40px';
    volumeValue.style.textAlign = 'right';
    
    // Устанавливаем начальное значение громкости
    const currentVolume = peerVolumes[user_uuid] || 100;
    volumeSlider.value = currentVolume;
    volumeValue.textContent = `${currentVolume}%`;
    
    // Обработчик изменения громкости
    volumeSlider.addEventListener('input', (e) => {
        const volume = parseInt(e.target.value);
        volumeValue.textContent = `${volume}%`;
        setPeerVolume(user_uuid, volume);
    });
    
    volumeContainer.appendChild(volumeLabel);
    volumeContainer.appendChild(volumeSlider);
    volumeContainer.appendChild(volumeValue);
    menu.appendChild(volumeContainer);
    
    // Добавляем меню на страницу
    document.body.appendChild(menu);
    
    // Закрываем меню при клике вне его
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 100);
}


function getCrossedEmojiEl(emoji) {
    const crossedEl = document.createElement('div');
    crossedEl.classList.add('crossed-element');
    const emojiEl = document.createElement('div');
    emojiEl.textContent = emoji;
    crossedEl.appendChild(emojiEl);

    // Зачеркивание
    const crossedOverlay = document.createElement('div');
    crossedOverlay.classList.add('cross-overlay');

    const crossLineEl = document.createElement('div');
    crossLineEl.classList.add('cross-line');

    crossedOverlay.appendChild(crossLineEl);
    crossedEl.appendChild(crossedOverlay);

    return crossedEl
}


// Создание элемента участника для боковой панели
function createMemberElement(data) {
    const member = document.createElement('div');
    member.className = 'member-item';
    member.setAttribute('data-peer-uuid', data.user_uuid);
    
    // Аватар
    const avatar = document.createElement('div');
    avatar.className = 'member-avatar';
    
    // Проверяем наличие аватарки пользователя
    const avatarUrl = `${window.BACKEND_URL}/static/avatars/${data.user_uuid}_avatar.jpg`;
    fetch(avatarUrl, { method: 'HEAD' }) // Используем HEAD, чтобы не качать весь файл, а только проверить статус
        .then(res => {
            if (res.ok) {
                // Картинка существует
                avatar.style.backgroundImage = `url(${avatarUrl})`;
                avatar.style.backgroundSize = 'cover';
                avatar.style.backgroundPosition = 'center';
                avatar.textContent = '';
            } else {
                // Картинки нет — ставим заглушку
                avatar.style.background = 'hsl(248, 53%, 58%)';
                avatar.textContent = (data.username || 'U').charAt(0).toUpperCase();
            }
        })
    
    // Информация о пользователе
    const memberInfo = document.createElement('div');
    memberInfo.className = 'member-info';
    
    const usernameContainer = document.createElement('div');
    usernameContainer.className = 'member-username-container';
    
    const username = document.createElement('div');
    username.className = 'member-username';
    username.textContent = data.username;
    
    // Статус "В ЭФИРЕ" (скрыт по умолчанию)
    const liveStatus = document.createElement('span');
    liveStatus.className = 'live-status';
    liveStatus.textContent = 'В ЭФИРЕ';
    liveStatus.style.display = 'none';
    liveStatus.id = `live-status-${data.user_uuid}`;
    liveStatus.addEventListener("click", function (event) {
        sendDemonstrationRequest(data.user_uuid);
    });
    
    usernameContainer.appendChild(username);
    usernameContainer.appendChild(liveStatus);
    
    const status = document.createElement('div');
    status.className = 'member-status';
    
    const statusIndicator = document.createElement('div');
    statusIndicator.className = 'status-indicator';
    
    status.appendChild(statusIndicator);
    
    memberInfo.appendChild(usernameContainer);
    memberInfo.appendChild(status);
    
    // Иконки статусов
    const icons = document.createElement('div');
    icons.className = 'member-icons';
    
    // Индикатор микрофона
    const micIcon = getCrossedEmojiEl('🎤');
    micIcon.classList.add('status-icon');
    micIcon.style.display = 'none';
    micIcon.setAttribute('data-icon-type', 'mic');
    micIcon.setAttribute('data-peer-uuid', data.user_uuid);
    
    // Индикатор звука
    const soundIcon = getCrossedEmojiEl('🎧');
    soundIcon.classList.add('status-icon');
    soundIcon.style.display = 'none';
    soundIcon.setAttribute('data-icon-type', 'sound');
    soundIcon.setAttribute('data-peer-uuid', data.user_uuid);
    
    icons.appendChild(micIcon);
    icons.appendChild(soundIcon);
    
    member.appendChild(avatar);
    member.appendChild(memberInfo);
    member.appendChild(icons);
    
    // Добавляем обработчик контекстного меню (правый клик)
    if (data.user_uuid !== currentUserUUID) {
        member.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showMemberContextMenu(e, data.user_uuid, data.username);
        });
    }
    
    return member;
}


// Обновление индикаторов при обновлении списка участников
function updateParticipantsList() {
    Object.keys(connectedVoiceUsers).forEach(room_name => {
        const membersList = document.getElementById(`membersList${room_name}`);
        const membersSection = document.getElementById(`voiceMembersSection${room_name}`);
        if (!membersList) return;
        // Очищаем список
        membersList.innerHTML = '';

        if (Object.keys(connectedVoiceUsers[room_name]).length !== 0) {
            membersSection.style.display = 'block';
        } else {
            membersSection.style.display = 'none';
        }

        Object.keys(connectedVoiceUsers[room_name]).forEach(username => { 
            const user_uuid = connectedVoiceUsers[room_name][username]['user_uuid'];
            const is_mic_muted = connectedVoiceUsers[room_name][username]['is_mic_muted'];
            const is_deafened = connectedVoiceUsers[room_name][username]['is_deafened'];
            const is_streaming = connectedVoiceUsers[room_name][username]['is_streaming'];

            const memberElement = createMemberElement({
                username: username,
                user_uuid: user_uuid,
                isCurrentUser: false
            });
            membersList.appendChild(memberElement);
            updateUserMicIndicator(user_uuid, is_mic_muted);
            updateUserSoundIndicator(user_uuid, is_deafened);
            updateUserLiveStatus(user_uuid, is_streaming);
        });
    })
}


// Функции для управления панелью голосового канала
function showVoiceControlPanel() {
    if (voiceControlPanel) {
        voiceControlPanel.style.display = 'block';
        console.log('✓ Панель управления голосовым каналом показана');
    }
}

function hideVoiceControlPanel() {
    if (voiceControlPanel) {
        voiceControlPanel.style.display = 'none';
        console.log('✓ Панель управления голосовым каналом скрыта');
    }
}

// Обработчик изменения ползунка громкости
document.addEventListener('input', (e) => {
    if (e.target.classList.contains('volume-slider')) {
        const peerUuid = e.target.getAttribute('data-peer-uuid');
        const volume = parseInt(e.target.value);
        setPeerVolume(peerUuid, volume);
        
        // Update progress bar
        const progress = (volume / 250) * 100;
        e.target.style.setProperty('--progress', `${progress}%`);
    }
});

// Элементы панели управления голосовым каналом
const voiceControlPanel = document.getElementById('voiceControlPanel');
const voiceScreenBtn = document.getElementById('voiceScreenBtn');
const voiceMicBtn = document.getElementById('voiceMicBtn');
const voiceDeafenBtn = document.getElementById('voiceDeafenBtn');
const voiceLeaveBtn = document.getElementById('voiceLeaveBtn');
// Инициализация обработчиков для панели управления голосовым каналом
function initializeVoiceControlPanel() {
    if (!voiceScreenBtn || !voiceMicBtn || !voiceDeafenBtn || !voiceLeaveBtn) {
        return;
    }
    
    // Обработчик кнопки демонстрации экрана
    voiceScreenBtn.addEventListener('click', () => {
        if (isScreenSharing) {
            stopScreenShare();
        } else {
            startScreenShare();
        }
        updateVoicePanelButtons();
    });
    
    // Обработчик кнопки микрофона
    voiceMicBtn.addEventListener('click', () => {
        switchMuteButton();
    });
    
    // Обработчик кнопки заглушения звука
    voiceDeafenBtn.addEventListener('click', () => {
        switchMuteAllButton();
    });
    
    // Обработчик кнопки выхода из канала
    voiceLeaveBtn.addEventListener('click', () => {
        handleLeaveChannel();
    });
    
    console.log('✓ Панель управления голосовым каналом инициализирована');
}

function switchMuteButton() {
    switchMute();
    updateVoicePanelButtons();
    // Обновляем индикатор микрофона у текущего пользователя в канале
    updateUserMicIndicator();
    if (isMicMuted) {
        const audio = new Audio('../static/sound/mute-fx.mp3');
        audio.play();
    } else {
        const audio = new Audio('../static/sound/unmute-fx.mp3');
        audio.play();
    }
}

function switchMuteAllButton() {
    switchMuteAll();
    updateVoicePanelButtons();
    // Обновляем индикаторы текущего пользователя в канале
    updateUserMicIndicator(currentUserUUID, isMicMuted);
    updateUserSoundIndicator(currentUserUUID, isDeafened);
    if (isDeafened) {
        const audio = new Audio('../static/sound/deafen-fx.mp3');
        audio.play();
    } else {
        const audio = new Audio('../static/sound/undeafen-fx.mp3');
        audio.play();
    }
}

// Обновление состояния кнопок на панели управления
function updateVoicePanelButtons() {
    if (!voiceScreenBtn || !voiceMicBtn || !voiceDeafenBtn) {
        return;
    }
    
    // Обновляем состояние кнопки демонстрации экрана
    if (isScreenSharing) {
        voiceScreenBtn.classList.add('active');
        voiceScreenBtn.title = 'Остановить демонстрацию экрана';
        voiceScreenBtn.querySelector('.btn-icon').textContent = '🖥️';
    } else {
        voiceScreenBtn.classList.remove('active');
        voiceScreenBtn.title = 'Начать демонстрацию экрана';
        voiceScreenBtn.querySelector('.btn-icon').textContent = '🖥️';
    }
    
    // Обновляем состояние кнопки микрофона
    if (isMicMuted) {
        voiceMicBtn.classList.add('active');
    } else {
        voiceMicBtn.classList.remove('active');
    }
    
    // Обновляем состояние кнопки заглушения звука
    if (isDeafened) {
        voiceDeafenBtn.classList.add('active');
    } else {
        voiceDeafenBtn.classList.remove('active');
    }
}


// Показ/скрытие статуса "В ЭФИРЕ" для участника
function updateUserLiveStatus(peerUuid, show) {
    const liveStatus = document.getElementById(`live-status-${peerUuid}`);
    if (liveStatus) {
        if (show) {
            liveStatus.style.display = 'inline-flex';
        } else {
            liveStatus.style.display = 'none';
        }
    }
}

// Обновление индикатора микрофона текущего пользователя
function updateUserMicIndicator(UserUuid, isMicMuted) {
    const currentUserElement = document.querySelector(`[data-peer-uuid="${UserUuid}"]`);
    if (!currentUserElement) return;
    
    const micIcon = currentUserElement.querySelector('.status-icon[data-icon-type="mic"]');
    if (!micIcon) return;
    
    if (isMicMuted) {
        micIcon.style.display = "inline-block";
    } else {
        micIcon.style.display = "none";
    }
}

// Обновление индикатора звука текущего пользователя
function updateUserSoundIndicator(UserUuid, isDeafened) {
    const currentUserElement = document.querySelector(`[data-peer-uuid="${UserUuid}"]`);
    if (!currentUserElement) return;
    
    const soundIcon = currentUserElement.querySelector('.status-icon[data-icon-type="sound"]');
    if (!soundIcon) return;
    
    if (isDeafened) {
        soundIcon.style.display = "inline-block";
    } else {
        soundIcon.style.display = "none";
    }
}

// Обработка обновления статуса участника
function handleUserStatusUpdate(data) {
    const room = data.room;
    const userUuid = data.user_uuid;
    const username = data.username;
    const isMicMuted = data.is_mic_muted;
    const isDeafened = data.is_deafened;
    const isStreaming = data.is_streaming;

    if (room.startsWith('!')) {
        delete connectedVoiceUsers[room.slice(1)][username];
        console.log(`deleted ${username} from ${room.slice(1)}`)
        updateParticipantsList();
        return
    }

    if (!connectedVoiceUsers[room]) {
        connectedVoiceUsers[room] = {};
    }
    connectedVoiceUsers[room][username] = {
        user_uuid: userUuid,
        is_mic_muted: isMicMuted,
        is_deafened: isDeafened,
        is_streaming: isStreaming
    }
    // Обновляем ui голосовых каналов
    updateParticipantsList();
}


// Функция для показа уведомлений пользователю
function showNotification(message, type = 'info') {
    // Создаем элемент уведомления
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        opacity: 0;
        transform: translateY(-20px);
        transition: all 0.3s ease;
        max-width: 300px;
        word-wrap: break-word;
    `;
    
    // Устанавливаем цвет в зависимости от типа
    switch (type) {
        case 'success':
            notification.style.background = '#43b581';
            break;
        case 'error':
            notification.style.background = '#ed4245';
            break;
        case 'warning':
            notification.style.background = '#faa61a';
            break;
        default:
            notification.style.background = '#4f545c';
    }
    
    // Добавляем уведомление на страницу
    document.body.appendChild(notification);
    
    // Анимация появления
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';
    }, 100);
    
    // Автоматическое скрытие через 3 секунды
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}
