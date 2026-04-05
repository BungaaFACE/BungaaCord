let volumeAnalyzers = {};
let speakingStates = {};
let volumeInterval = null;
let isDeafened = false;
let connectedVoiceUsers = {};

async function getAudioContext() {
    if (!window.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        window.audioCtx = new AudioContextClass({ sampleRate: 48000 });
    }
    if (window.audioCtx.state === 'suspended') {
        await window.audioCtx.resume();
    }
    return window.audioCtx
}


function switchMuteAll() {
    isDeafened = !isDeafened;
    
    if (isDeafened) {
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });
        }
        
        Object.values(peerGainNodes).forEach(gainData => {
            gainData.gain.setValueAtTime(0, window.audioCtx.currentTime);
        });
        console.log('🔇 Звук заглушен');
        
        wasMicMuted = isMicMuted;
        if (!isMicMuted) {
            isMicMuted = true;
        }
    } else {
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !wasMicMuted;
            });
        }

        Object.entries(peerGainNodes).forEach(([userUUID, gainData]) => {
            const savedVolume = peerVolumes[userUUID] || 100;
            gainData.gain.setValueAtTime(savedVolume / 100, window.audioCtx.currentTime);
        });

        isMicMuted = wasMicMuted;
        
        console.log('🔊 Звук включен');
    }
    
    sendStatusUpdate();
};


async function joinRoom(roomName, channelElement) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Нет подключения к серверу');
        return;
    }

    if (!currentUsername || !currentUserUUID) {
        console.log('⚠ Данные пользователя не загружены, загружаем...');
        const userLoaded = await loadCurrentUser();
        if (!userLoaded) {
            alert('Ошибка: не удалось загрузить данные пользователя');
            return;
        }
    }

    if (!localStream) {
        const hasStream = await getLocalStreamWithSelectedMicrophone();
        if (!hasStream) {
            alert('Не удалось получить доступ к микрофону');
            return;
        }
    } else {
        console.log('✓ Микрофон уже настроен, используем существующий поток');
    }

    sendWsMessage({
        type: 'join',
        room: roomName
    });

    console.log(`Запрос на присоединение к каналу "${roomName}"...`);

    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
    });

    if (channelElement) {
        channelElement.classList.add('active');
    }
}

function handleJoined(data) {
    currentRoom = data.room;
    console.log(`✓ Присоединились к комнате "${currentRoom}"`);
    
    const audio = new Audio('../static/sound/join-fx.mp3');
    audio.play();
    showVoiceControlPanel();
    updateVoicePanelButtons();
}

async function handlePeers(peers) {
    console.log(`📋 Получен список участников: ${peers.length} чел.`);
    
    peers.forEach(peer => {
        connectedPeers[peer.user_uuid] = peer.username;
    });
    
    updateParticipantsList();
    
    if (peers.length === 0) {
        return;
    }
    
    // ВАЖНО: Чтобы избежать гонки условий (race condition), когда оба клиента
    // пытаются создать соединение одновременно, используем детерминированное правило:
    // Инициатором будет тот, чей UUID больше (лексикографически)
    for (let peer of peers) {
        const peerUuid = peer.user_uuid;
        
        if (peerUuid === currentUserUUID) {
            continue;
        }
        
        const existingPc = voicePeerConnections[peerUuid];
        if (existingPc) {
            const state = existingPc.connectionState;
            if (state === 'connected' || state === 'connecting') {
                console.log(`✓ WebRTC соединение с ${peer.username} уже установлено (${state})`);
                continue;
            }
            if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                console.log(`🔄 Пересоздание WebRTC соединения с ${peer.username} (было ${state})`);
                existingPc.close();
                delete voicePeerConnections[peerUuid];
            }
        }
        
        // Детерминированное решение: кто должен быть инициатором
        // Тот, у кого UUID больше, создает offer
        const shouldInitiate = currentUserUUID > peerUuid;
        
        if (!voicePeerConnections[peerUuid]) {
            console.log(`➕ Создание WebRTC соединения с ${peer.username} (initiator: ${shouldInitiate})`);
            await createVoicePeerConnection(peerUuid, shouldInitiate);
        }
    }
}


async function leaveCurrentRoom() {
    if (!currentRoom || !currentUsername) {
        return;
    }
    
    sendWsMessage({
        type: 'leave'
    });
    
    currentRoom = '';
    currentUsername = '';
    
    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
    });
    
    Object.keys(voicePeerConnections).forEach(id => {
        voicePeerConnections[id].close();
    });
    voicePeerConnections = {};
    
    Object.values(peerGainNodes).forEach(gainData => {
        if (gainData.source) gainData.source.disconnect();
    });
    peerGainNodes = {};

    Object.keys(volumeAnalyzers).forEach(user_uuid => {
        if (user_uuid !== currentUserUUID) {
            delete volumeAnalyzers[user_uuid]
        }
    });
    
    Object.values(peerAudioElements).forEach(audio => audio.remove());
    peerAudioElements = {};
    
    if (isScreenSharing) {
        stopScreenShare();
    }
    
    Object.keys(peerScreenShares).forEach(peerUuid => {
        removeScreenShare(peerUuid);
    });
    peerScreenShares = {};
    
    Object.keys(screenPeerConnections).forEach(id => {
        if (screenPeerConnections[id]) {
            screenPeerConnections[id].close();
        }
    });
    screenPeerConnections = {};
    
    const audio = new Audio('../static/sound/disconnect-fx.mp3');
    audio.play();
    
    connectedPeers = {};
    updateParticipantsList();
    
    hideVoiceControlPanel();
}


function handleLeaveChannel() {
    if (!currentRoom) {
        return;
    }
    
    leaveCurrentRoom();
}



async function handleChannelClick(roomName, channelElement) {
    if (currentRoom === roomName) {
        return;
    } else if (currentRoom) {
        await leaveCurrentRoom();
    }
    await joinRoom(roomName, channelElement);
}


async function createVolumeAnalyser(userUuid, stream) {
    await getAudioContext();
    const source = window.audioCtx.createMediaStreamSource(stream);
    const analyser = window.audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.5;
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

            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const average = sum / bufferLength;

            const isSpeaking = average > threshold;

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
