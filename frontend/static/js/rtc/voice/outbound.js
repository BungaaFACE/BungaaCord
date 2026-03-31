let localStream = null;
let wasMicMuted = false; // сохраняем значение заглушки микрофона для восстановления состояния при снятии MuteAll
let isMicMuted = false;

// Модифицированная функция запроса доступа к микрофону с использованием выбранного устройства
async function getLocalStreamWithSelectedMicrophone() {
    try {
        console.log('🔊 Запрос доступа к микрофону...');
        
        // Получаем конфигурацию для микрофона
        const audioConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        };
        
        // Если выбран конкретный микрофон, добавляем deviceId
        if (selectedMicrophoneId) {
            audioConstraints.deviceId = { exact: selectedMicrophoneId };
            console.log(`🎤 Используется выбранный микрофон: ${selectedMicrophoneId}`);
        }
        
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false
        });

        createVolumeAnalyser(currentUserUUID, localStream)
        console.log('✓ Микрофон доступен');
        return true;

    } catch (err) {
        if (err.name === 'NotAllowedError') {
            console.log('❌ Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.');
        } else if (err.name === 'NotFoundError') {
            console.log('❌ Микрофон не найден');
        } else if (err.name === 'OverconstrainedError') {
            console.log('❌ Выбранный микрофон недоступен или не поддерживает требуемые функции');
            // Очищаем выбор и пробуем снова
            selectedMicrophoneId = '';
            saveSettings();
            microphoneSelect.value = '';
            console.log('🔄 Очистка выбора микрофона и повторная попытка...');
            return getLocalStreamWithSelectedMicrophone();
        } else {
            console.log(`❌ Ошибка доступа к микрофону: ${err.message}`);
        }
        console.error('Microphone access error:', err);
        return false;
    }
}


// Обновление аудиопотока при смене микрофона
async function updateMicrophoneStream() {
    try {
        console.log('🔄 Обновление аудиопотока при смене микрофона...');
        
        // Останавливаем текущий поток
        if (localStream) {
            localStream.getTracks().forEach(track => {
                track.stop();
            });
            console.log('✓ Текущий аудиопоток остановлен');
        }
        // удаляем анализатор громкости
        delete volumeAnalyzers[currentUserUUID]
        
        // Создаем новый поток с выбранным микрофоном
        const success = await getLocalStreamWithSelectedMicrophone();
        
        if (success) {
            createVolumeAnalyser(currentUserUUID, localStream)
            console.log('✓ Новый аудиопоток успешно создан');
            
            // Если мы в голосовом канале, обновляем все peer соединения
            if (currentRoom && Object.keys(voicePeerConnections).length > 0) {
                console.log('🔄 Обновление peer соединений с новым аудиопотоком...');
                
                // Обновляем треки во всех существующих соединениях
                Object.entries(voicePeerConnections).forEach(([peerUuid, pc]) => {
                    // Удаляем старые аудио треки
                    const senders = pc.getSenders();
                    senders.forEach(sender => {
                        if (sender.track && sender.track.kind === 'audio') {
                            sender.replaceTrack(localStream.getAudioTracks()[0]);
                            console.log(`✓ Аудио трек обновлен для ${peerUuid}`);
                        }
                    });
                });
                
                console.log('✓ Все peer соединения обновлены');
            }            
            return true;
        } else {
            console.log('❌ Не удалось создать новый аудиопоток');
            return false;
        }
    } catch (err) {
        console.error('❌ Ошибка обновления аудиопотока:', err);
        return false;
    }
}

// Управление микрофоном
function switchMute() {
    if (!localStream) return;
    
    isMicMuted = !isMicMuted;
    
    // Управляем и оригинальным и обработанным потоком
    const streams = [localStream];
    streams.forEach(stream => {
        stream.getAudioTracks().forEach(track => {
            track.enabled = !isMicMuted;
        });
    });
    
    if (isMicMuted) {
        console.log('🔇 Микрофон выключен');
    } else {
        console.log('🎤 Микрофон включен');
    }
    // Отправляем статус на сервер
    sendStatusUpdate();
};


// Обработка нового участника
async function handlePeerJoined(data) {
    console.log(`➤ ${data.username} присоединился к комнате`);
    
    // Сохраняем информацию об участнике
    connectedPeers[data.user_uuid] = data.username;
    
    // Создаем peer connection для нового участника
    if (data.user_uuid !== currentUserUUID) {
        await createVoicePeerConnection(data.user_uuid, true);
    }
    
    const audio = new Audio('../static/sound/join-fx.mp3');
    audio.play();
    
    updateParticipantsList();
}


// Обработка выхода участника
function handlePeerLeft(data) {
    console.log(`➤ ${data.username} покинул комнату`);
    
    // Закрываем соединение
    if (voicePeerConnections[data.peer_uuid]) {
        voicePeerConnections[data.peer_uuid].close();
        delete voicePeerConnections[data.peer_uuid];
        console.log(`Соединение с ${data.username} закрыто`);
    }
    
    // Очищаем GainNode
    if (peerGainNodes[data.peer_uuid]) {
        const gainData = peerGainNodes[data.peer_uuid];
        if (gainData.source) gainData.source.disconnect();
        if (gainData.audioContext) gainData.audioContext.close();
        delete peerGainNodes[data.peer_uuid];
    }

    // Удаляем volume anaylzer
    delete volumeAnalyzers[data.peer_uuid]
    
    // Удаляем аудио элемент
    if (peerAudioElements[data.peer_uuid]) {
        peerAudioElements[data.peer_uuid].remove();
        delete peerAudioElements[data.peer_uuid];
    }

    // Удаляем шаринг экрана пользователя, если он был включен
    if (peerScreenShares[data.peer_uuid]) {
        removeScreenShare(data.peer_uuid);
    }

    // Закрываем соединение для демонстрации, если было
    if (screenPeerConnections[data.peer_uuid]) {
        screenPeerConnections[data.peer_uuid].close();
    }
    
    const audio = new Audio('../static/sound/disconnect-fx.mp3');
    audio.play();
    
    updateParticipantsList();
}
