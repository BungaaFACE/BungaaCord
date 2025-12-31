// app.js - WebSocket клиент для Discord-like голосового чата

let ws = null;
let localStream = null;
let peerConnections = {};
let currentRoom = '';
let currentUsername = '';
let peerId = generatePeerId(); // Уникальный ID для текущего клиента
let audioContext = null;
let audioAnalyser = null;
let silenceDetector = null;
let isSilenceDetectionEnabled = true;
let silenceThreshold = 40; // Порог тишины в % (по умолчанию 40%)
let isCurrentlySilent = false;
let currentVolume = 0; // Текущий уровень громкости для отображения (0-100%)
let volumeMeterInterval = null;

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
const peersListEl = document.getElementById('peersList');
const logEl = document.getElementById('log');
const silenceThresholdEl = document.getElementById('silenceThreshold');
const toggleSilenceBtn = document.getElementById('toggleSilenceBtn');
const volumeBarEl = document.getElementById('volumeBar');
const volumeFillEl = document.getElementById('volumeFill');
let isMicMuted = false;
let isDeafened = false;

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
}

// Обработка списка участников
function handlePeers(peers) {
    if (peers.length === 0) {
        peersListEl.textContent = 'Нет других участников';
        return;
    }
    
    const peerNames = peers.map(p => p.username).join(', ');
    peersListEl.textContent = peerNames;
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
    
    // Обновляем список участников
    const currentPeers = peersListEl.textContent;
    if (currentPeers === '-' || currentPeers === 'Нет других участников') {
        peersListEl.textContent = data.username;
    } else {
        peersListEl.textContent = currentPeers + ', ' + data.username;
    }
    
    // Создаем peer connection для нового участника
    if (data.peer_id !== peerId) {
        createPeerConnection(data.peer_id, true);
    }
}

// Обработка выхода участника
function handlePeerLeft(data) {
    log(`➤ ${data.username} покинул комнату`);
    
    // Обновляем список участников
    const currentPeers = peersListEl.textContent.split(', ');
    const newPeers = currentPeers.filter(name => name !== data.username);
    
    if (newPeers.length === 0) {
        peersListEl.textContent = 'Нет других участников';
    } else {
        peersListEl.textContent = newPeers.join(', ');
    }
    
    // Закрываем соединение
    if (peerConnections[data.peer_id]) {
        peerConnections[data.peer_id].close();
        delete peerConnections[data.peer_id];
        log(`Соединение с ${data.username} закрыто`);
    }
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

// Получение доступа к микрофону
async function getLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });
        
        // Инициализация аудио-анализатора для обнаружения тишины
        await initializeSilenceDetection();
        
        log('✓ Микрофон доступен');
        return true;
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            log('❌ Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.');
        } else if (err.name === 'NotFoundError') {
            log('❌ Микрофон не найден');
        } else {
            log(`❌ Ошибка доступа к микрофону: ${err.message}`);
        }
        return false;
    }
}

// Инициализация обнаружения тишины
async function initializeSilenceDetection() {
    if (!localStream) return;
    
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        silenceDetector = new SilenceDetector(audioContext, localStream, silenceThreshold);
        
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
    
    // Показываем/скрываем индикатор в зависимости от громкости
    if (volumePercent > 5) {
        volumeBarEl.style.opacity = '1';
    } else {
        volumeBarEl.style.opacity = '0.5';
    }
}

// Создание RTCPeerConnection
function createPeerConnection(targetPeerId, isInitiator) {
    log(`${isInitiator ? 'Инициируем' : 'Принимаем'} соединение с ${targetPeerId}`);
    
    const pc = new RTCPeerConnection(iceServers);
    peerConnections[targetPeerId] = pc;
    
    // Отправка локального потока с проверкой тишины
    if (localStream) {
        localStream.getTracks().forEach(track => {
            if (track.kind === 'audio') {
                // Создаем обработанный аудио-трек с контролем тишины
                const processedTrack = createSilenceControlledTrack(track);
                pc.addTrack(processedTrack, localStream);
            } else {
                pc.addTrack(track, localStream);
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
        
        // Создаем аудио элемент для воспроизведения
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.controls = false;
        audio.srcObject = event.streams[0];
        
        // Можно добавить в DOM при необходимости
        // document.body.appendChild(audio);
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
    peersListEl.textContent = '-';
    
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
    }
    
    isCurrentlySilent = false;
    currentVolume = 0;
    updateSilenceIndicator(false, -100);
    updateVolumeMeter(0, -100);
    
    log('Покинули комнату');
});

// Управление микрофоном
muteToggleBtn.addEventListener('click', () => {
    if (!localStream) return;
    
    isMicMuted = !isMicMuted;
    
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMicMuted;
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
    
    // Генерируем случайное имя пользователя
    document.getElementById('username').value =
        'User' + Math.floor(Math.random() * 1000);
});

// Экспорт для отладки
window.appState = {
    ws,
    peerConnections,
    currentRoom,
    currentUsername,
    peerId,
    getLocalStream,
    log,
    silenceDetector,
    toggleSilenceDetection
};