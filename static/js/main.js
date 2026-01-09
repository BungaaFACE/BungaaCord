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
let silenceThreshold = 40; // Порог тишины в % (по умолчанию 40%)
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
// {"room": {
//     "username": {
//         "user_uuid": user_uuid,
//         "is_mic_muted": is_mic_muted,
//         "is_deafened": is_deafened,
//         "is_streaming": is_streaming}, ...}}


// Конфигурация ICE серверов
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};


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
        log('✓ Подключено к серверу сигнализации');
    };
    
    ws.onclose = (event) => {
        log(`✗ Отключено от сервера: ${event.code} ${event.reason || 'Без причины'}`);
        
        // Попытка переподключения через 3 секунды
        setTimeout(() => {
            if (!ws || ws.readyState === WebSocket.CLOSED) {
                log('Попытка переподключения...');
                connectWebSocket();
            }
        }, 3000);
    };
    
    ws.onerror = (error) => {
        log('⚠ Ошибка WebSocket соединения');
        console.error('WebSocket error:', error);
    };
    
    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('📨 WebSocket сообщение получено:', data);
            await handleServerMessage(data);
        } catch (err) {
            log(`Ошибка обработки сообщения: ${err.message}`);
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
            handlePeers(data.peers);
            break;
            
        case 'peer_joined':
            handlePeerJoined(data);
            break;
            
        case 'peer_left':
            handlePeerLeft(data);
            break;
            
        case 'signal':
            handleSignal(data);
            break;

        case 'user_status_total':
            connectedVoiceUsers = data.data;
            break;

        case 'user_status_update':
            handleUserStatusUpdate(data);
            break;
            
        case 'screen_share_start':
            handleScreenShareStart(data);
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
            
        case 'error':
            log(`❌ Ошибка: ${data.message}`);
            alert(data.message);
            break;
            
        default:
            log(`Неизвестный тип сообщения: ${type}`);
    }
}

// Обработка подтверждения присоединения
function handleJoined(data) {
    currentRoom = data.room;
    log(`✓ Присоединились к комнате "${currentRoom}"`);
    // Показываем панель управления голосовым каналом
    showVoiceControlPanel();
    // Обновляем состояние кнопок на панели
    updateVoicePanelButtons();
}

// Обработка списка участников
function handlePeers(peers) {
    // Сохраняем информацию об участниках
    peers.forEach(peer => {
        connectedPeers[peer.user_uuid] = peer;
    });
    
    updateParticipantsList();
    
    if (peers.length === 0) {
        return;
    }
    
    // Устанавливаем соединения с существующими участниками
    peers.forEach(peer => {
        if (peer.user_uuid !== currentUserUUID) {
            createPeerConnection(peer.user_uuid, false);
        }
    });
}

// Обработка нового участника
function handlePeerJoined(data) {
    log(`➤ ${data.username} присоединился к комнате`);
    
    // Сохраняем информацию об участнике
    connectedPeers[data.user_uuid] = data.username;
    
    // Создаем peer connection для нового участника
    if (data.user_uuid !== currentUserUUID) {
        createPeerConnection(data.user_uuid, true);
    }
    
    updateParticipantsList();
}

