let volumeAnalyzers = {};
let speakingStates = {};
let volumeInterval = null;
let isDeafened = false;
let connectedVoiceUsers = {}; // Хранит информацию для отображения списка участников ГС на странице

// Управление заглушением звука
function switchMuteAll() {
    isDeafened = !isDeafened;
    
    if (isDeafened) {
        // Заглушаем звук и микрофон
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });
        }
        
        // Отключаем звук у всех gainNode воспроизведения участников
        Object.values(peerGainNodes).forEach(gainData => {
            gainData.gainNode.gain.setValueAtTime(0, gainData.audioContext.currentTime);
        });
        console.log('🔇 Звук заглушен');
        
        // Если был включен микрофон, меняем его состояние
        wasMicMuted = isMicMuted;
        if (!isMicMuted) {
            isMicMuted = true;
        }
    } else {
        // Включаем микрофон при снятии заглушки
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !wasMicMuted;
            });
        }

        // Возвращаем исходный звук у всех gainNode воспроизведения участников
        Object.entries(peerGainNodes).forEach(([userUUID, gainData]) => {
            const savedVolume = peerVolumes[userUUID] || 100;
            gainData.gainNode.gain.setValueAtTime(savedVolume / 100, gainData.audioContext.currentTime);
        });

        // Сбрасываем состояние микрофона
        isMicMuted = wasMicMuted;
        
        console.log('🔊 Звук включен');
    }
    
    // Отправляем статус на сервер
    sendStatusUpdate();
};


// Присоединение к комнате
async function joinRoom(roomName, channelElement) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Нет подключения к серверу');
        return;
    }

    // Убеждаемся, что данные пользователя загружены
    if (!currentUsername || !currentUserUUID) {
        console.log('⚠ Данные пользователя не загружены, загружаем...');
        const userLoaded = await loadCurrentUser();
        if (!userLoaded) {
            alert('Ошибка: не удалось загрузить данные пользователя');
            return;
        }
    }

    // Если микрофон еще не доступен, запрашиваем его
    if (!localStream) {
        const hasStream = await getLocalStreamWithSelectedMicrophone();
        if (!hasStream) {
            alert('Не удалось получить доступ к микрофону');
            return;
        }
    } else {
        // Если микрофон уже доступен (из настроек), просто обновляем индикаторы
        console.log('✓ Микрофон уже настроен, используем существующий поток');
    }

    // Отправляем запрос на присоединение
    sendWsMessage({
        type: 'join',
        room: roomName
    });

    console.log(`Запрос на присоединение к каналу "${roomName}"...`);

    // Обновляем активный канал
    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
    });

    if (channelElement) {
        channelElement.classList.add('active');
    }
}

// Обработка подтверждения присоединения
function handleJoined(data) {
    currentRoom = data.room;
    console.log(`✓ Присоединились к комнате "${currentRoom}"`);
    // Играем звук присоединения
    const audio = new Audio('static/sound/join-fx.mp3');
    audio.play();
    // Показываем панель управления голосовым каналом
    showVoiceControlPanel();
    // Обновляем состояние кнопок на панели
    updateVoicePanelButtons();
}

// Обработка списка участников
async function handlePeers(peers) {
    // Сохраняем информацию об участниках
    peers.forEach(peer => {
        connectedPeers[peer.user_uuid] = peer;
    });
    
    updateParticipantsList();
    
    if (peers.length === 0) {
        return;
    }
    
    // Устанавливаем соединения с существующими участниками
    for (let peer of peers) {
        await createVoicePeerConnection(peer.user_uuid, false);
    }
}


// Покидание текущей комнаты
async function leaveCurrentRoom() {
    if (!currentRoom || !currentUsername) {
        return;
    }
    
    sendWsMessage({
        type: 'leave'
    });
    
    // Очищаем состояние комнаты
    currentRoom = '';
    currentUsername = '';
    
    // Сбрасываем активный канал
    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Закрываем все peer соединения
    Object.keys(voicePeerConnections).forEach(id => {
        voicePeerConnections[id].close();
    });
    voicePeerConnections = {};
    
    // Очищаем все GainNodes
    Object.values(peerGainNodes).forEach(gainData => {
        if (gainData.source) gainData.source.disconnect();
        if (gainData.audioContext) gainData.audioContext.close();
    });
    peerGainNodes = {};

    Object.keys(volumeAnalyzers).forEach(user_uuid => {
        if (user_uuid !== currentUserUUID) {
            delete volumeAnalyzers[user_uuid]
        }
    });
    
    // Удаляем все аудио элементы
    Object.values(peerAudioElements).forEach(audio => audio.remove());
    peerAudioElements = {};
    
    // Останавливаем демонстрацию экрана, если активна
    if (isScreenSharing) {
        stopScreenShare();
    }
    
    // Очищаем демонстрации от других участников
    Object.keys(peerScreenShares).forEach(peerUuid => {
        removeScreenShare(peerUuid);
    });
    peerScreenShares = {};
    
    // Закрываем все соединения для демонстрации
    Object.keys(screenPeerConnections).forEach(id => {
        if (screenPeerConnections[id]) {
            screenPeerConnections[id].close();
        }
    });
    screenPeerConnections = {};
    
    const audio = new Audio('static/sound/disconnect-fx.mp3');
    audio.play();
    
    // Очищаем список участников
    connectedPeers = {};
    updateParticipantsList();
    
    // Скрываем панель управления голосовым каналом
    hideVoiceControlPanel();
}


// Обработчик покидания канала
function handleLeaveChannel() {
    if (!currentRoom) {
        return;
    }
    
    leaveCurrentRoom();
}



// Обработка клика по каналу
async function handleChannelClick(roomName, channelElement) {
    if (currentRoom === roomName) {
        return;
    } else if (currentRoom) {
        await leaveCurrentRoom();
    }
    // Присоединяемся к новому каналу
    await joinRoom(roomName, channelElement);
}


function createVolumeAnalyser(userUuid, stream) {
    if (!window.audioCtx) {
        window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const source = window.audioCtx.createMediaStreamSource(stream);
    const analyser = window.audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.5; // Сглаживание колебаний
    source.connect(analyser)
    volumeAnalyzers[userUuid] = analyser

    startVolumeMonitoring();

    return analyser
}

function startVolumeMonitoring(updateInterval = 150, threshold = 10) {
    if (volumeInterval) return;

    volumeInterval = setInterval(() => {
        const uuids = Object.keys(volumeAnalyzers);
        
        if (uuids.length === 0) {
            stopVolumeMonitoring();
            return;
        }

        uuids.forEach(uuid => {
            const analyser = volumeAnalyzers[uuid];
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            analyser.getByteFrequencyData(dataArray);

            // Считаем среднюю громкость
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const average = sum / bufferLength;

            // Определяем, говорит ли человек
            const isSpeaking = average > threshold;

            // Обновляем UI только если состояние изменилось
            if (speakingStates[uuid] !== isSpeaking) {
                speakingStates[uuid] = isSpeaking;
                updatePeerVolumeIndicator(uuid, isSpeaking);
            }
        });
    }, updateInterval);
}

function stopVolumeMonitoring() {
    clearInterval(volumeInterval);
    volumeInterval = null;
}