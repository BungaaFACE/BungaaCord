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


// Отправка сигнального сообщения
function sendSignal(targetPeerUuid, data) {
    console.log(`send signal to ${targetPeerUuid}`)
    sendWsMessage({
        type: 'signal',
        target: targetPeerUuid,
        data: data
    });
}

// Обработка сигнальных сообщений WebRTC
async function handleSignal(data) {
    const senderUuid = data.sender;
    const message = data.data;
    
    let pc = voicePeerConnections[senderUuid];
    
    try {
        if (message.type === 'offer') {
            console.log(`Получен offer от ${senderUuid}`);
            
            if (pc) {
                const state = pc.connectionState;
                if (state === 'connected' || state === 'connecting') {
                    console.warn(`⚠ Получен offer от ${senderUuid}, но соединение уже ${state}, игнорируем`);
                    return;
                }
                if (state === 'failed' || state === 'closed' || state === 'disconnected') {
                    console.log(`🔄 Закрываем старое соединение с ${senderUuid}`);
                    pc.close();
                    delete voicePeerConnections[senderUuid];
                    pc = null;
                }
            }
            
            if (!pc) {
                pc = await createVoicePeerConnection(senderUuid, false);
            }
            
            await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            sendSignal(senderUuid, { type: 'answer', sdp: pc.localDescription });
            console.log(`Отправлен answer для ${senderUuid}`);
            
        } else if (message.type === 'answer') {
            console.log(`Получен answer от ${senderUuid}`);
            
            if (!pc) {
                console.warn(`⚠ Получен answer от ${senderUuid}, но соединения нет`);
                return;
            }
            
            await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
            
        } else if (message.type === 'candidate') {
            console.log(`Получен ICE candidate от ${senderUuid}`);
            
            if (!pc) {
                console.warn(`⚠ Получен candidate от ${senderUuid}, но соединения нет`);
                return;
            }
            
            if (!pc.remoteDescription) {
                console.warn(`⚠ remoteDescription еще не установлен, ждем...`);
                return;
            }
            
            try {
                await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
            } catch (e) {
                console.warn(`Ошибка добавления ICE candidate: ${e.message}`);
            }
        }
    } catch (err) {
        console.error(`Ошибка обработки сигнала от ${senderUuid}:`, err);
    }
}

// Создание RTCPeerConnection
async function createVoicePeerConnection(targetPeerUuid, isInitiator) {
    console.log(`${isInitiator ? 'Инициируем' : 'Принимаем'} соединение с ${targetPeerUuid}`);
    
    const existingPc = voicePeerConnections[targetPeerUuid];
    if (existingPc) {
        const state = existingPc.connectionState;
        if (state === 'connected' || state === 'connecting' || state === 'new') {
            console.log(`⚠ Соединение с ${targetPeerUuid} уже существует (state: ${state})`);
            return existingPc;
        }
        console.log(`🔄 Закрываем старое соединение с ${targetPeerUuid} (state: ${state})`);
        existingPc.close();
        delete voicePeerConnections[targetPeerUuid];
    }
    
    const newIceServers = await getIceServers(currentUserUUID);
    const pc = new RTCPeerConnection(newIceServers);
    voicePeerConnections[targetPeerUuid] = pc;
    
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
        try {
            const stream = await createVolumeAnalyser(targetPeerUuid, event.streams[0])
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
        } catch (err) {
            console.error(`Ошибка обработки ontrack для ${targetPeerUuid}:`, err);
        }
    };
    
    // Отслеживание состояния соединения
    pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log(`${targetPeerUuid}: состояние соединения - ${state}`);
        
        if (state === 'failed') {
            console.error(`❌ Соединение с ${targetPeerUuid} не удалось`);
            
            pc.close();
            if (voicePeerConnections[targetPeerUuid] === pc) {
                delete voicePeerConnections[targetPeerUuid];
            }
            
            if (currentRoom && connectedPeers[targetPeerUuid]) {
                const shouldInitiate = currentUserUUID > targetPeerUuid;
                if (shouldInitiate) {
                    console.log(`🔄 Переподключение к ${targetPeerUuid}...`);
                    createVoicePeerConnection(targetPeerUuid, true).catch(err => {
                        console.error(`Ошибка переподключения к ${targetPeerUuid}:`, err);
                    });
                }
            }
        } else if (state === 'closed') {
            console.log(`✓ Соединение с ${targetPeerUuid} закрыто`);
            if (voicePeerConnections[targetPeerUuid] === pc) {
                delete voicePeerConnections[targetPeerUuid];
            }
        }
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log(`${targetPeerUuid}: состояние ICE - ${pc.iceConnectionState}`);
    };
    
    const streamToSend = processedStream || localStream;
    
    if (streamToSend) {
        console.log(`📡 Добавляем треки в соединение с ${targetPeerUuid}`);
        streamToSend.getTracks().forEach(track => {
            pc.addTrack(track, streamToSend);
        });
    } else {
        console.warn(`⚠ Нет локального потока для отправки ${targetPeerUuid}`);
    }
    
    if (isInitiator) {
        await createOffer(pc, targetPeerUuid);
    }
    
    return pc;
}

// Создание отдельного соединения для демонстрации экрана
async function createScreenShareConnection(targetPeerUuid) {
    console.log(`Создание соединения для демонстрации экрана с ${targetPeerUuid}`);
    
    const newIceServers = await getIceServers(currentUserUUID);
    const pc = new RTCPeerConnection(newIceServers);
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
