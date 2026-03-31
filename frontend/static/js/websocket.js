let ws = null;

// Подключение к WebSocket серверу
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${backendAdress}/ws?user=${currentUserUUID}`;
    
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

// Отправка сообщения на сервер
function sendWsMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    } else {
        console.log('Ошибка: WebSocket не подключен');
    }
}