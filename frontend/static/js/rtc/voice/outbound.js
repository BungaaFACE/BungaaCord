let localStream = null;
let processedStream = null;
let noiseSuppressionNode = null;
let audioSourceNode = null;
let wasMicMuted = false;
let isMicMuted = false;
let isNoiseSuppressionLoaded = false;

async function loadNoiseSuppressionWorklet() {
    if (isNoiseSuppressionLoaded) return true;
    try {
        await getAudioContext()

        await window.audioCtx.audioWorklet.addModule('../static/js/rtc/voice/rnnoise-worklet.js');
        isNoiseSuppressionLoaded = true;
        console.log('✓ Noise suppression worklet loaded');
        return true;
    } catch (err) {
        console.warn('⚠ Failed to load noise suppression worklet:', err.message);
        return false;
    }
}

async function applyNoiseSuppression(stream) {
    if (!isNoiseSuppressionLoaded) {
        console.log('⚠ Noise suppression not loaded, using raw stream');
        return stream;
    }
    try {
        if (audioSourceNode) audioSourceNode.disconnect();
        if (noiseSuppressionNode) noiseSuppressionNode.disconnect();

        audioSourceNode = window.audioCtx.createMediaStreamSource(stream);
        noiseSuppressionNode = new AudioWorkletNode(window.audioCtx, 'NoiseSuppressorWorklet');

        audioSourceNode.connect(noiseSuppressionNode);

        const destination = window.audioCtx.createMediaStreamDestination();
        noiseSuppressionNode.connect(destination);

        processedStream = destination.stream;
        console.log('✓ Noise suppression applied to stream');
        return processedStream;
    } catch (err) {
        console.warn('⚠ Failed to apply noise suppression:', err.message);
        return stream;
    }
}

async function getLocalStreamWithSelectedMicrophone() {
    try {
        console.log('🔊 Запрос доступа к микрофону...');
        
        const audioConstraints = {
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false
        };
        
        if (selectedMicrophoneId) {
            audioConstraints.deviceId = { exact: selectedMicrophoneId };
            console.log(`🎤 Используется выбранный микрофон: ${selectedMicrophoneId}`);
        }
        
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false
        });

        await loadNoiseSuppressionWorklet();
        const streamForAnalyzer = await applyNoiseSuppression(localStream);

        await createVolumeAnalyser(currentUserUUID, streamForAnalyzer);
        console.log('✓ Микрофон доступен');
        return true;

    } catch (err) {
        if (err.name === 'NotAllowedError') {
            console.log('❌ Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.');
        } else if (err.name === 'NotFoundError') {
            console.log('❌ Микрофон не найден');
        } else if (err.name === 'OverconstrainedError') {
            console.log('❌ Выбранный микрофон недоступен или не поддерживает требуемые функции');
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
        
        // Очищаем noise suppression nodes
        if (audioSourceNode) {
            audioSourceNode.disconnect();
            audioSourceNode = null;
        }
        if (noiseSuppressionNode) {
            noiseSuppressionNode.disconnect();
            noiseSuppressionNode = null;
        }
        processedStream = null;
        
        // удаляем анализатор громкости
        delete volumeAnalyzers[currentUserUUID]
        
        // Создаем новый поток с выбранным микрофоном
        const success = await getLocalStreamWithSelectedMicrophone();
        
        if (success) {
            console.log('✓ Новый аудиопоток успешно создан');
            
            // Если мы в голосовом канале, обновляем все peer соединения
            if (currentRoom && Object.keys(voicePeerConnections).length > 0) {
                console.log('🔄 Обновление peer соединений с новым аудиопотоком...');
                
                // Обновляем треки во всех существующих соединениях
                Object.entries(voicePeerConnections).forEach(([peerUuid, pc]) => {
                    const senders = pc.getSenders();
                    senders.forEach(sender => {
                        if (sender.track && sender.track.kind === 'audio') {
                            const trackToUse = processedStream ? processedStream.getAudioTracks()[0] : localStream.getAudioTracks()[0];
                            sender.replaceTrack(trackToUse);
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
    
    const streams = [localStream];
    if (processedStream) streams.push(processedStream);
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