// Обработка выхода участника
function handlePeerLeft(data) {
    log(`➤ ${data.username} покинул комнату`);
    
    // Закрываем соединение
    if (peerConnections[data.peer_uuid]) {
        peerConnections[data.peer_uuid].close();
        delete peerConnections[data.peer_uuid];
        log(`Соединение с ${data.username} закрыто`);
    }
    
    // Удаляем из списка участников
    delete connectedPeers[data.user_uuid];
    
    // Очищаем ресурсы
    if (volumeAnalyzers[data.peer_uuid]) {
        if (volumeAnalyzers[data.peer_uuid].intervalId) {
            clearInterval(volumeAnalyzers[data.peer_uuid].intervalId);
        }
        // Отключаем источник
        if (volumeAnalyzers[data.peer_uuid].source) {
            volumeAnalyzers[data.peer_uuid].source.disconnect();
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
    
    updateParticipantsList();
}

// Обработка сигнальных сообщений WebRTC
async function handleSignal(data) {
    const senderUuid = data.sender;
    const message = data.data;
    
    let pc = peerConnections[senderUuid];
    
    if (!pc && message.type === 'offer') {
        pc = createPeerConnection(senderUuid, false);
    }
    
    if (!pc) {
        log(`Ошибка: нет соединения с ${senderUuid}`);
        return;
    }
    
    try {
        if (message.type === 'offer') {
            log(`Получен offer от ${senderUuid}`);
            await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            sendSignal(senderUuid, { type: 'answer', sdp: pc.localDescription });
            log(`Отправлен answer для ${senderUuid}`);
            
        } else if (message.type === 'answer') {
            log(`Получен answer от ${senderUuid}`);
            await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
            
        } else if (message.type === 'candidate') {
            log(`Получен ICE candidate от ${senderUuid}`);
            await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
    } catch (err) {
        log(`Ошибка обработки сигнала от ${senderUuid}: ${err.message}`);
    }
}

// Отправка сообщения на сервер
function sendWsMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    } else {
        log('Ошибка: WebSocket не подключен');
    }
}

// Отправка сигнального сообщения
function sendSignal(targetPeerUuid, data) {
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
function createPeerConnection(targetPeerUuid, isInitiator) {
    log(`${isInitiator ? 'Инициируем' : 'Принимаем'} соединение с ${targetPeerUuid}`);
    
    const pc = new RTCPeerConnection(iceServers);
    peerConnections[targetPeerUuid] = pc;
    
    // Отправка обработанного потока с шумодавом
    const streamToSend = processedStream || localStream;
    
    log(`📡 Отправка потока: ${streamToSend === processedStream ? 'обработанного' : 'оригинального'}`);
    console.log('Stream to send tracks:', streamToSend.getTracks().length);
    
    if (streamToSend) {
        streamToSend.getTracks().forEach(track => {
            if (track.kind === 'audio') {
                // Создаем финальный трек с контролем тишины
                const finalTrack = createSilenceControlledTrack(track);
                pc.addTrack(finalTrack, streamToSend);
                log('✓ Аудио-трек добавлен в соединение');
            } else {
                pc.addTrack(track, streamToSend);
            }
        });
    }
    
    // Обработка ICE кандидатов
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal(targetPeerUuid, {
                type: 'candidate',
                candidate: event.candidate
            });
        }
    };
    
    // Получение удаленного потока
    pc.ontrack = (event) => {
        log(`✓ Получен аудиопоток от ${targetPeerUuid}`);
        
        // Создаем GainNode для регулировки громкости (основной способ)
        createGainNodeForPeer(targetPeerUuid, event.streams[0]);
        
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
        
        // Создаем анализатор громкости для этого потока
        createVolumeAnalyzer(targetPeerUuid, audio);
    };
    
    // Отслеживание состояния соединения
    pc.onconnectionstatechange = () => {
        log(`${targetPeerUuid}: состояние соединения - ${pc.connectionState}`);
    };
    
    pc.oniceconnectionstatechange = () => {
        log(`${targetPeerUuid}: состояние ICE - ${pc.iceConnectionState}`);
        
        if (pc.iceConnectionState === 'disconnected' || 
            pc.iceConnectionState === 'failed' ||
            pc.iceConnectionState === 'closed') {
            
            // Через некоторое время удаляем соединение
            setTimeout(() => {
                if (peerConnections[targetPeerUuid] && 
                    (peerConnections[targetPeerUuid].connectionState === 'disconnected' ||
                     peerConnections[targetPeerUuid].connectionState === 'failed' ||
                     peerConnections[targetPeerUuid].connectionState === 'closed')) {
                    
                    delete peerConnections[targetPeerUuid];
                    log(`Соединение с ${targetPeerUuid} удалено`);
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
        
        log(`Отправлен offer для ${targetPeerUuid}`);
    } catch (err) {
        log(`Ошибка создания offer для ${targetPeerUuid}: ${err.message}`);
    }
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
        log(`Порог громкости изменен на ${silenceThreshold}%`);
        
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
        log('❌ Ошибка: отсутствует параметр user в URL');
        alert('Ошибка: отсутствует параметр user в URL. Доступ запрещен.');
        return false;
    }
    
    try {
        const response = await fetch(`/api/user?user=${userUUID}`);
        const data = await response.json();
        
        if (data.status === 'ok') {
            currentUserUUID = userUUID;
            currentUsername = data.user.username;
            log(`✓ Пользователь: ${currentUsername}`);
            
            // Обновляем профиль в боковой панели
            const sidebarUsername = document.getElementById('sidebarUsername');
            const userAvatar = document.getElementById('userAvatar');
            if (sidebarUsername) {
                sidebarUsername.textContent = currentUsername;
            }
            if (userAvatar) {
                userAvatar.textContent = currentUsername.charAt(0).toUpperCase();
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
            log(`❌ Ошибка: ${data.error}`);
            alert(`Ошибка: ${data.error}. Доступ запрещен.`);
            return false;
        }
    } catch (error) {
        log(`❌ Ошибка загрузки пользователя: ${error.message}`);
        alert('Ошибка загрузки пользователя. Доступ запрещен.');
        return false;
    }
}


// Инициализация при загрузке страницы
window.addEventListener('DOMContentLoaded', async () => {
    log('Инициализация голосового чата...');
    
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

    // Инициализируем модальное окно настроек
    initializeSettingsModal();
    
    // Активируем кнопки настроек (они будут доступны до входа в канал)
    activateSettingsButtons();
    
    // Инициализируем панель управления голосовым каналом
    initializeVoiceControlPanel();
});

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
