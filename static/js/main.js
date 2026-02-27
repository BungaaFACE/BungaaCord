// app.js - WebSocket клиент для Discord-like голосового чата

let ws = null;
let localStream = null;
let processedStream = null; // Обработанный поток с шумодавом
let peerConnections = {};
let currentRoom = '';
let currentUsername = '';
let params = getQueryParams();
let currentUserUUID = params.user;
let audioContext = null;
let audioAnalyser = null;
let silenceDetector = null;
let noiseSuppressor = null; // Продвинутый шумодав
let isSilenceDetectionEnabled = true;
let silenceThreshold = 1; // Порог тишины в % (по умолчанию 40%)
let isCurrentlySilent = false;
let currentVolume = 0; // Текущий уровень громкости для отображения (0-100%)
let volumeMeterInterval = null;
let noiseSuppressionMode = 'moderate'; // 'minimal', 'moderate', 'aggressive'
let isNoiseSuppressionEnabled = true;
let peerVolumes = {}; // Хранит громкость для каждого участника { user_uuidv4: volume }
let peerGainNodes = {}; // Хранит GainNode для каждого участника { user_uuidv4: gainNode }
let peerAudioElements = {}; // Хранит аудио элементы для каждого участника { user_uuidv4: audio }
let volumeAnalyzers = {}; // Хранит анализаторы громкости для каждого участника
let connectedPeers = {}; // Хранит информацию об участниках { user_uuidv4: username }
let connectedVoiceUsers = {}; // Хранит информацию для отображения списка участников ГС на странице

// let peerVolumes = new Proxy(tmppeerVolumes, {
//   set(target, key, value) {
//     console.log(`Установка свойства "${key}" = ${value} в строке ${new Error().stack.split("\n")[1].trim()}`);
//     console.trace()
//     target[key] = value;
//     return true;
//   }
// });

// Настройки повторных попыток WebRTC соединений
// Конфигурация для автоматического восстановления соединений при неудаче
let webrtcRetryConfig = {
    maxRetries: 3, // Максимальное количество попыток для каждого участника
    retryDelay: 2000, // Задержка между попытками в миллисекундах
    retryAttempts: {}, // Хранит количество попыток для каждого участника { user_uuid: attempts }
    retryTimers: {} // Хранит ID таймеров для повторных попыток { user_uuid: timerId }
};

/*
 * Механизм повторных попыток WebRTC соединений:
 *
 * 1. При неудачном соединении (failed/disconnected) автоматически запускается механизм повторных попыток
 * 2. Для каждого участника ведется счетчик попыток (maxRetries = 3 по умолчанию)
 * 3. Между попытками есть задержка (retryDelay = 5000ms по умолчанию)
 * 4. Если участник покидает комнату, все попытки для него отменяются
 * 5. Настройки сохраняются в localStorage и загружаются при перезагрузке страницы
 *
 * Это решает проблему нестабильных WebRTC соединений в сетях с ограниченной
 * пропускной способностью или при временных проблемах с NAT/Traversal.
 */
// {"room": {
//     "username": {
//         "user_uuid": user_uuid,
//         "is_mic_muted": is_mic_muted,
//         "is_deafened": is_deafened,
//         "is_streaming": is_streaming}, ...}}
let isElectronEnvironment = false;
let wasMicMuted = false; // сохраняем значение заглушки микрофона для восстановления состояния при снятии MuteAll


// Конфигурация ICE серверов

