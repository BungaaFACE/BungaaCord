
// Обновление индикатора тишины в интерфейсе
function updateSilenceIndicator(isSilent, volume) {
    const indicator = document.getElementById('silenceIndicator');
    
    if (indicator) {
        indicator.textContent = isSilent ? '🔇 Тишина' : '🎤 Говорите';
        indicator.className = isSilent ? 'silent' : 'speaking';
    }
}


// Обновление индикатора громкости в настройках
function updateVolumeMeter(volumePercent) {
    if (!volumeBarEl || !volumeFillEl) return;
    
    // Обновляем полоску громкости
    volumeFillEl.style.width = `${volumePercent}%`;
    
    // Определяем цвет в зависимости от уровня громкости
    let color;
    if (isCurrentlySilent) {
        color = '#b9bbbe'; // Серый - тишина
    } else if (volumePercent < 20) {
        color = '#43b581'; // Зеленый - тихо
    } else if (volumePercent < 50) {
        color = '#faa61a'; // Оранжевый - нормально
    } else {
        color = '#ed4245'; // Красный - громко
    }
    volumeFillEl.style.background = color;
}

// Загрузка списка комнат и создание каналов
async function loadVoiceRooms() {
    try {
        const response = await fetch(`/api/rooms?user=${window.currentUserUUID}`);
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


// Активация кнопок настроек
function activateSettingsButtons() {
    // Включаем кнопки настроек, даже если мы не в канале
    if (toggleSilenceBtn) {
        toggleSilenceBtn.disabled = false;
        toggleSilenceBtn.textContent = isSilenceDetectionEnabled ?
            '🔇 Отключить детектор тишины' : '🎤 Включить детектор тишины';
    }
    if (toggleNoiseSuppressionBtn) {
        toggleNoiseSuppressionBtn.disabled = false;
        toggleNoiseSuppressionBtn.textContent = isNoiseSuppressionEnabled ?
            '🔇 Отключить шумодав' : '🎤 Включить шумодав';
    }
    if (noiseSuppressionModeEl) {
        noiseSuppressionModeEl.disabled = false;
    }
    if (noiseProfileBtn) {
        noiseProfileBtn.disabled = false;
    }
    if (silenceThresholdEl) {
        silenceThresholdEl.disabled = false;
    }
    
    console.log('✓ Кнопки настроек активированы');
}

// Инициализация модального окна настроек
function initializeSettingsModal() {
    const settingsIcon = document.getElementById('settingsIcon');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettings = document.getElementById('closeSettings');
    
    // Открытие модального окна при клике на иконку настроек
    if (settingsIcon) {
        settingsIcon.addEventListener('click', async function() {
            if (settingsModal) {
                settingsModal.style.display = 'block';
                document.body.style.overflow = 'hidden'; // Блокируем прокрутку фона
                
                // При открытии настроек запрашиваем доступ к микрофону, если еще не получили
                if (!localStream) {
                    await requestMicrophoneAccessForSettings();
                } else {
                    // Если микрофон уже доступен, обновляем индикаторы
                    updateSettingsIndicators();
                }
            }
        });
    }
    
    // Закрытие модального окна при клике на крестик
    if (closeSettings) {
        closeSettings.addEventListener('click', function() {
            if (settingsModal) {
                settingsModal.style.display = 'none';
                document.body.style.overflow = 'auto'; // Восстанавливаем прокрутку фона
            }
        });
    }
    
    // Закрытие модального окна при клике вне его области
    if (settingsModal) {
        settingsModal.addEventListener('click', function(event) {
            if (event.target === settingsModal) {
                settingsModal.style.display = 'none';
                document.body.style.overflow = 'auto'; // Восстанавливаем прокрутку фона
            }
        });
    }
    
    // Закрытие модального окна при нажатии клавиши Escape
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && settingsModal && settingsModal.style.display === 'block') {
            settingsModal.style.display = 'none';
            document.body.style.overflow = 'auto'; // Восстанавливаем прокрутку фона
        }
    });
}

// Обновление индикаторов в окне настроек
function updateSettingsIndicators() {
    if (silenceDetector) {
        // Запускаем обновление индикатора громкости
        if (!volumeMeterInterval) {
            volumeMeterInterval = setInterval(() => {
                if (silenceDetector) {
                    silenceDetector.detect();
                }
            }, 100);
        }
    }
    
    console.log('✓ Индикаторы настроек обновлены');
}

// Обновление индикатора громкости участника
function updatePeerVolumeIndicator(peerUuid, volume) {
    const memberElement = document.querySelector(`[data-peer-uuid="${peerUuid}"]`);
    if (!memberElement) return;
    
    const statusIndicator = memberElement.querySelector('.status-indicator');
    if (!statusIndicator) return;
    
    // Определяем, говорит ли участник (порог 5%)
    if (volume > 5) {
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
    const currentVolume = peerGainNodes[user_uuid] ?
        Math.round(peerGainNodes[user_uuid].gainNode.gain.value * 100) : 100;
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


// Создание элемента участника для боковой панели
function createMemberElement(data) {
    const member = document.createElement('div');
    member.className = 'member-item';
    member.setAttribute('data-peer-uuid', data.user_uuid);
    
    // Аватар
    const avatar = document.createElement('div');
    avatar.className = 'member-avatar';
    avatar.style.background = `hsl(248, 53%, 58%)`;
    avatar.textContent = data.username.charAt(0).toUpperCase();
    
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
    const micIcon = document.createElement('span');
    micIcon.className = 'status-icon';
    micIcon.innerHTML = '🎤';
    micIcon.setAttribute('data-icon-type', 'mic');
    micIcon.setAttribute('data-peer-uuid', data.user_uuid);
    
    // Индикатор звука
    const soundIcon = document.createElement('span');
    soundIcon.className = 'status-icon';
    soundIcon.innerHTML = '🔊';
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
}

function switchMuteAllButton() {
    switchMuteAll();
    updateVoicePanelButtons();
    // Обновляем индикаторы текущего пользователя в канале
    updateUserMicIndicator(currentUserUUID, isMicMuted);
    updateUserSoundIndicator(currentUserUUID, isDeafened);
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
        micIcon.classList.add('muted');
    } else {
        micIcon.classList.remove('muted');
    }
}

// Обновление индикатора звука текущего пользователя
function updateUserSoundIndicator(UserUuid, isDeafened) {
    const currentUserElement = document.querySelector(`[data-peer-uuid="${UserUuid}"]`);
    if (!currentUserElement) return;
    
    const soundIcon = currentUserElement.querySelector('.status-icon[data-icon-type="sound"]');
    if (!soundIcon) return;
    
    if (isDeafened) {
        soundIcon.classList.add('muted');
    } else {
        soundIcon.classList.remove('muted');
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

