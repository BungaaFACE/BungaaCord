// app.js - WebSocket клиент для Discord-like голосового чата

let ws = null;
let localStream = null;
let processedStream = null; // Обработанный поток с шумодавом
let peerConnections = {};
let currentRoom = '';
let currentUsername = '';
let peerId = generatePeerId(); // Уникальный ID для текущего клиента
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
let peerVolumes = {}; // Хранит громкость для каждого участника { peerId: volume }
let peerGainNodes = {}; // Хранит GainNode для каждого участника { peerId: gainNode }
let peerAudioElements = {}; // Хранит аудио элементы для каждого участника { peerId: audio }
let volumeAnalyzers = {}; // Хранит анализаторы громкости для каждого участника
let connectedPeers = {}; // Хранит информацию об участниках { peerId: {username, peer_id} }

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

// Класс для обнаружения тишины
class SilenceDetector {
    constructor(audioContext, stream, threshold = 40) {
        this.audioContext = audioContext;
        this.stream = stream;
        this.threshold = threshold;
        this.analyser = audioContext.createAnalyser();
        this.microphone = audioContext.createMediaStreamSource(stream);
        this.microphone.connect(this.analyser);
        this.analyser.fftSize = 256;
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.isSilent = false;
        this.onSilenceChange = null;
    }

    updateThreshold(newThreshold) {
        this.threshold = newThreshold;
    }

    detect() {
        this.analyser.getByteFrequencyData(this.dataArray);
        
        // Вычисляем средний уровень громкости
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i];
        }
        const average = sum / this.dataArray.length;
        
        // Конвертируем в проценты (0-255 -> 0-100%)
        const volumePercent = Math.round((average / 255) * 100);
        
        // Сохраняем текущую громкость для отображения
        currentVolume = volumePercent;
        
        // Определяем тишину (простая проверка по порогу в %)
        const wasSilent = this.isSilent;
        this.isSilent = volumePercent < this.threshold;
        
        // Уведомляем об изменении состояния
        if (wasSilent !== this.isSilent && this.onSilenceChange) {
            this.onSilenceChange(this.isSilent, volumePercent);
        }
        
        // Всегда обновляем индикатор громкости
        updateVolumeMeter(volumePercent);
        
        return {
            isSilent: this.isSilent,
            volume: volumePercent,
            rawLevel: average
        };
    }

    startDetection(interval = 100) {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        this.intervalId = setInterval(() => {
            this.detect();
        }, interval);
    }

    stopDetection() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    destroy() {
        this.stopDetection();
        if (this.microphone) {
            this.microphone.disconnect();
        }
    }
}

// Элементы интерфейса
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const muteToggleBtn = document.getElementById('muteToggleBtn');
const deafenBtn = document.getElementById('deafenBtn');
const statusEl = document.getElementById('status');
const roomNameEl = document.getElementById('roomName');
const participantsListEl = document.getElementById('participantsList');
const logEl = document.getElementById('log');
const silenceThresholdEl = document.getElementById('silenceThreshold');
const toggleSilenceBtn = document.getElementById('toggleSilenceBtn');
const volumeBarEl = document.getElementById('volumeBar');
const volumeFillEl = document.getElementById('volumeFill');
const noiseSuppressionModeEl = document.getElementById('noiseSuppressionMode');
const toggleNoiseSuppressionBtn = document.getElementById('toggleNoiseSuppressionBtn');
const noiseProfileBtn = document.getElementById('noiseProfileBtn');
const startScreenShareBtn = document.getElementById('startScreenShareBtn');
const stopScreenShareBtn = document.getElementById('stopScreenShareBtn');
const screenSharesListEl = document.getElementById('screenSharesList');
let isMicMuted = false;
let isDeafened = false;
let screenStream = null; // Поток демонстрации экрана
let isScreenSharing = false; // Флаг демонстрации экрана
let screenPeerConnections = {}; // Отдельные соединения для демонстрации экрана
let peerScreenShares = {}; // Хранит информацию о демонстрациях от других участников