async function getIceServers(userUuid) {
    try {
        console.log('🔄 Запрос TURN credentials для пользователя:', userUuid);
        const response = await fetch(`/api/get_turn_creds?user=${userUuid}`);
        
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


// Элементы интерфейса
const logEl = document.getElementById('log');
const silenceThresholdEl = document.getElementById('silenceThreshold');
const toggleSilenceBtn = document.getElementById('toggleSilenceBtn');
const volumeBarEl = document.getElementById('volumeBar');
const volumeFillEl = document.getElementById('volumeFill');
const noiseSuppressionModeEl = document.getElementById('noiseSuppressionMode');
const toggleNoiseSuppressionBtn = document.getElementById('toggleNoiseSuppressionBtn');
const noiseProfileBtn = document.getElementById('noiseProfileBtn');
const screenSharesListEl = document.getElementById('screenSharesList');

// Элементы панели управления голосовым каналом
const voiceControlPanel = document.getElementById('voiceControlPanel');
const voiceScreenBtn = document.getElementById('voiceScreenBtn');
const voiceMicBtn = document.getElementById('voiceMicBtn');
const voiceDeafenBtn = document.getElementById('voiceDeafenBtn');
const voiceLeaveBtn = document.getElementById('voiceLeaveBtn');
let isMicMuted = false;
let isDeafened = false;
let screenStream = null; // Поток демонстрации экрана
let isScreenSharing = false; // Флаг демонстрации экрана
let screenPeerConnections = {}; // Отдельные соединения для демонстрации экрана
let peerScreenShares = {}; // Хранит информацию о демонстрациях от других участников

// Логирование в интерфейс
function log(msg) {
    const timestamp = new Date().toLocaleTimeString();
    logEl.textContent += `[${timestamp}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
}

// Подключение к WebSocket серверу
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?user=${currentUserUUID}`;
    
    ws = new WebSocket(wsUrl);
    window.ws = ws; // Сохраняем для chatManager
    
    ws.onopen = () => {
        console.log('✓ Подключено к серверу сигнализации');
    };
    
    ws.onclose = (event) => {
        console.log(`✗ Отключено от сервера: ${event.code} ${event.reason || 'Без причины'}`);
        
        // Попытка переподключения через 3 секунды
        setTimeout(() => {
            if (!ws || ws.readyState === WebSocket.CLOSED) {
                console.log('Попытка переподключения...');
                connectWebSocket();
            }
        }, 3000);
    };
    
    ws.onerror = (error) => {
        console.log('⚠ Ошибка WebSocket соединения');
        console.error('WebSocket error:', error);
    };
    
    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type !== 'ping') {
                console.log('📨 WebSocket сообщение получено:', data);
            }
            await handleServerMessage(data);
        } catch (err) {
            console.log(`Ошибка обработки сообщения: ${err.message}`);
            console.error(`Ошибка обработки сообщения: ${err.message}. Сообщение: ${event.data}. Stack: ${err.stack}`);
        }
    };
}

// Обработка сообщений от сервера
async function handleServerMessage(data) {
    const type = data.type;
    
    switch (type) {
        case 'joined':
            handleJoined(data);
            break;
            
        case 'peers':
            await handlePeers(data.peers);
            break;
            
        case 'peer_joined':
            await handlePeerJoined(data);
            break;
            
        case 'peer_left':
            handlePeerLeft(data);
            break;
            
        case 'signal':
            await handleSignal(data);
            break;

        case 'user_status_total':
            connectedVoiceUsers = data.data;
            updateParticipantsList();
            break;

        case 'user_status_update':
            handleUserStatusUpdate(data);
            break;
            
        case 'screen_share_request':
            createScreenShareConnection(data.user_uuid);
            break;

        case 'screen_share_stop':
            handleScreenShareStop(data);
            break;
            
        case 'screen_signal':
            await handleScreenSignal(data);
            break;
        
        case 'chat_message':
            if (!window.chatManager) {
                window.chatManager = new ChatManager();
            }
            window.chatManager.handleChatMessage(data);
            break;
            
        case 'ping':
            sendWsMessage({type: 'pong'})
            break;
            
        case 'error':
            console.log(`❌ Ошибка: ${data.message}`);
            alert(data.message);
            break;
            
        default:
            console.log(`Неизвестный тип сообщения: ${type}`);
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
        await createPeerConnection(peer.user_uuid, false);
    }
}

// Обработка нового участника
async function handlePeerJoined(data) {
    console.log(`➤ ${data.username} присоединился к комнате`);
    
    // Сохраняем информацию об участнике
    connectedPeers[data.user_uuid] = data.username;
    
    // Создаем peer connection для нового участника
    if (data.user_uuid !== currentUserUUID) {
        await createPeerConnection(data.user_uuid, true);
    }
    
    const audio = new Audio('static/sound/join-fx.mp3');
    audio.play();
    
    updateParticipantsList();
}

