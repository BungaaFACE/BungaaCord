// app.js - WebSocket клиент для Discord-like голосового чата

let ws = null;
let localStream = null;
let peerConnections = {};
let currentRoom = '';
let currentUsername = '';
let peerId = generatePeerId(); // Уникальный ID для текущего клиента

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
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const muteBtn = document.getElementById('muteBtn');
const unmuteBtn = document.getElementById('unmuteBtn');
const statusEl = document.getElementById('status');
const roomNameEl = document.getElementById('roomName');
const peersListEl = document.getElementById('peersList');
const logEl = document.getElementById('log');

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
    muteBtn.disabled = false;
    unmuteBtn.disabled = false;
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

// Создание RTCPeerConnection
function createPeerConnection(targetPeerId, isInitiator) {
    log(`${isInitiator ? 'Инициируем' : 'Принимаем'} соединение с ${targetPeerId}`);
    
    const pc = new RTCPeerConnection(iceServers);
    peerConnections[targetPeerId] = pc;
    
    // Отправка локального потока
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
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
    muteBtn.disabled = true;
    unmuteBtn.disabled = true;
    
    // Закрываем все peer соединения
    Object.keys(peerConnections).forEach(id => {
        peerConnections[id].close();
    });
    peerConnections = {};
    
    // Останавливаем локальный поток
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    log('Покинули комнату');
});

// Управление микрофоном
muteBtn.addEventListener('click', () => {
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = false;
        });
        log('🔇 Микрофон выключен');
        muteBtn.disabled = true;
        unmuteBtn.disabled = false;
    }
});

unmuteBtn.addEventListener('click', () => {
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = true;
        });
        log('🎤 Микрофон включен');
        muteBtn.disabled = false;
        unmuteBtn.disabled = true;
    }
});

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
    muteBtn.disabled = true;
    unmuteBtn.disabled = true;
    
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
    log
};