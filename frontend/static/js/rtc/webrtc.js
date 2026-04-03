let voicePeerConnections = {};

// Конфигурация ICE серверов
async function getIceServers(userUuid) {
    try {
        console.log('🔄 Запрос TURN credentials для пользователя:', userUuid);
        const response = await fetch(`${window.BACKEND_URL}/api/get_turn_creds?user=${userUuid}`);
        
        if (response.status === 200) {
            const data = await response.json();
            console.log('✓ TURN credentials получены:', data);
            
            // Проверяем структуру credentials
            const username = data.turn_username;
            const password = data.turn_password;
            
            const iceServers = {
                iceServers: [
                    { urls: 'stun:stun.bungaa-server.ru:3478' },
                    // TURN сервер с явным указанием протокола UDP
                    { urls: 'turn:turn.bungaa-server.ru:3478?transport=udp', 
                        username: username, 
                        credential: password },
                    // TURN сервер с явным указанием протокола TCP
                    { urls: 'turn:turn.bungaa-server.ru:3478?transport=tcp', 
                        username: username, 
                        credential: password },
                ],
            };
            
            console.log('✓ Конфигурация ICE серверов:', iceServers);
            return iceServers;
        } else {
            console.warn('❌ Failed to get turn creds, status:', response.status, response.statusText);
            throw new Error(`Failed to get turn credentials: ${response.status}`);
        }
    } catch (error) {
        console.warn('❌ Error getting turn creds:', error.message);
        const iceServers = {
                iceServers: [
                    { urls: 'stun:stun.bungaa-server.ru:3478' }
                ],
            };
        console.log('📋 Fallback Stun Server:', iceServers);
        return iceServers;
    }
}


// Обработка сигнальных сообщений WebRTC
async function handleSignal(data) {
    const senderUuid = data.sender;
    const message = data.data;
    
    let pc = voicePeerConnections[senderUuid];
    
    if (!pc && message.type === 'offer') {
        pc = await createVoicePeerConnection(senderUuid, false);
    }
    
    if (!pc) {
        console.log(`Ошибка: нет соединения с ${senderUuid}`);
        return;
    }
    
    try {
        if (message.type === 'offer') {
            console.log(`Получен offer от ${senderUuid}`);
            await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            sendSignal(senderUuid, { type: 'answer', sdp: pc.localDescription });
            console.log(`Отправлен answer для ${senderUuid}`);
            
        } else if (message.type === 'answer') {
            console.log(`Получен answer от ${senderUuid}`);
            await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
            
        } else if (message.type === 'candidate') {
            console.log(`Получен ICE candidate от ${senderUuid}`);
            await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
    } catch (err) {
        console.log(`Ошибка обработки сигнала от ${senderUuid}: ${err.message}`);
    }
}


// Отправка сигнального сообщения
function sendSignal(targetPeerUuid, data) {
    console.log(`send signal to ${targetPeerUuid}`)
    sendWsMessage({
        type: 'signal',
        target: targetPeerUuid,
        data: data
    });
}

// Создание RTCPeerConnection
async function createVoicePeerConnection(targetPeerUuid, isInitiator) {
    console.log(`${isInitiator ? 'Инициируем' : 'Принимаем'} соединение с ${targetPeerUuid}`);
    
    const NewiceServers = await getIceServers(currentUserUUID)
    const pc = new RTCPeerConnection(NewiceServers);
    voicePeerConnections[targetPeerUuid] = pc;
    
    // Отправка обработанного потока с шумодавом
    const streamToSend = processedStream || localStream;
    
    console.log(`📡 Отправка потока: ${streamToSend}`);
    console.log('Stream to send tracks:', streamToSend.getTracks().length);
    
    if (streamToSend) {
        streamToSend.getTracks().forEach(track => {
            pc.addTrack(track, streamToSend);
        });
    }
    
    // Обработка ICE кандидатов
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`🧊 ICE candidate создан для ${targetPeerUuid}:`, event.candidate);
            console.log(`🧊 Тип candidate: ${event.candidate.type}`);
            console.log(`🧊 Protocol: ${event.candidate.protocol}`);
            
            sendSignal(targetPeerUuid, {
                type: 'candidate',
                candidate: event.candidate
            });
        } else {
            console.log(`✅ ICE gathering завершен для ${targetPeerUuid}`);
        }
    };
    
    // Получение удаленного потока
    pc.ontrack = async (event) => {
        console.log(`✓ Получен аудиопоток от ${targetPeerUuid}`);
        
        stream = await createVolumeAnalyser(targetPeerUuid, event.streams[0])
        // Создаем GainNode для регулировки громкости (основной способ)
        await createGainNodeForPeer(targetPeerUuid, stream);
        
        // Проверяем, существует ли уже аудио элемент для этого peer
        if (!peerAudioElements[targetPeerUuid]) {
            // Создаем аудио элемент только для анализа громкости
            const audio = document.createElement('audio');
            audio.autoplay = false; // Не воспроизводим
            audio.controls = false;
            audio.srcObject = event.streams[0];
            audio.muted = true; // Отключаем звук
            audio.style.display = 'none';
            document.body.appendChild(audio);
            
            // Сохраняем аудио элемент
            peerAudioElements[targetPeerUuid] = audio;
        } else {
            // Обновляем srcObject для существующего аудио элемента
            peerAudioElements[targetPeerUuid].srcObject = event.streams[0];
        }
    };
    
    // Отслеживание состояния соединения
    pc.onconnectionstatechange = () => {
        console.log(`${targetPeerUuid}: состояние соединения - ${pc.connectionState}`);
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            console.error(`❌ Соединение с ${targetPeerUuid} не удалось!`);
            console.error(`❌ Последнее состояние ICE: ${pc.iceConnectionState}`);
            console.error(`❌ Последнее состояние подключения: ${pc.connectionState}`);
        }
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log(`${targetPeerUuid}: состояние ICE - ${pc.iceConnectionState}`);
        
        if (pc.iceConnectionState === 'checking') {
            console.log(`🔄 ICE checking для ${targetPeerUuid} - поиск соединения...`);
        } else if (pc.iceConnectionState === 'connected') {
            console.log(`✅ ICE соединение установлено для ${targetPeerUuid}`);
        } else if (pc.iceConnectionState === 'disconnected' ||
                   pc.iceConnectionState === 'failed' ||
                   pc.iceConnectionState === 'closed') {
            
            console.error(`❌ ICE соединение потеряно для ${targetPeerUuid}: ${pc.iceConnectionState}`);
            
            // Через некоторое время удаляем соединение
            setTimeout(() => {
                if (voicePeerConnections[targetPeerUuid] &&
                    (voicePeerConnections[targetPeerUuid].connectionState === 'disconnected' ||
                     voicePeerConnections[targetPeerUuid].connectionState === 'failed' ||
                     voicePeerConnections[targetPeerUuid].connectionState === 'closed')) {
                    
                    delete voicePeerConnections[targetPeerUuid];
                    console.log(`Соединение с ${targetPeerUuid} удалено`);
                }
            }, 5000);
        }
    };
    
    // Создание предложения (offer) если мы инициатор
    if (isInitiator) {
        createOffer(pc, targetPeerUuid);
    }
    
    return pc;
}