// Обработка выхода участника
function handlePeerLeft(data) {
    console.log(`➤ ${data.username} покинул комнату`);
    
    // Закрываем соединение
    if (peerConnections[data.peer_uuid]) {
        peerConnections[data.peer_uuid].close();
        delete peerConnections[data.peer_uuid];
        console.log(`Соединение с ${data.username} закрыто`);
    }
    
    // Удаляем из списка участников
    delete connectedPeers[data.user_uuid];
    
    // Очищаем ресурсы анализатора громкости
    if (volumeAnalyzers[data.peer_uuid]) {
        const analyzer = volumeAnalyzers[data.peer_uuid];
        if (analyzer.intervalId) {
            clearInterval(analyzer.intervalId);
        }
        if (analyzer.source) {
            analyzer.source.disconnect();
        }
        delete volumeAnalyzers[data.peer_uuid];
    }
    delete peerVolumes[data.peer_uuid];
    
    // Очищаем GainNode
    if (peerGainNodes[data.peer_uuid]) {
        const gainData = peerGainNodes[data.peer_uuid];
        if (gainData.source) gainData.source.disconnect();
        if (gainData.audioContext) gainData.audioContext.close();
        delete peerGainNodes[data.peer_uuid];
    }
    
    // Удаляем аудио элемент
    if (peerAudioElements[data.peer_uuid]) {
        peerAudioElements[data.peer_uuid].remove();
        delete peerAudioElements[data.peer_uuid];
    }
    
    const audio = new Audio('static/sound/disconnect-fx.mp3');
    audio.play();
    
    updateParticipantsList();
}