// Генерация уникального peer ID
function generatePeerId() {
    return 'peer_' + Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

// Логирование в интерфейс
function log(msg) {
    const timestamp = new Date().toLocaleTimeString();
    logEl.textContent += `[${timestamp}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
}

// Подключение к WebSocket серверу
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        log('✓ Подключено к серверу сигнализации');
        statusEl.textContent = 'Подключено к серверу';
        joinBtn.disabled = false;
    };
    
    ws.onclose = (event) => {
        log(`✗ Отключено от сервера: ${event.code} ${event.reason || 'Без причины'}`);
        statusEl.textContent = 'Не подключено';
        joinBtn.disabled = true;
        leaveBtn.disabled = true;
        
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
            await handleServerMessage(data);
        } catch (err) {
            log(`Ошибка обработки сообщения: ${err.message}`);
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

        case 'peer_status_update':
            handlePeerStatusUpdate(data);
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
            
        default:
            log(`Неизвестный тип сообщения: ${type}`);
    }
}

// Обработка подтверждения присоединения
function handleJoined(data) {
    log(`✓ Присоединились к комнате "${data.room}" как ${data.username}`);
    currentRoom = data.room;
    currentUsername = data.username;
    
    statusEl.textContent = 'В голосовом канале';
    roomNameEl.textContent = data.room;
    
    joinBtn.disabled = true;
    leaveBtn.disabled = false;
    muteToggleBtn.disabled = false;
    deafenBtn.disabled = false;
    if (toggleSilenceBtn) {
        toggleSilenceBtn.disabled = false;
    }
    if (toggleNoiseSuppressionBtn) {
        toggleNoiseSuppressionBtn.disabled = false;
    }
    if (noiseSuppressionModeEl) {
        noiseSuppressionModeEl.disabled = false;
    }
    if (noiseProfileBtn) {
        noiseProfileBtn.disabled = false;
    }
    if (startScreenShareBtn) {
        startScreenShareBtn.disabled = false;
    }
}

// Обработка списка участников
function handlePeers(peers) {
    // Сохраняем информацию об участниках
    peers.forEach(peer => {
        connectedPeers[peer.peer_id] = peer;
    });
    
    updateParticipantsList();
    
    if (peers.length === 0) {
        return;
    }
    
    const peerNames = peers.map(p => p.username).join(', ');
    log(`Участники в комнате: ${peerNames}`);
    
    // Устанавливаем соединения с существующими участниками
    peers.forEach(peer => {
        if (peer.peer_id !== peerId) {
            createPeerConnection(peer.peer_id, false);
        }
    });
}

// Обработка нового участника
function handlePeerJoined(data) {
    log(`➤ ${data.username} присоединился к комнате`);
    
    // Сохраняем информацию об участнике
    connectedPeers[data.peer_id] = data;
    
    // Создаем peer connection для нового участника
    if (data.peer_id !== peerId) {
        createPeerConnection(data.peer_id, true);
    }
    
    updateParticipantsList();
}

// Обработка выхода участника
function handlePeerLeft(data) {
    log(`➤ ${data.username} покинул комнату`);
    
    // Закрываем соединение
    if (peerConnections[data.peer_id]) {
        peerConnections[data.peer_id].close();
        delete peerConnections[data.peer_id];
        log(`Соединение с ${data.username} закрыто`);
    }
    
    // Удаляем из списка участников
    delete connectedPeers[data.peer_id];
    
    // Очищаем ресурсы
    if (volumeAnalyzers[data.peer_id]) {
        if (volumeAnalyzers[data.peer_id].intervalId) {
            clearInterval(volumeAnalyzers[data.peer_id].intervalId);
        }
        // Отключаем источник
        if (volumeAnalyzers[data.peer_id].source) {
            volumeAnalyzers[data.peer_id].source.disconnect();
        }
        delete volumeAnalyzers[data.peer_id];
    }
    delete peerVolumes[data.peer_id];
    
    // Очищаем GainNode
    if (peerGainNodes[data.peer_id]) {
        const gainData = peerGainNodes[data.peer_id];
        if (gainData.source) gainData.source.disconnect();
        if (gainData.audioContext) gainData.audioContext.close();
        delete peerGainNodes[data.peer_id];
    }
    
    // Удаляем аудио элемент
    if (peerAudioElements[data.peer_id]) {
        peerAudioElements[data.peer_id].remove();
        delete peerAudioElements[data.peer_id];
    }
    
    updateParticipantsList();
}

// Обработка сигнальных сообщений WebRTC
async function handleSignal(data) {
    const senderId = data.sender;
    const message = data.data;
    
    let pc = peerConnections[senderId];
    
    if (!pc && message.type === 'offer') {
        pc = createPeerConnection(senderId, false);
    }
    
    if (!pc) {
        log(`Ошибка: нет соединения с ${senderId}`);
        return;
    }
    
    try {
        if (message.type === 'offer') {
            log(`Получен offer от ${senderId}`);
            await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            sendSignal(senderId, { type: 'answer', sdp: pc.localDescription });
            log(`Отправлен answer для ${senderId}`);
            
        } else if (message.type === 'answer') {
            log(`Получен answer от ${senderId}`);
            await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
            
        } else if (message.type === 'candidate') {
            log(`Получен ICE candidate от ${senderId}`);
            await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
    } catch (err) {
        log(`Ошибка обработки сигнала от ${senderId}: ${err.message}`);
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
function sendSignal(targetPeerId, data) {
    sendWsMessage({
        type: 'signal',
        target: targetPeerId,
        data: data
    });
}

// Отправка обновления статуса на сервер
function sendStatusUpdate() {
    sendWsMessage({
        type: 'user_status',
        is_mic_muted: isMicMuted,
        is_deafened: isDeafened
    });
}

// Получение доступа к микрофону
async function getLocalStream() {
    try {
        log('🔊 Запрос доступа к микрофону...');
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true, // Базовый шумодав браузера
                autoGainControl: true
            },
            video: false
        });
        
        log('✓ Микрофон доступен');
        console.log('Local stream tracks:', localStream.getTracks().length);
        
        // Инициализация продвинутого шумодава
        await initializeNoiseSuppression();
        
        // Инициализация аудио-анализатора для обнаружения тишины
        await initializeSilenceDetection();
        
        log('✓ Все системы активированы');
        return true;
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            log('❌ Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.');
        } else if (err.name === 'NotFoundError') {
            log('❌ Микрофон не найден');
        } else {
            log(`❌ Ошибка доступа к микрофону: ${err.message}`);
        }
        console.error('Microphone access error:', err);
        return false;
    }
}

// Инициализация продвинутого шумодава
async function initializeNoiseSuppression() {
    if (!localStream) return;
    
    try {
        // Создаем отдельный аудио-контекст для шумодава
        const suppressorContext = new (window.AudioContext || window.webkitAudioContext)();
        noiseSuppressor = new NoiseSuppressor(suppressorContext, {
            mode: noiseSuppressionMode,
            noiseThreshold: -50,
            attackTime: 0.01,
            releaseTime: 0.05,
            noiseProfileDuration: 2
        });
        
        // Получаем обработанный поток
        processedStream = await noiseSuppressor.initialize(localStream);
        log('✓ Продвинутый шумодав инициализирован');
        
    } catch (err) {
        log(`⚠ Ошибка инициализации шумодава: ${err.message}`);
        console.error('Noise suppressor error:', err);
        // Используем оригинальный поток как запасной вариант
        processedStream = localStream;
    }
}

// Инициализация обнаружения тишины
async function initializeSilenceDetection() {
    if (!processedStream) return;
    
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        silenceDetector = new SilenceDetector(audioContext, processedStream, silenceThreshold);
        
        silenceDetector.onSilenceChange = (isSilent, volume) => {
            isCurrentlySilent = isSilent;
            if (isSilent) {
                log(`🔇 Тишина обнаружена (${volume}%)`);
            } else {
                log(`🎤 Звук обнаружен (${volume}%)`);
            }
            updateSilenceIndicator(isSilent, volume);
        };
        
        silenceDetector.startDetection(100);
        log('✓ Детектор тишины активирован');
    } catch (err) {
        log(`⚠ Ошибка инициализации детектора тишины: ${err.message}`);
    }
}

// Обновление индикатора тишины в интерфейсе
function updateSilenceIndicator(isSilent, volume) {
    const indicator = document.getElementById('silenceIndicator');
    
    if (indicator) {
        indicator.textContent = isSilent ? '🔇 Тишина' : '🎤 Говорите';
        indicator.className = isSilent ? 'silent' : 'speaking';
    }
}

// Обновление индикатора громкости
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

// Создание RTCPeerConnection
function createPeerConnection(targetPeerId, isInitiator) {
    log(`${isInitiator ? 'Инициируем' : 'Принимаем'} соединение с ${targetPeerId}`);
    
    const pc = new RTCPeerConnection(iceServers);
    peerConnections[targetPeerId] = pc;
    
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
            sendSignal(targetPeerId, {
                type: 'candidate',
                candidate: event.candidate
            });
        }
    };
    
    // Получение удаленного потока
    pc.ontrack = (event) => {
        log(`✓ Получен аудиопоток от ${targetPeerId}`);
        
        // Создаем GainNode для регулировки громкости (основной способ)
        createGainNodeForPeer(targetPeerId, event.streams[0]);
        
        // Создаем аудио элемент только для анализа громкости
        const audio = document.createElement('audio');
        audio.autoplay = false; // Не воспроизводим
        audio.controls = false;
        audio.srcObject = event.streams[0];
        audio.muted = true; // Отключаем звук
        audio.style.display = 'none';
        document.body.appendChild(audio);
        
        // Сохраняем аудио элемент
        peerAudioElements[targetPeerId] = audio;
        
        // Создаем анализатор громкости для этого потока
        createVolumeAnalyzer(targetPeerId, audio);
    };
    
    // Отслеживание состояния соединения
    pc.onconnectionstatechange = () => {
        log(`${targetPeerId}: состояние соединения - ${pc.connectionState}`);
    };
    
    pc.oniceconnectionstatechange = () => {
        log(`${targetPeerId}: состояние ICE - ${pc.iceConnectionState}`);
        
        if (pc.iceConnectionState === 'disconnected' || 
            pc.iceConnectionState === 'failed' ||
            pc.iceConnectionState === 'closed') {
            
            // Через некоторое время удаляем соединение
            setTimeout(() => {
                if (peerConnections[targetPeerId] && 
                    (peerConnections[targetPeerId].connectionState === 'disconnected' ||
                     peerConnections[targetPeerId].connectionState === 'failed' ||
                     peerConnections[targetPeerId].connectionState === 'closed')) {
                    
                    delete peerConnections[targetPeerId];
                    log(`Соединение с ${targetPeerId} удалено`);
                }
            }, 5000);
        }
    };
    
    // Создание предложения (offer) если мы инициатор
    if (isInitiator) {
        createOffer(pc, targetPeerId);
    }
    
    return pc;
}

// Создание предложения WebRTC
async function createOffer(pc, targetPeerId) {
    try {
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });
        
        await pc.setLocalDescription(offer);
        
        sendSignal(targetPeerId, {
            type: 'offer',
            sdp: pc.localDescription
        });
        
        log(`Отправлен offer для ${targetPeerId}`);
    } catch (err) {
        log(`Ошибка создания offer для ${targetPeerId}: ${err.message}`);
    }
}

// Создание трека с контролем тишины
function createSilenceControlledTrack(originalTrack) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(new MediaStream([originalTrack]));
        const destination = audioContext.createMediaStreamDestination();
        
        // Создаем гейн-узел для контроля громкости
        const gainNode = audioContext.createGain();
        
        source.connect(gainNode);
        gainNode.connect(destination);
        
        // Функция для обновления громкости в зависимости от тишины
        const updateVolume = () => {
            if (isSilenceDetectionEnabled && isCurrentlySilent) {
                // Если тишина - отключаем звук
                gainNode.gain.value = 0;
            } else {
                // Иначе - полная громкость
                gainNode.gain.value = 1;
            }
        };
        
        // Обновляем громкость каждые 50мс
        setInterval(updateVolume, 50);
        
        return destination.stream.getAudioTracks()[0];
    } catch (err) {
        log(`⚠ Ошибка создания контролируемого трека: ${err.message}`);
        return originalTrack;
    }
}

// Управление обнаружением тишины
function toggleSilenceDetection() {
    isSilenceDetectionEnabled = !isSilenceDetectionEnabled;
    const btn = document.getElementById('toggleSilenceBtn');
    if (btn) {
        btn.textContent = isSilenceDetectionEnabled ?
            '🔇 Отключить детектор тишины' :
            '🎤 Включить детектор тишины';
    }
    log(isSilenceDetectionEnabled ? '✓ Детектор тишины включен' : '✗ Детектор тишины отключен');
}

// Управление шумодавом
function toggleNoiseSuppression() {
    isNoiseSuppressionEnabled = !isNoiseSuppressionEnabled;
    
    if (noiseSuppressor) {
        noiseSuppressor.setEnabled(isNoiseSuppressionEnabled);
    }
    
    const btn = document.getElementById('toggleNoiseSuppressionBtn');
    if (btn) {
        btn.textContent = isNoiseSuppressionEnabled ?
            '🔇 Отключить шумодав' :
            '🎤 Включить шумодав';
        btn.style.background = isNoiseSuppressionEnabled ? '#4f545c' : '#ed4245';
    }
    
    log(isNoiseSuppressionEnabled ? '✓ Шумодав включен' : '✗ Шумодав отключен');
}

// Изменение режима шумодава
function changeNoiseSuppressionMode() {
    if (!noiseSuppressionModeEl || !noiseSuppressor) return;
    
    const modes = ['minimal', 'moderate', 'aggressive'];
    const modeLabels = {
        'minimal': 'Минимальный',
        'moderate': 'Умеренный',
        'aggressive': 'Агрессивный'
    };
    
    const currentIndex = modes.indexOf(noiseSuppressionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    noiseSuppressionMode = modes[nextIndex];
    
    noiseSuppressor.updateSettings({ mode: noiseSuppressionMode });
    noiseSuppressionModeEl.textContent = `Режим: ${modeLabels[noiseSuppressionMode]}`;
    
    log(`✓ Режим шумодава изменен на: ${modeLabels[noiseSuppressionMode]}`);
}

// Перезапуск профилирования шума
function restartNoiseProfiling() {
    if (noiseSuppressor) {
        noiseSuppressor.restartProfiling();
        log('🔊 Перезапуск анализа фонового шума...');
    }
}

// Присоединение к комнате
joinBtn.addEventListener('click', async () => {
    currentUsername = document.getElementById('username').value.trim();
    currentRoom = document.getElementById('room').value.trim();
    
    if (!currentUsername) {
        alert('Введите ваше имя');
        return;
    }
    
    if (!currentRoom) {
        alert('Введите название комнаты');
        return;
    }
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Нет подключения к серверу');
        return;
    }
    
    // Получаем доступ к микрофону
    const hasStream = await getLocalStream();
    if (!hasStream) {
        alert('Не удалось получить доступ к микрофону');
        return;
    }
    
    // Отправляем запрос на присоединение
    sendWsMessage({
        type: 'join',
        peer_id: peerId,
        room: currentRoom,
        username: currentUsername
    });
    
    log(`Запрос на присоединение к комнате "${currentRoom}"...`);
});

// Покидание комнаты
leaveBtn.addEventListener('click', () => {
    if (!currentRoom || !currentUsername) {
        return;
    }
    
    sendWsMessage({
        type: 'leave'
    });
    
    // Очищаем состояние
    currentRoom = '';
    currentUsername = '';
    
    statusEl.textContent = 'Не подключен';
    roomNameEl.textContent = '-';
    
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
    muteToggleBtn.disabled = true;
    deafenBtn.disabled = true;
    if (toggleSilenceBtn) {
        toggleSilenceBtn.disabled = true;
    }
    
    // Закрываем все peer соединения
    Object.keys(peerConnections).forEach(id => {
        peerConnections[id].close();
    });
    peerConnections = {};
    
    // Останавливаем шумодав
    if (noiseSuppressor) {
        noiseSuppressor.destroy();
        noiseSuppressor = null;
    }
    
    // Останавливаем обнаружение тишины
    if (silenceDetector) {
        silenceDetector.destroy();
        silenceDetector = null;
    }
    
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    // Останавливаем локальный поток
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        processedStream = null;
    }
    
    isCurrentlySilent = false;
    currentVolume = 0;
    updateSilenceIndicator(false, -100);
    updateVolumeMeter(0, -100);
    
    // Очищаем все ресурсы участников
    Object.keys(volumeAnalyzers).forEach(peerId => {
        if (volumeAnalyzers[peerId].intervalId) {
            clearInterval(volumeAnalyzers[peerId].intervalId);
        }
        if (volumeAnalyzers[peerId].source) {
            volumeAnalyzers[peerId].source.disconnect();
        }
    });
    volumeAnalyzers = {};
    peerVolumes = {};
    
    // Очищаем все GainNodes
    Object.values(peerGainNodes).forEach(gainData => {
        if (gainData.source) gainData.source.disconnect();
        if (gainData.audioContext) gainData.audioContext.close();
    });
    peerGainNodes = {};
    
    // Удаляем все аудио элементы
    Object.values(peerAudioElements).forEach(audio => audio.remove());
    peerAudioElements = {};
    
    // Останавливаем демонстрацию экрана, если активна
    if (isScreenSharing) {
        stopScreenShare();
    }
    
    // Очищаем демонстрации от других участников
    Object.keys(peerScreenShares).forEach(peerId => {
        removeScreenShare(peerId);
    });
    peerScreenShares = {};
    
    // Закрываем все соединения для демонстрации
    Object.keys(screenPeerConnections).forEach(id => {
        if (screenPeerConnections[id]) {
            screenPeerConnections[id].close();
        }
    });
    screenPeerConnections = {};
    
    // Очищаем список участников
    connectedPeers = {};
    updateParticipantsList();
    
    log('Покинули комнату');
});

// Управление микрофоном
muteToggleBtn.addEventListener('click', () => {
    if (!localStream) return;
    
    isMicMuted = !isMicMuted;
    
    // Управляем и оригинальным и обработанным потоком
    const streams = [localStream];
    if (processedStream && processedStream !== localStream) {
        streams.push(processedStream);
    }
    
    streams.forEach(stream => {
        stream.getAudioTracks().forEach(track => {
            track.enabled = !isMicMuted;
        });
    });
    
    if (isMicMuted) {
        log('🔇 Микрофон выключен');
        muteToggleBtn.textContent = '🎤 Включить микрофон';
        muteToggleBtn.style.background = '#ed4245';
    } else {
        log('🎤 Микрофон включен');
        muteToggleBtn.textContent = '🔇 Выключить микрофон';
        muteToggleBtn.style.background = '#4f545c';
    }
    
    // Отправляем статус на сервер
    sendStatusUpdate();
    
    // Обновляем индикатор микрофона у текущего пользователя
    updateCurrentUserMicIndicator();
});

// Управление заглушением звука
deafenBtn.addEventListener('click', () => {
    isDeafened = !isDeafened;
    
    if (isDeafened) {
        // Заглушаем звук и микрофон
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });
        }
        
        // Отключаем звук у всех аудио элементов
        document.querySelectorAll('audio').forEach(audio => {
            audio.muted = true;
        });
        
        log('🔇 Звук заглушен');
        deafenBtn.textContent = '🔊 Включить звук';
        deafenBtn.style.background = '#ed4245';
        
        // Если был включен микрофон, меняем его состояние
        if (!isMicMuted) {
            isMicMuted = true;
            muteToggleBtn.textContent = '🎤 Включить микрофон';
            muteToggleBtn.style.background = '#ed4245';
        }
    } else {
        // Включаем звук
        document.querySelectorAll('audio').forEach(audio => {
            audio.muted = false;
        });
        
        // Включаем микрофон при снятии заглушки
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = true;
            });
        }
        
        // Сбрасываем состояние микрофона
        isMicMuted = false;
        muteToggleBtn.textContent = '🔇 Выключить микрофон';
        muteToggleBtn.style.background = '#4f545c';
        
        log('🔊 Звук включен');
        deafenBtn.textContent = '🔇 Заглушить звук';
        deafenBtn.style.background = '#4f545c';
    }
    
    // Отправляем статус на сервер
    sendStatusUpdate();
    
    // Обновляем индикаторы текущего пользователя
    updateCurrentUserMicIndicator();
    updateCurrentUserSoundIndicator();
});

// Обработчик изменения порога тишины
if (silenceThresholdEl) {
    silenceThresholdEl.addEventListener('input', (e) => {
        silenceThreshold = parseFloat(e.target.value);
        if (silenceDetector) {
            silenceDetector.updateThreshold(silenceThreshold);
        }
        log(`Порог громкости изменен на ${silenceThreshold}%`);
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

// Инициализация при загрузке страницы
window.addEventListener('DOMContentLoaded', () => {
    log('Инициализация голосового чата...');
    connectWebSocket();
    
    // Устанавливаем начальное состояние кнопок
    joinBtn.disabled = true;
    leaveBtn.disabled = true;
    muteToggleBtn.disabled = true;
    deafenBtn.disabled = true;
    if (toggleSilenceBtn) {
        toggleSilenceBtn.disabled = true;
    }
    if (toggleNoiseSuppressionBtn) {
        toggleNoiseSuppressionBtn.disabled = true;
    }
    if (noiseSuppressionModeEl) {
        noiseSuppressionModeEl.disabled = true;
    }
    if (noiseProfileBtn) {
        noiseProfileBtn.disabled = true;
    }
    if (startScreenShareBtn) {
        startScreenShareBtn.disabled = true;
    }
    if (stopScreenShareBtn) {
        stopScreenShareBtn.disabled = true;
    }
    
    // Генерируем случайное имя пользователя
    document.getElementById('username').value =
        'User' + Math.floor(Math.random() * 1000);
});

// Экспорт для отладки
// Создание анализатора громкости для аудиопотока участника
function createVolumeAnalyzer(peerId, audioElement) {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(audioElement.srcObject);
        
        source.connect(analyser);
        analyser.fftSize = 256;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        // Инициализируем громкость
        peerVolumes[peerId] = 0;
        
        // Запускаем отслеживание громкости
        const intervalId = setInterval(() => {
            analyser.getByteFrequencyData(dataArray);
            
            // Вычисляем средний уровень громкости
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            
            // Конвертируем в проценты (0-255 -> 0-100%)
            const volumePercent = Math.round((average / 255) * 100);
            
            // Сохраняем громкость
            peerVolumes[peerId] = volumePercent;
            
            // Обновляем индикатор
            updatePeerVolumeIndicator(peerId, volumePercent);
        }, 100);
        
        volumeAnalyzers[peerId] = {
            analyser,
            source,
            intervalId
        };
    } catch (err) {
        console.error('Error creating volume analyzer:', err);
    }
}

// Создание GainNode для регулировки громкости участника
function createGainNodeForPeer(peerId, stream) {
    try {
        // Создаем отдельный AudioContext для этого потока
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        const gainNode = audioContext.createGain();
        
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Устанавливаем начальную громкость (100%)
        gainNode.gain.setValueAtTime(1.0, audioContext.currentTime);
        
        // Сохраняем GainNode
        peerGainNodes[peerId] = {
            gainNode,
            audioContext,
            source
        };
        
        log(`✓ GainNode создан для ${peerId}`);
    } catch (err) {
        console.error('Error creating GainNode:', err);
        log(`❌ Ошибка создания GainNode для ${peerId}: ${err.message}`);
    }
}

// Регулировка громкости участника через GainNode
function setPeerVolume(peerId, volume) {
    const gainData = peerGainNodes[peerId];
    if (gainData && gainData.gainNode) {
        // Конвертируем проценты в значение gain (0% = 0.0, 100% = 1.0, 250% = 2.5)
        const gainValue = volume / 100;
        
        // Плавно изменяем громкость
        gainData.gainNode.gain.setValueAtTime(gainValue, gainData.audioContext.currentTime);
        
        // Обновляем отображение
        const volumeValueElement = document.querySelector(`.volume-value[data-peer-id="${peerId}"]`);
        if (volumeValueElement) {
            volumeValueElement.textContent = `${volume}%`;
        }
        
        log(`Громкость ${peerId} установлена на ${volume}% (gain: ${gainValue.toFixed(2)})`);
    } else {
        log(`⚠ GainNode не найден для ${peerId}`);
    }
}

// Обновление индикатора громкости участника
function updatePeerVolumeIndicator(peerId, volume) {
    const participantElement = document.querySelector(`[data-peer-id="${peerId}"]`);
    if (!participantElement) return;
    
    const indicator = participantElement.querySelector('.sound-indicator');
    if (!indicator) return;
    
    // Определяем, говорит ли участник (порог 5%)
    if (volume > 5) {
        indicator.classList.add('speaking');
        indicator.classList.remove('muted');
        participantElement.classList.add('speaking');
    } else {
        indicator.classList.remove('speaking');
        indicator.classList.remove('muted');
        participantElement.classList.remove('speaking');
    }
}


// Создание элемента участника
function createParticipantElement(data) {
    const participant = document.createElement('div');
    participant.className = 'participant';
    participant.setAttribute('data-peer-id', data.peer_id);
    
    // Аватар
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.style.background = `hsl(${Math.random() * 360}, 70%, 60%)`;
    avatar.textContent = data.username.charAt(0).toUpperCase();
    
    // Имя пользователя
    const username = document.createElement('div');
    username.className = 'username';
    username.textContent = data.username;
    
    // Индикаторы
    const indicators = document.createElement('div');
    indicators.className = 'indicators';
    
    // Индикатор микрофона
    const micIndicator = document.createElement('div');
    micIndicator.className = 'mic-indicator';
    micIndicator.innerHTML = '🎤';
    
    // Индикатор звука (наушников)
    const soundIndicator = document.createElement('div');
    soundIndicator.className = 'sound-indicator';
    soundIndicator.innerHTML = '🔊';
    
    indicators.appendChild(micIndicator);
    indicators.appendChild(soundIndicator);
    
    participant.appendChild(avatar);
    participant.appendChild(username);
    
    // Добавляем ползунок громкости только для других участников
    if (!data.isCurrentUser) {
        const volumeContainer = document.createElement('div');
        volumeContainer.className = 'volume-slider-container';
        
        const volumeSlider = document.createElement('input');
        volumeSlider.type = 'range';
        volumeSlider.className = 'volume-slider';
        volumeSlider.min = '0';
        volumeSlider.max = '250';
        volumeSlider.value = '100';
        volumeSlider.step = '1';
        volumeSlider.setAttribute('data-peer-id', data.peer_id);
        volumeSlider.style.setProperty('--progress', '40%'); // Initial progress
        
        const volumeValue = document.createElement('span');
        volumeValue.className = 'volume-value';
        volumeValue.textContent = '100%';
        volumeValue.setAttribute('data-peer-id', data.peer_id);
        
        volumeContainer.appendChild(volumeSlider);
        volumeContainer.appendChild(volumeValue);
        
        participant.appendChild(volumeContainer);
    }
    
    participant.appendChild(indicators);
    return participant;
}

// Обновление индикатора микрофона текущего пользователя
function updateCurrentUserMicIndicator() {
    const currentUserElement = document.querySelector(`[data-peer-id="${peerId}"]`);
    if (!currentUserElement) return;
    
    const micIndicator = currentUserElement.querySelector('.mic-indicator');
    if (!micIndicator) return;
    
    if (isMicMuted) {
        micIndicator.classList.add('muted');
    } else {
        micIndicator.classList.remove('muted');
    }
}

// Обновление индикатора звука текущего пользователя
function updateCurrentUserSoundIndicator() {
    const currentUserElement = document.querySelector(`[data-peer-id="${peerId}"]`);
    if (!currentUserElement) return;
    
    const soundIndicator = currentUserElement.querySelector('.sound-indicator');
    if (!soundIndicator) return;
    
    if (isDeafened) {
        soundIndicator.classList.add('deafened');
    } else {
        soundIndicator.classList.remove('deafened');
    }
}

// Обработка обновления статуса участника
function handlePeerStatusUpdate(data) {
    const peerId = data.peer_id;
    const isMicMuted = data.is_mic_muted;
    const isDeafened = data.is_deafened;
    
    // Обновляем индикаторы участника
    updatePeerStatusIndicators(peerId, isMicMuted, isDeafened);
}

// Обновление индикаторов статуса для других участников
function updatePeerStatusIndicators(peerId, isMicMuted, isDeafened) {
    const participantElement = document.querySelector(`[data-peer-id="${peerId}"]`);
    if (!participantElement) return;
    
    const micIndicator = participantElement.querySelector('.mic-indicator');
    const soundIndicator = participantElement.querySelector('.sound-indicator');
    
    if (micIndicator) {
        if (isMicMuted) {
            micIndicator.classList.add('muted');
        } else {
            micIndicator.classList.remove('muted');
        }
    }
    
    if (soundIndicator) {
        if (isDeafened) {
            soundIndicator.classList.add('deafened');
        } else {
            soundIndicator.classList.remove('deafened');
        }
    }
}

// Обновление индикаторов при обновлении списка участников
function updateParticipantsList() {
    if (!participantsListEl) return;
    
    // Очищаем список
    participantsListEl.innerHTML = '';
    
    // Добавляем текущего пользователя
    const currentUserElement = createParticipantElement({
        peer_id: peerId,
        username: currentUsername,
        isCurrentUser: true
    });
    participantsListEl.appendChild(currentUserElement);
    
    // Добавляем других участников
    Object.keys(connectedPeers).forEach(peerId => {
        const peerInfo = connectedPeers[peerId];
        if (peerInfo && peerInfo.peer_id !== window.appState.peerId) {
            const participantElement = createParticipantElement({
                peer_id: peerId,
                username: peerInfo.username,
                isCurrentUser: false
            });
            participantsListEl.appendChild(participantElement);
        }
    });
    
    // Обновляем индикаторы текущего пользователя после обновления списка
    updateCurrentUserMicIndicator();
    updateCurrentUserSoundIndicator();
}

// Обработчик изменения ползунка громкости
document.addEventListener('input', (e) => {
    if (e.target.classList.contains('volume-slider')) {
        const peerId = e.target.getAttribute('data-peer-id');
        const volume = parseInt(e.target.value);
        setPeerVolume(peerId, volume);
        
        // Update progress bar
        const progress = (volume / 250) * 100;
        e.target.style.setProperty('--progress', `${progress}%`);
    }
});

window.appState = {
    ws,
    peerConnections,
    currentRoom,
    currentUsername,
    peerId,
    getLocalStream,
    log,
    silenceDetector,
    toggleSilenceDetection,
    peerVolumes,
    updateParticipantsList
};

// Функция запуска демонстрации экрана
async function startScreenShare() {
    try {
        log('🖥️ Запрос на захват экрана...');
        
        // Запрашиваем доступ к экрану
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                mediaSource: 'screen',
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        });
        
        log('✓ Демонстрация экрана запущена');
        isScreenSharing = true;
        
        // Обновляем состояние кнопок
        startScreenShareBtn.disabled = true;
        stopScreenShareBtn.disabled = false;
        
        // Отправляем уведомление о начале демонстрации
        sendWsMessage({
            type: 'screen_share_start',
            peer_id: peerId,
            username: currentUsername
        });
        
        // Создаем отдельные соединения для демонстрации экрана
        await createScreenShareConnections();
        
        // Добавляем свою демонстрацию в список
        addScreenShare(peerId, currentUsername, screenStream);
        
        // Обработчик остановки демонстрации
        screenStream.getVideoTracks()[0].addEventListener('ended', () => {
            log('⚠ Демонстрация экрана остановлена пользователем');
            stopScreenShare();
        });
        
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            log('❌ Доступ к экрану запрещен');
        } else if (err.name === 'NotFoundError') {
            log('❌ Источник экрана не найден');
        } else {
            log(`❌ Ошибка захвата экрана: ${err.message}`);
        }
        console.error('Screen share error:', err);
    }
}

// Функция остановки демонстрации экрана
async function stopScreenShare() {
    if (!isScreenSharing) return;
    
    log('⏹️ Остановка демонстрации экрана...');
    
    // Отправляем уведомление об остановке демонстрации
    sendWsMessage({
        type: 'screen_share_stop',
        peer_id: peerId,
        username: currentUsername
    });
    
    // Останавливаем поток
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    // Закрываем соединения для демонстрации
    Object.keys(screenPeerConnections).forEach(id => {
        if (screenPeerConnections[id]) {
            screenPeerConnections[id].close();
        }
    });
    screenPeerConnections = {};
    
    // Удаляем свою демонстрацию из списка
    removeScreenShare(peerId);
    
    isScreenSharing = false;
    
    // Обновляем состояние кнопок
    startScreenShareBtn.disabled = false;
    stopScreenShareBtn.disabled = true;
    
    log('✓ Демонстрация экрана остановлена');
}

// Создание соединений для демонстрации экрана
async function createScreenShareConnections() {
    if (!screenStream) return;
    
    // Создаем соединения для демонстрации экрана с каждым участником
    Object.keys(connectedPeers).forEach(async (peerId) => {
        if (peerId !== window.appState.peerId) {
            await createScreenShareConnection(peerId);
        }
    });
}

// Создание отдельного соединения для демонстрации экрана
async function createScreenShareConnection(targetPeerId) {
    log(`Создание соединения для демонстрации экрана с ${targetPeerId}`);
    
    const pc = new RTCPeerConnection(iceServers);
    screenPeerConnections[targetPeerId] = pc;
    
    // Добавляем видеотрек экрана
    if (screenStream) {
        screenStream.getTracks().forEach(track => {
            if (track.kind === 'video') {
                pc.addTrack(track, screenStream);
                log('✓ Видео-трек экрана добавлен в соединение');
            }
        });
    }
    
    // Обработка ICE кандидатов
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendWsMessage({
                type: 'screen_signal',
                target: targetPeerId,
                data: {
                    type: 'candidate',
                    candidate: event.candidate
                }
            });
        }
    };
    
    // Получение удаленного потока
    pc.ontrack = (event) => {
        log(`✓ Получен видеопоток экрана от ${targetPeerId}`);
        const peerInfo = connectedPeers[targetPeerId];
        if (peerInfo) {
            addScreenShare(targetPeerId, peerInfo.username, event.streams[0]);
        }
    };
    
    // Создаем предложение
    try {
        const offer = await pc.createOffer({
            offerToReceiveVideo: true,
            offerToReceiveAudio: false
        });
        
        await pc.setLocalDescription(offer);
        
        sendWsMessage({
            type: 'screen_signal',
            target: targetPeerId,
            data: {
                type: 'offer',
                sdp: pc.localDescription
            }
        });
        
        log(`Отправлен screen offer для ${targetPeerId}`);
    } catch (err) {
        log(`Ошибка создания screen offer: ${err.message}`);
    }
}

// Добавление демонстрации экрана в список
function addScreenShare(peerId, username, stream) {
    // Удаляем старую демонстрацию, если есть
    removeScreenShare(peerId);
    
    const screenShareItem = document.createElement('div');
    screenShareItem.className = 'screen-share-item';
    screenShareItem.id = `screen-share-${peerId}`;
    
    const header = document.createElement('div');
    header.className = 'screen-share-header';
    
    const userInfo = document.createElement('div');
    userInfo.className = 'screen-share-user';
    userInfo.innerHTML = `<span>📺</span><span>${username}</span>`;
    
    header.appendChild(userInfo);
    
    // Создаем контейнер для видео и элементов управления
    const videoContainer = document.createElement('div');
    videoContainer.className = 'screen-video-container';
    
    const video = document.createElement('video');
    video.className = 'screen-share-video';
    video.autoplay = true;
    video.muted = (peerId !== window.appState.peerId); // Отключаем звук для чужих демонстраций
    video.srcObject = stream;
    
    // Создаем элементы управления плеером
    const controls = document.createElement('div');
    controls.className = 'screen-player-controls';
    
    // Ползунок громкости
    const volumeIcon = document.createElement('span');
    volumeIcon.className = 'screen-volume-icon';
    volumeIcon.textContent = '🔊';
    
    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.className = 'screen-volume-slider';
    volumeSlider.min = '0';
    volumeSlider.max = '100';
    volumeSlider.value = '100';
    volumeSlider.step = '1';
    volumeSlider.setAttribute('data-peer-id', peerId);
    volumeSlider.style.setProperty('--progress', '100%'); // Initial progress
    
    const volumeValue = document.createElement('span');
    volumeValue.className = 'screen-volume-value';
    volumeValue.textContent = '100%';
    volumeValue.setAttribute('data-peer-id', peerId);
    
    // Кнопки управления
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'screen-control-buttons';
    buttonsContainer.appendChild(volumeIcon);
    buttonsContainer.appendChild(volumeSlider);
    buttonsContainer.appendChild(volumeValue);
    
    // Кнопка выноса в отдельное окно
    const popoutBtn = document.createElement('button');
    popoutBtn.className = 'screen-popout-btn';
    popoutBtn.innerHTML = '⧉';
    popoutBtn.setAttribute('data-peer-id', peerId);
    buttonsContainer.appendChild(popoutBtn);
    
    // Кнопка полноэкранного режима
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'screen-fullscreen-btn';
    fullscreenBtn.innerHTML = '⛶';
    fullscreenBtn.setAttribute('data-peer-id', peerId);
    buttonsContainer.appendChild(fullscreenBtn);
    

    // Кнопка остановки (только для своей демонстрации)
    if (peerId === window.appState.peerId) {
        const stopBtn = document.createElement('button');
        stopBtn.className = 'screen-stop-btn';
        stopBtn.innerHTML = '⏹️';
        stopBtn.onclick = () => stopScreenShare();
        buttonsContainer.appendChild(stopBtn);
    }
    
    controls.appendChild(buttonsContainer);
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(controls);
    
    screenShareItem.appendChild(header);
    screenShareItem.appendChild(videoContainer);
    
    screenSharesListEl.appendChild(screenShareItem);
    
    // Сохраняем информацию о демонстрации
    peerScreenShares[peerId] = {
        username,
        stream,
        element: screenShareItem,
        video: video,
        volumeSlider: volumeSlider
    };
    
    // Инициализируем обработчики
    initializePlayerControls(peerId);
}

// Удаление демонстрации экрана из списка
function removeScreenShare(peerId) {
    const existingItem = document.getElementById(`screen-share-${peerId}`);
    if (existingItem) {
        existingItem.remove();
    }
    
    if (peerScreenShares[peerId]) {
        // Останавливаем треки, если это не наш поток
        if (peerScreenShares[peerId].stream && peerId !== window.appState.peerId) {
            peerScreenShares[peerId].stream.getTracks().forEach(track => track.stop());
        }
        delete peerScreenShares[peerId];
    }
}

// Обработка сигналов для демонстрации экрана
async function handleScreenSignal(data) {
    const senderId = data.sender;
    const message = data.data;
    
    let pc = screenPeerConnections[senderId];
    
    if (!pc && message.type === 'offer') {
        pc = await createScreenShareAnswerConnection(senderId);
    }
    
    if (!pc) {
        log(`Ошибка: нет screen соединения с ${senderId}`);
        return;
    }
    
    try {
        if (message.type === 'offer') {
            log(`Получен screen offer от ${senderId}`);
            await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            sendWsMessage({
                type: 'screen_signal',
                target: senderId,
                data: {
                    type: 'answer',
                    sdp: pc.localDescription
                }
            });
            
        } else if (message.type === 'answer') {
            log(`Получен screen answer от ${senderId}`);
            await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
            
        } else if (message.type === 'candidate') {
            log(`Получен screen ICE candidate от ${senderId}`);
            await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
    } catch (err) {
        log(`Ошибка обработки screen сигнала: ${err.message}`);
    }
}

// Создание ответного соединения для демонстрации экрана
async function createScreenShareAnswerConnection(senderId) {
    const pc = new RTCPeerConnection(iceServers);
    screenPeerConnections[senderId] = pc;
    
    // Обработка ICE кандидатов
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendWsMessage({
                type: 'screen_signal',
                target: senderId,
                data: {
                    type: 'candidate',
                    candidate: event.candidate
                }
            });
        }
    };
    
    // Получение удаленного потока
    pc.ontrack = (event) => {
        log(`✓ Получен видеопоток экрана от ${senderId}`);
        const peerInfo = connectedPeers[senderId];
        if (peerInfo) {
            addScreenShare(senderId, peerInfo.username, event.streams[0]);
        }
    };
    
    return pc;
}

// Обработка начала демонстрации экрана от другого участника
function handleScreenShareStart(data) {
    log(`📺 ${data.username} начал демонстрацию экрана`);
    
    // Если мы еще не в демонстрации, создаем соединение для получения
    if (!isScreenSharing) {
        // Ничего не делаем, ждем offer от другого участника
    }
}

// Обработка остановки демонстрации экрана от другого участника
function handleScreenShareStop(data) {
    log(`📺 ${data.username} остановил демонстрацию экрана`);
    
    // Удаляем демонстрацию из списка
    removeScreenShare(data.peer_id);
    
    // Закрываем соединение
    if (screenPeerConnections[data.peer_id]) {
        screenPeerConnections[data.peer_id].close();
        delete screenPeerConnections[data.peer_id];
    }
}

// Обработчики кнопок демонстрации экрана
if (startScreenShareBtn) {
    startScreenShareBtn.addEventListener('click', startScreenShare);
}

if (stopScreenShareBtn) {
    stopScreenShareBtn.addEventListener('click', stopScreenShare);
}

// Инициализация элементов управления плеером
function initializePlayerControls(peerId) {
    const screenShareData = peerScreenShares[peerId];
    if (!screenShareData) return;
    
    const { video, volumeSlider } = screenShareData;
    
    // Обработчик изменения громкости
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value);
            const volumeValue = document.querySelector(`.screen-volume-value[data-peer-id="${peerId}"]`);
            if (volumeValue) {
                volumeValue.textContent = `${volume}%`;
            }
            
            // Update progress bar
            e.target.style.setProperty('--progress', `${volume}%`);
            
            // Устанавливаем громкость видео
            if (video) {
                video.volume = volume / 100;
            }
            
            log(`Громкость демонстрации ${peerId} установлена на ${volume}%`);
        });
    }
    
    // Обработчик полноэкранного режима
    const fullscreenBtn = document.querySelector(`.screen-fullscreen-btn[data-peer-id="${peerId}"]`);
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            toggleFullscreen(video, fullscreenBtn);
        });
    }
    
    // Обработчик выноса в отдельное окно
    const popoutBtn = document.querySelector(`.screen-popout-btn[data-peer-id="${peerId}"]`);
    if (popoutBtn) {
        popoutBtn.addEventListener('click', () => {
            openPopoutWindow(peerId, screenShareData);
        });
    }
}

// Переключение полноэкранного режима
function toggleFullscreen(videoElement, buttonElement) {
    try {
        if (!document.fullscreenElement) {
            // Входим в полноэкранный режим с контейнером, чтобы сохранить элементы управления
            const container = videoElement.closest('.screen-video-container');
            const elementToFullscreen = container || videoElement;
            
            if (elementToFullscreen.requestFullscreen) {
                elementToFullscreen.requestFullscreen();
            } else if (elementToFullscreen.webkitRequestFullscreen) {
                elementToFullscreen.webkitRequestFullscreen();
            } else if (elementToFullscreen.mozRequestFullScreen) {
                elementToFullscreen.mozRequestFullScreen();
            } else if (elementToFullscreen.msRequestFullscreen) {
                elementToFullscreen.msRequestFullscreen();
            }
            
            if (buttonElement) {
                buttonElement.innerHTML = '⛶';
            }
            log('✓ Включен полноэкранный режим');
        } else {
            // Выходим из полноэкранного режима
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
            
            if (buttonElement) {
                buttonElement.innerHTML = '⛶';
            }
            log('✓ Выключен полноэкранный режим');
        }
    } catch (err) {
        log(`❌ Ошибка переключения полноэкранного режима: ${err.message}`);
    }
}

// Открытие демонстрации в отдельном окне
function openPopoutWindow(peerId, screenShareData) {
    try {
        const { username, stream } = screenShareData;
        
        // Создаем HTML для нового окна
        const popoutHTML = `
            <!DOCTYPE html>
            <html lang="ru">
            <head>
                <meta charset="UTF-8">
                <title>Демонстрация экрана - ${username}</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body {
                        background: #1e1e2e;
                        color: white;
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                    }
                    .header {
                        background: rgba(255, 165, 26, 0.2);
                        padding: 10px 15px;
                        border-bottom: 1px solid rgba(255, 165, 26, 0.3);
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                    }
                    .header-title {
                        font-weight: 600;
                        color: #faa61a;
                    }
                    .controls {
                        display: flex;
                        gap: 10px;
                        padding: 10px 15px;
                        background: rgba(255, 255, 255, 0.05);
                        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    }
                    .volume-container {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    .volume-slider {
                        width: 100px;
                    }
                    button {
                        padding: 5px 10px;
                        background: #7289da;
                        color: white;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                        font-size: 12px;
                    }
                    button:hover { background: #5b6eae; }
                    .video-container {
                        flex: 1;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: #000;
                    }
                    video {
                        max-width: 100%;
                        max-height: 100%;
                        background: #000;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="header-title">📺 ${username}</div>
                    <button onclick="toggleFullscreen()">⛶ Полный экран</button>
                </div>
                <div class="controls">
                    <div class="volume-container">
                        <span>🔊</span>
                        <input type="range" class="volume-slider" min="0" max="100" value="100" step="1">
                        <span class="volume-value">100%</span>
                    </div>
                </div>
                <div class="video-container">
                    <video autoplay muted></video>
                </div>
                <script>
                    const video = document.querySelector('video');
                    const volumeSlider = document.querySelector('.volume-slider');
                    const volumeValue = document.querySelector('.volume-value');
                    
                    // Ждем загрузки окна и устанавливаем видеопоток
                    window.addEventListener('load', () => {
                        if (window.streamData) {
                            // Клонируем поток, чтобы не останавливать оригинальный
                            const stream = window.streamData;
                            const videoTracks = stream.getVideoTracks();
                            const audioTracks = stream.getAudioTracks();
                            
                            // Создаем новый поток с клонированными треками
                            const clonedStream = new MediaStream();
                            
                            videoTracks.forEach(track => {
                                // Используем оригинальный трек (не клонируем)
                                clonedStream.addTrack(track);
                            });
                            
                            audioTracks.forEach(track => {
                                clonedStream.addTrack(track);
                            });
                            
                            video.srcObject = clonedStream;
                            video.play().catch(err => console.error('Video play error:', err));
                        } else {
                            console.error('No streamData available');
                        }
                    });
                    
                    // Обработчик громкости
                    volumeSlider.addEventListener('input', (e) => {
                        const volume = parseInt(e.target.value);
                        volumeValue.textContent = volume + '%';
                        video.volume = volume / 100;
                    });
                    
                    // Переключение полноэкранного режима
                    function toggleFullscreen() {
                        if (!document.fullscreenElement) {
                            video.requestFullscreen().catch(err => console.error(err));
                        } else {
                            document.exitFullscreen();
                        }
                    }
                    
                    // Обработчик закрытия окна
                    window.addEventListener('beforeunload', () => {
                        // Не останавливаем треки, чтобы основной поток продолжал работать
                        // Просто очищаем ссылку
                        if (video.srcObject) {
                            video.srcObject = null;
                        }
                    });
                </script>
            </body>
            </html>
        `;
        
        // Открываем новое окно
        const popoutWindow = window.open('', `screen-popout-${peerId}`,
            'width=800,height=600,scrollbars=no,resizable=yes');
        
        if (!popoutWindow) {
            log('❌ Не удалось открыть новое окно. Разрешите всплывающие окна.');
            return;
        }
        
        // Записываем HTML в новое окно
        popoutWindow.document.write(popoutHTML);
        popoutWindow.document.close();
        
        // Передаем поток в новое окно
        popoutWindow.streamData = stream;
        
        log(`✓ Демонстрация ${username} открыта в отдельном окне`);
        
        // Следим за закрытием окна
        const checkClosed = setInterval(() => {
            if (popoutWindow.closed) {
                clearInterval(checkClosed);
                log(`✓ Окно демонстрации ${username} закрыто`);
            }
        }, 1000);
        
    } catch (err) {
        log(`❌ Ошибка открытия отдельного окна: ${err.message}`);
    }
}

// Обработчик изменения громкости для демонстраций
document.addEventListener('input', (e) => {
    if (e.target.classList.contains('screen-volume-slider')) {
        const peerId = e.target.getAttribute('data-peer-id');
        const volume = parseInt(e.target.value);
        const volumeValue = document.querySelector(`.screen-volume-value[data-peer-id="${peerId}"]`);
        
        if (volumeValue) {
            volumeValue.textContent = `${volume}%`;
        }
        
        // Update progress bar
        e.target.style.setProperty('--progress', `${volume}%`);
        
        // Устанавливаем громкость для видео
        const screenShareData = peerScreenShares[peerId];
        if (screenShareData && screenShareData.video) {
            screenShareData.video.volume = volume / 100;
        }
    }
});