// Создание отдельного соединения для демонстрации экрана
async function createScreenShareConnection(targetPeerUuid) {
    console.log(`Создание соединения для демонстрации экрана с ${targetPeerUuid}`);
    
    const NewiceServers = await getIceServers(currentUserUUID)
    const pc = new RTCPeerConnection(NewiceServers);
    screenPeerConnections[targetPeerUuid] = pc;
    
    // Добавляем все треки экрана (и видео, и аудио), только если они есть
    if (screenStream) {
        screenStream.getTracks().forEach(track => {
            pc.addTrack(track, screenStream);
            console.log(`✓ ${track.kind}-трек экрана добавлен в соединение`);
        });
    } else {
        console.log(`ℹ️ Текущий клиент не отправляет трансляцию, создаем соединение только для получения`);
    }
    
    // Обработка ICE кандидатов
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendWsMessage({
                type: 'screen_signal',
                target: targetPeerUuid,
                data: {
                    type: 'candidate',
                    candidate: event.candidate
                }
            });
        }
    };
    
    // Получение удаленного потока
    pc.ontrack = (event) => {
        console.log(`✓ Получен ${event.track.kind} трек от ${targetPeerUuid}`);
        try {
            const username = connectedPeers[targetPeerUuid];
            
            if (username) {
                // Если это первый трек для этого пира, создаем демонстрацию
                const stream = event.streams[0]
                if (!peerScreenShares[targetPeerUuid]) {
                    addScreenShare(targetPeerUuid, username, stream);
                } else {
                    const videoElement = peerScreenShares[targetPeerUuid].video;
                    if (videoElement.srcObject !== stream) {
                        videoElement.srcObject = stream;
                    }
                }
            }
        } catch (err) {
            console.error(`Ошибка обработки pc.ontrack: ${err.message}. Сообщение: ${event.data}. Stack: ${err.stack}`);
        }
    };
    
    // Создаем предложение
    try {
        const offer = await pc.createOffer({
            offerToReceiveVideo: true,
            offerToReceiveAudio: true
        });
        
        await pc.setLocalDescription(offer);
        
        sendWsMessage({
            type: 'screen_signal',
            target: targetPeerUuid,
            data: {
                type: 'offer',
                sdp: pc.localDescription
            }
        });
        
        console.log(`Отправлен screen offer для ${targetPeerUuid}`);
    } catch (err) {
        console.log(`Ошибка создания screen offer: ${err.message}`);
    }
}


// Создание предложения WebRTC
async function createOffer(pc, targetPeerUuid) {
    try {
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });
        
        await pc.setLocalDescription(offer);
        
        sendSignal(targetPeerUuid, {
            type: 'offer',
            sdp: pc.localDescription
        });
        
        console.log(`Отправлен offer для ${targetPeerUuid}`);
    } catch (err) {
        console.log(`Ошибка создания offer для ${targetPeerUuid}: ${err.message}`);
    }
}