// Обработка сигнальных сообщений WebRTC
async function handleSignal(data) {
    const senderUuid = data.sender;
    const message = data.data;
    
    let pc = peerConnections[senderUuid];
    
    if (!pc && message.type === 'offer') {
        pc = await createPeerConnection(senderUuid, false);
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

// Отправка сообщения на сервер
function sendWsMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    } else {
        console.log('Ошибка: WebSocket не подключен');
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

// Отправка обновления статуса на сервер
function sendStatusUpdate() {
    sendWsMessage({
        type: 'user_status_update',
        is_mic_muted: isMicMuted,
        is_deafened: isDeafened,
        is_streaming: isScreenSharing
    });
}

// Создание RTCPeerConnection
async function createPeerConnection(targetPeerUuid, isInitiator) {
    console.log(`${isInitiator ? 'Инициируем' : 'Принимаем'} соединение с ${targetPeerUuid}`);
    
    const NewiceServers = await getIceServers(currentUserUUID)
    const pc = new RTCPeerConnection(NewiceServers);
    peerConnections[targetPeerUuid] = pc;
    
    // Отправка обработанного потока с шумодавом
    const streamToSend = processedStream || localStream;
    
    console.log(`📡 Отправка потока: ${streamToSend === processedStream ? 'обработанного' : 'оригинального'}`);
    console.log('Stream to send tracks:', streamToSend.getTracks().length);
    
    if (streamToSend) {
        streamToSend.getTracks().forEach(track => {
            if (track.kind === 'audio') {
                // Создаем финальный трек с контролем тишины
                const finalTrack = createSilenceControlledTrack(track);
                pc.addTrack(finalTrack, streamToSend);
                console.log('✓ Аудио-трек добавлен в соединение');
            } else {
                pc.addTrack(track, streamToSend);
            }
        });
    }
    
    // Обработка ICE кандидатов
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`🧊 ICE candidate создан для ${targetPeerUuid}:`, event.candidate);
            console.log(`🧊 Тип candidate: ${event.candidate.type}`);
            console.log(`🧊 Protocol: ${event.candidate.protocol}`);
            console.log(`🧊 Address: ${event.candidate.address || event.candidate.ip}`);
            console.log(`🧊 Port: ${event.candidate.port}`);
            
            sendSignal(targetPeerUuid, {
                type: 'candidate',
                candidate: event.candidate
            });
        } else {
            console.log(`✅ ICE gathering завершен для ${targetPeerUuid}`);
        }
    };
    
    // Получение удаленного потока
    pc.ontrack = (event) => {
        console.log(`✓ Получен аудиопоток от ${targetPeerUuid}`);
        
        // Создаем GainNode для регулировки громкости (основной способ)
        createGainNodeForPeer(targetPeerUuid, event.streams[0]);
        
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
        
        // Создаем или обновляем анализатор громкости для этого потока
        createVolumeAnalyzer(targetPeerUuid, peerAudioElements[targetPeerUuid].srcObject);
    };
    
    // Отслеживание состояния соединения
    pc.onconnectionstatechange = () => {
        console.log(`${targetPeerUuid}: состояние соединения - ${pc.connectionState}`);
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            console.error(`❌ Соединение с ${targetPeerUuid} не удалось!`);
            console.error(`❌ Последнее состояние ICE: ${pc.iceConnectionState}`);
            console.error(`❌ Последнее состояние подключения: ${pc.connectionState}`);
            
            // Запускаем механизм повторных попыток
            scheduleWebrtcRetry(targetPeerUuid);
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
                if (peerConnections[targetPeerUuid] &&
                    (peerConnections[targetPeerUuid].connectionState === 'disconnected' ||
                     peerConnections[targetPeerUuid].connectionState === 'failed' ||
                     peerConnections[targetPeerUuid].connectionState === 'closed')) {
                    
                    delete peerConnections[targetPeerUuid];
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

// Функция для планирования повторной попытки WebRTC соединения
function scheduleWebrtcRetry(targetPeerUuid) {
    // Проверяем, не превышено ли максимальное количество попыток
    if (!webrtcRetryConfig.retryAttempts[targetPeerUuid]) {
        webrtcRetryConfig.retryAttempts[targetPeerUuid] = 0;
    }
    
    webrtcRetryConfig.retryAttempts[targetPeerUuid]++;
    
    console.log(`🔄 Попытка ${webrtcRetryConfig.retryAttempts[targetPeerUuid]} из ${webrtcRetryConfig.maxRetries} для соединения с ${targetPeerUuid}`);
    
    // Если превышено максимальное количество попыток, очищаем данные
    if (webrtcRetryConfig.retryAttempts[targetPeerUuid] >= webrtcRetryConfig.maxRetries) {
        console.error(`❌ Превышено максимальное количество попыток для ${targetPeerUuid}`);
        cleanupRetryData(targetPeerUuid);
        return;
    }
    
    // Удаляем старый таймер, если существует
    if (webrtcRetryConfig.retryTimers[targetPeerUuid]) {
        clearTimeout(webrtcRetryConfig.retryTimers[targetPeerUuid]);
        delete webrtcRetryConfig.retryTimers[targetPeerUuid];
    }
    
    // Планируем новую попытку
    const timerId = setTimeout(async () => {
        console.log(`🔄 Повторная попытка соединения с ${targetPeerUuid}...`);
        
        // Проверяем, все еще ли участник в комнате
        if (connectedPeers[targetPeerUuid]) {
            try {
                // Удаляем старое соединение, если оно существует
                if (peerConnections[targetPeerUuid]) {
                    peerConnections[targetPeerUuid].close();
                    delete peerConnections[targetPeerUuid];
                }
                
                // Создаем новое соединение
                await createPeerConnection(targetPeerUuid, false);
                console.log(`✅ Новая попытка соединения с ${targetPeerUuid} инициирована`);
            } catch (error) {
                console.error(`❌ Ошибка при повторной попытке соединения с ${targetPeerUuid}: ${error.message}`);
                // Если ошибка, планируем еще одну попытку
                scheduleWebrtcRetry(targetPeerUuid);
            }
        } else {
            console.log(`👤 Участник ${targetPeerUuid} больше не в комнате, отмена повторных попыток`);
            cleanupRetryData(targetPeerUuid);
        }
    }, webrtcRetryConfig.retryDelay);
    
    // Сохраняем ID таймера
    webrtcRetryConfig.retryTimers[targetPeerUuid] = timerId;
}

/**
 * Очищает данные повторных попыток для конкретного участника
 * @param {string} targetPeerUuid - UUID участника, данные которого нужно очистить
 *
 * Используется при:
 * - Превышении максимального количества попыток
 * - Уходе участника из комнаты
 * - Успешном установлении соединения
 */
function cleanupRetryData(targetPeerUuid) {
    // Удаляем таймер
    if (webrtcRetryConfig.retryTimers[targetPeerUuid]) {
        clearTimeout(webrtcRetryConfig.retryTimers[targetPeerUuid]);
        delete webrtcRetryConfig.retryTimers[targetPeerUuid];
    }
    
    // Удаляем счетчик попыток
    delete webrtcRetryConfig.retryAttempts[targetPeerUuid];
    
    console.log(`🧹 Очищены данные повторных попыток для ${targetPeerUuid}`);
}

/**
 * Сбрасывает все активные повторные попытки WebRTC соединений
 *
 * Вызывается при:
 * - Выходе пользователя из комнаты
 * - Перезагрузке страницы
 * - Ошибке WebSocket соединения
 *
 * Это предотвращает утечки памяти и бесконечные попытки для пользователей,
 * которые уже покинули комнату.
 */
function resetAllWebrtcRetries() {
    Object.keys(webrtcRetryConfig.retryTimers).forEach(peerUuid => {
        if (webrtcRetryConfig.retryTimers[peerUuid]) {
            clearTimeout(webrtcRetryConfig.retryTimers[peerUuid]);
        }
    });
    
    webrtcRetryConfig.retryTimers = {};
    webrtcRetryConfig.retryAttempts = {};
    
    console.log('🔄 Все повторные попытки WebRTC сброшены');
}


// Обработчик покидания канала
function handleLeaveChannel() {
    if (!currentRoom) {
        return;
    }
    
    leaveCurrentRoom();
}

// Обработчик изменения порога тишины
if (silenceThresholdEl) {
    silenceThresholdEl.addEventListener('input', (e) => {
        silenceThreshold = parseFloat(e.target.value);
        if (silenceDetector) {
            silenceDetector.updateThreshold(silenceThreshold);
        }
        console.log(`Порог громкости изменен на ${silenceThreshold}%`);
        
        // Сохраняем настройки
        saveSilenceSettings();
    });
}

// Обработчик переключения детектора тишины
if (toggleSilenceBtn) {
    toggleSilenceBtn.addEventListener('click', toggleSilenceDetection);
}

// Обработчик переключения шумодава
if (toggleNoiseSuppressionBtn) {
    toggleNoiseSuppressionBtn.addEventListener('click', toggleNoiseSuppression);
}

// Обработчик изменения режима шумодава
if (noiseSuppressionModeEl) {
    noiseSuppressionModeEl.addEventListener('click', changeNoiseSuppressionMode);
}

// Обработчик перезапуска профилирования
if (noiseProfileBtn) {
    noiseProfileBtn.addEventListener('click', restartNoiseProfiling);
}

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
        const response = await fetch(`/api/user?user=${userUUID}`);
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
            const avatarUrl = `/static/avatars/${currentUserUUID}_avatar.jpg`
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


// Инициализация при загрузке страницы
window.addEventListener('DOMContentLoaded', async () => {
    console.log('Инициализация голосового чата...');
    
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
    
    // Загружаем настройки повторных попыток WebRTC
    loadWebrtcRetrySettings();

    // Инициализируем модальное окно настроек
    initializeSettingsModal();
    
    // Активируем кнопки настроек (они будут доступны до входа в канал)
    activateSettingsButtons();
    
    // Инициализируем панель управления голосовым каналом
    initializeVoiceControlPanel();

    isElectronEnvironment = !!(window.electronAPI);
    if (isElectronEnvironment) {
        loadScript('static/js/electron-screen-stream.js');
    } else {
        loadScript('static/js/screen-stream.js');
    };
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

// Функции для работы с localStorage
function saveSettings() {
    try {
        const settings = {
            noiseSuppressionMode: noiseSuppressionMode,
            isNoiseSuppressionEnabled: isNoiseSuppressionEnabled,
            silenceThreshold: silenceThreshold,
            isSilenceDetectionEnabled: isSilenceDetectionEnabled,
            peerVolumes: peerVolumes
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
        
        // Загружаем настройки шумодава
        if (settings.noiseSuppressionMode) {
            noiseSuppressionMode = settings.noiseSuppressionMode;
            if (noiseSuppressionModeEl) {
                const modeLabels = {
                    'minimal': 'Минимальный',
                    'moderate': 'Умеренный',
                    'aggressive': 'Агрессивный'
                };
                noiseSuppressionModeEl.textContent = `Режим: ${modeLabels[noiseSuppressionMode]}`;
            }
        }
        
        if (settings.isNoiseSuppressionEnabled !== undefined) {
            isNoiseSuppressionEnabled = settings.isNoiseSuppressionEnabled;
            if (toggleNoiseSuppressionBtn) {
                toggleNoiseSuppressionBtn.textContent = isNoiseSuppressionEnabled ?
                    '🔇 Отключить шумодав' : '🎤 Включить шумодав';
                toggleNoiseSuppressionBtn.style.background = isNoiseSuppressionEnabled ? '#4f545c' : '#ed4245';
            }
        }
        
        // Загружаем настройки порога громкости
        if (settings.silenceThreshold !== undefined) {
            silenceThreshold = settings.silenceThreshold;
            if (silenceThresholdEl) {
                silenceThresholdEl.value = silenceThreshold;
            }
            if (silenceDetector) {
                silenceDetector.updateThreshold(silenceThreshold);
            }
        }
        
        if (settings.isSilenceDetectionEnabled !== undefined) {
            isSilenceDetectionEnabled = settings.isSilenceDetectionEnabled;
            if (toggleSilenceBtn) {
                toggleSilenceBtn.textContent = isSilenceDetectionEnabled ?
                    '🔇 Отключить детектор тишины' : '🎤 Включить детектор тишины';
            }
        }
        
        // Загружаем громкость участников
        if (settings.peerVolumes) {
            peerVolumes = { ...settings.peerVolumes };
        }
        
        console.log('✓ Настройки загружены из localStorage');
    } catch (error) {
        console.error('❌ Ошибка загрузки настроек:', error);
    }
}

function saveNoiseSuppressionSettings() {
    try {
        const settings = JSON.parse(localStorage.getItem('bungaaCordSettings') || '{}');
        settings.noiseSuppressionMode = noiseSuppressionMode;
        settings.isNoiseSuppressionEnabled = isNoiseSuppressionEnabled;
        localStorage.setItem('bungaaCordSettings', JSON.stringify(settings));
        console.log('✓ Настройки шумодава сохранены');
    } catch (error) {
        console.error('❌ Ошибка сохранения настроек шумодава:', error);
    }
}

function saveSilenceSettings() {
    try {
        const settings = JSON.parse(localStorage.getItem('bungaaCordSettings') || '{}');
        settings.silenceThreshold = silenceThreshold;
        settings.isSilenceDetectionEnabled = isSilenceDetectionEnabled;
        localStorage.setItem('bungaaCordSettings', JSON.stringify(settings));
        console.log('✓ Настройки порога громкости сохранены');
    } catch (error) {
        console.error('❌ Ошибка сохранения настроек порога громкости:', error);
    }
}

function savePeerVolumes() {
    try {
        const settings = JSON.parse(localStorage.getItem('bungaaCordSettings') || '{}');
        settings.peerVolumes = peerVolumes;
        localStorage.setItem('bungaaCordSettings', JSON.stringify(settings));
        console.log('✓ Громкость участников сохранена');
    } catch (error) {
        console.error('❌ Ошибка сохранения громкости участников:', error);
    }
}

/**
 * Обновляет настройки повторных попыток WebRTC соединений
 * @param {number} maxRetries - Максимальное количество попыток (1-10)
 * @param {number} retryDelay - Задержка между попытками в миллисекундах (1000-30000)
 *
 * Параметры:
 * - maxRetries: от 1 до 10 попыток (по умолчанию 3)
 * - retryDelay: от 1000ms до 30000ms (по умолчанию 5000ms)
 *
 * Настройки автоматически сохраняются в localStorage и загружаются
 * при следующей инициализации приложения.
 */
function updateWebrtcRetrySettings(maxRetries, retryDelay) {
    // Валидация параметров
    maxRetries = Math.max(1, Math.min(10, maxRetries || 3));
    retryDelay = Math.max(1000, Math.min(30000, retryDelay || 5000));
    
    webrtcRetryConfig.maxRetries = maxRetries;
    webrtcRetryConfig.retryDelay = retryDelay;
    
    console.log(`🔧 Настройки повторных попыток WebRTC обновлены:`);
    console.log(`   - Максимальное количество попыток: ${maxRetries}`);
    console.log(`   - Задержка между попытками: ${retryDelay}ms`);
    
    // Сохраняем настройки в localStorage
    try {
        const settings = {
            maxRetries: maxRetries,
            retryDelay: retryDelay
        };
        localStorage.setItem('bungaaCordWebrtcRetry', JSON.stringify(settings));
        console.log('✅ Настройки сохранены в localStorage');
    } catch (error) {
        console.error('❌ Ошибка сохранения настроек:', error);
    }
}

/**
 * Загружает сохраненные настройки повторных попыток WebRTC из localStorage
 *
 * При отсутствии сохраненных настроек используются значения по умолчанию:
 * - maxRetries: 3
 * - retryDelay: 5000ms
 *
 * Функция вызывается автоматически при инициализации приложения.
 */
function loadWebrtcRetrySettings() {
    try {
        const savedSettings = localStorage.getItem('bungaaCordWebrtcRetry');
        if (!savedSettings) {
            console.log('✅ Сохраненные настройки не найдены, используются значения по умолчанию');
            return;
        }
        
        const settings = JSON.parse(savedSettings);
        
        if (settings.maxRetries !== undefined) {
            webrtcRetryConfig.maxRetries = Math.max(1, Math.min(10, settings.maxRetries));
            console.log(`   - Максимальное количество попыток: ${webrtcRetryConfig.maxRetries}`);
        }
        
        if (settings.retryDelay !== undefined) {
            webrtcRetryConfig.retryDelay = Math.max(1000, Math.min(30000, settings.retryDelay));
            console.log(`   - Задержка между попытками: ${webrtcRetryConfig.retryDelay}ms`);
        }
        
        console.log('✅ Настройки повторных попыток загружены из localStorage');
    } catch (error) {
        console.error('❌ Ошибка загрузки настроек:', error);
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

// Загрузка аватарки пользователя на сервер
async function uploadUserAvatar(file) {
    try {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch(`/api/upload_avatar?user=${currentUserUUID}`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.status === 'ok') {
            // Обновляем аватарку в интерфейсе
            const userAvatar = document.getElementById('userAvatar');
            if (userAvatar) {
                userAvatar.style.backgroundImage = `url(${data.avatar.url})`;
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

// Обработчик изменения громкости для демонстраций
document.addEventListener('input', (e) => {
    if (e.target.classList.contains('screen-volume-slider')) {
        const peerUuid = e.target.getAttribute('data-peer-uuid');
        const volume = parseInt(e.target.value);
        const volumeValue = document.querySelector(`.screen-volume-value[data-peer-uuid="${peerUuid}"]`);
        
        if (volumeValue) {
            volumeValue.textContent = `${volume}%`;
        }
        
        // Update progress bar
        e.target.style.setProperty('--progress', `${volume}%`);
        
        // Устанавливаем громкость для видео
        const screenShareData = peerScreenShares[peerUuid];
        if (screenShareData && screenShareData.video) {
            screenShareData.video.volume = volume / 100;
        }
    }
});
