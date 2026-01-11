

// Функция запуска демонстрации экрана
async function startScreenShare() {
    try {
        console.log('🖥️ Запрос на захват экрана...');
        
        // Запрашиваем доступ к экрану с аудио
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                mediaSource: 'screen',
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            },
            audio: true // Включаем аудио захват
        });
        
        console.log('✓ Демонстрация экрана запущена');
        isScreenSharing = true;
        
        // Добавляем свою демонстрацию в список
        addScreenShare(currentUserUUID, currentUsername, screenStream);
        
        // Обновляем состояние кнопки на панели
        updateVoicePanelButtons();
        
        // Показываем статус "В ЭФИРЕ" у текущего пользователя
        updateUserLiveStatus(currentUserUUID, isScreenSharing);

        // Отправляем статус стрима остальным
        sendStatusUpdate();
        
        // Обработчик остановки демонстрации
        screenStream.getVideoTracks()[0].addEventListener('ended', () => {
            console.log('⚠ Демонстрация экрана остановлена пользователем');
            stopScreenShare();
        });
        
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            console.log('❌ Доступ к экрану запрещен');
        } else if (err.name === 'NotFoundError') {
            console.log('❌ Источник экрана не найден');
        } else {
            console.log(`❌ Ошибка захвата экрана: ${err.message}`);
        }
        console.error('Screen share error:', err);
    }
}

// Функция остановки демонстрации экрана
async function stopScreenShare() {
    if (!isScreenSharing) return;
    
    console.log('⏹️ Остановка демонстрации экрана...');
    
    // Отправляем уведомление об остановке демонстрации
    sendWsMessage({
        type: 'screen_share_stop'
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
    removeScreenShare(currentUserUUID);
    
    isScreenSharing = false;
    
    // Обновляем состояние кнопки на панели
    updateVoicePanelButtons();
    
    // Скрываем статус "В ЭФИРЕ" у текущего пользователя
    updateUserLiveStatus(currentUserUUID, isScreenSharing);

    // Отправляем статус стрима остальным
    sendStatusUpdate();
    
    console.log('✓ Демонстрация экрана остановлена');
}

function sendDemonstrationRequest(target_uuid) {
    console.log(`Запрос демонстрации экрана для пользователя ${target_uuid}`);
    
    if (target_uuid in connectedPeers) {
        sendWsMessage({
            type: 'screen_share_request',
            target: target_uuid
        });
    } else if (target_uuid === currentUserUUID) {
        // Если это запрос на собственную трансляцию, просто добавляем ее в список
        if (screenStream) {
            addScreenShare(currentUserUUID, currentUsername, screenStream);
        } else {
            console.log(`⚠️ Трансляция экрана не запущена для ${currentUserUUID}`);
        }
    } else {
        console.log(`⚠️ Пользователь ${target_uuid} не найден в подключенных`);
        alert('Вы должны быть в том же голосовом канале, что и владелец трансляции.')
    }
}

// Создание отдельного соединения для демонстрации экрана
async function createScreenShareConnection(targetPeerUuid) {
    console.log(`Создание соединения для демонстрации экрана с ${targetPeerUuid}`);
    
    const pc = new RTCPeerConnection(iceServers);
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
        console.log(`✓ Получен видеопоток экрана от ${targetPeerUuid}`);
        try {
            const peerInfo = connectedPeers[targetPeerUuid];
            console.log('EEEEEEEEEEEEEEEEEEEEEEEEEEEEE')
            console.log(peerInfo)
            console.log(event)
            if (peerInfo) {
                addScreenShare(targetPeerUuid, peerInfo.username, event.streams[0]);
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


// Добавление демонстрации экрана в список
function addScreenShare(peerUuid, username, stream) {
    // Удаляем старую демонстрацию, если есть
    removeScreenShare(peerUuid);
    
    const screenShareItem = document.createElement('div');
    screenShareItem.className = 'screen-share-item';
    screenShareItem.id = `screen-share-${peerUuid}`;
    screenShareItem.style.maxWidth = 'max-content'
    
    const header = document.createElement('div');
    header.className = 'screen-share-header';
    
    const userInfo = document.createElement('div');
    userInfo.className = 'screen-share-user';
    userInfo.innerHTML = `<span>📺</span><span>${username}</span>`;
    
    header.appendChild(userInfo);
    
    // Добавляем крестик для закрытия трансляции
    const closeBtn = document.createElement('button');
    closeBtn.className = 'screen-share-close-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.setAttribute('data-peer-uuid', peerUuid);
    closeBtn.title = 'Закрыть трансляцию';
    header.appendChild(closeBtn);
    
    // Создаем контейнер для видео и элементов управления
    const videoContainer = document.createElement('div');
    videoContainer.className = 'screen-video-container';
    
    const video = document.createElement('video');
    video.className = 'screen-share-video';
    video.autoplay = true;
    video.muted = false;
    video.srcObject = stream;
    
    // Создаем элементы управления плеером
    const controls = document.createElement('div');
    controls.className = 'screen-player-controls';
    
    // Кнопки управления
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'screen-control-buttons';

    // Иконка громкости (кликабельная)
    const volumeIcon = document.createElement('span');
    volumeIcon.className = 'screen-volume-icon';
    volumeIcon.textContent = '🔊';
    volumeIcon.setAttribute('data-peer-uuid', peerUuid);
    volumeIcon.style.cursor = 'pointer';
    volumeIcon.title = 'Переключить звук';
    
    // Ползунок громкости
    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.className = 'screen-volume-slider';
    volumeSlider.min = '0';
    volumeSlider.max = '100';
    volumeSlider.value = '100';
    volumeSlider.step = '2';
    volumeSlider.setAttribute('data-peer-uuid', peerUuid);
    volumeSlider.style.setProperty('--progress', '100%'); // Initial progress
    
    const volumeValue = document.createElement('span');
    volumeValue.className = 'screen-volume-value';
    volumeValue.textContent = '100%';
    volumeValue.setAttribute('data-peer-uuid', peerUuid);
    if (peerUuid === currentUserUUID) {
        volumeSlider.value = '0';
        volumeValue.textContent = '0%';
    }
    
    buttonsContainer.appendChild(volumeIcon);
    buttonsContainer.appendChild(volumeSlider);
    buttonsContainer.appendChild(volumeValue);
    
    // Кнопка выноса в отдельное окно
    const popoutBtn = document.createElement('button');
    popoutBtn.className = 'screen-popout-btn';
    popoutBtn.innerHTML = '⧉';
    popoutBtn.setAttribute('data-peer-uuid', peerUuid);
    buttonsContainer.appendChild(popoutBtn);
    
    // Кнопка полноэкранного режима
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'screen-fullscreen-btn';
    fullscreenBtn.innerHTML = '⛶';
    fullscreenBtn.setAttribute('data-peer-uuid', peerUuid);
    buttonsContainer.appendChild(fullscreenBtn);
    

    // Кнопка остановки (только для своей демонстрации)
    if (peerUuid === currentUserUUID) {
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
    peerScreenShares[peerUuid] = {
        username,
        stream,
        element: screenShareItem,
        video: video,
        volumeSlider: volumeSlider,
        volumeIcon: volumeIcon,
        originalVolume: 100, // Сохраняем исходную громкость
        isMuted: false // Состояние звука
    };
    
    // Инициализируем обработчики
    initializePlayerControls(peerUuid);
}

// Удаление демонстрации экрана из списка
function removeScreenShare(peerUuid) {
    const existingItem = document.getElementById(`screen-share-${peerUuid}`);
    if (existingItem) {
        existingItem.remove();
    }
    
    if (peerScreenShares[peerUuid]) {
        // Останавливаем треки, если это не наш поток
        if (peerScreenShares[peerUuid].stream && peerUuid !== currentUserUUID) {
            peerScreenShares[peerUuid].stream.getTracks().forEach(track => track.stop());
        }
        // Очищаем данные о звуке
        delete peerScreenShares[peerUuid].volumeIcon;
        delete peerScreenShares[peerUuid].originalVolume;
        delete peerScreenShares[peerUuid].isMuted;
        delete peerScreenShares[peerUuid];
    }
}

// Обработка сигналов для демонстрации экрана
async function handleScreenSignal(data) {
    const senderUuid = data.sender;
    const message = data.data;
    
    let pc = screenPeerConnections[senderUuid];
    
    if (!pc && message.type === 'offer') {
        pc = await createScreenShareAnswerConnection(senderUuid);
    }
    
    if (!pc) {
        console.log(`Ошибка: нет screen соединения с ${senderUuid}`);
        return;
    }
    
    try {
        if (message.type === 'offer') {
            console.log(`Получен screen offer от ${senderUuid}`);
            await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            sendWsMessage({
                type: 'screen_signal',
                target: senderUuid,
                data: {
                    type: 'answer',
                    sdp: pc.localDescription
                }
            });
            
        } else if (message.type === 'answer') {
            console.log(`Получен screen answer от ${senderUuid}`);
            await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
            
        } else if (message.type === 'candidate') {
            console.log(`Получен screen ICE candidate от ${senderUuid}`);
            await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
    } catch (err) {
        console.log(`Ошибка обработки screen сигнала: ${err.message}`);
    }
}

// Создание ответного соединения для демонстрации экрана
async function createScreenShareAnswerConnection(senderUuid) {
    console.log(`Создание ответного соединения для демонстрации экрана от ${senderUuid}`);
    
    const pc = new RTCPeerConnection(iceServers);
    screenPeerConnections[senderUuid] = pc;
    
    // Обработка ICE кандидатов
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendWsMessage({
                type: 'screen_signal',
                target: senderUuid,
                data: {
                    type: 'candidate',
                    candidate: event.candidate
                }
            });
        }
    };
    
    // Получение удаленного потока
    pc.ontrack = (event) => {
        console.log(`✓ Получен видеопоток экрана от ${senderUuid}`);
        try {
            const peerInfo = connectedPeers[senderUuid];
            console.log('EEEEEEEEEEEEEEEEEEEEEEEEEEEEE')
            console.log(peerInfo)
            console.log(event)
            if (peerInfo) {
                addScreenShare(senderUuid, peerInfo.username, event.streams[0]);
            }
        } catch (err) {
            console.error(`Ошибка обработки pc.ontrack: ${err.message}. Сообщение: ${event.data}. Stack: ${err.stack}`);
        }
    };
    
    console.log(`✓ Ответное соединение для демонстрации экрана создано для ${senderUuid}`);
    return pc;
}

// Обработка начала демонстрации экрана от другого участника
function handleScreenShareStart(data) {
    console.log(`📺 ${data.username} начал демонстрацию экрана`);
    
    // Если мы еще не в демонстрации, создаем соединение для получения
    if (!isScreenSharing) {
        // Ничего не делаем, ждем offer от другого участника
    }
}

// Обработка остановки демонстрации экрана от другого участника
function handleScreenShareStop(data) {
    console.log(`📺 ${data.username} остановил демонстрацию экрана`);
    
    // Удаляем демонстрацию из списка
    removeScreenShare(data.peer_uuid);
    
    // Закрываем соединение
    if (screenPeerConnections[data.peer_uuid]) {
        screenPeerConnections[data.peer_uuid].close();
        delete screenPeerConnections[data.peer_uuid];
    }
}


// Функция обновления иконки звука в зависимости от громкости
function updateVolumeIcon(volumeIcon, volume) {
    if (volume === 0) {
        volumeIcon.textContent = '🔇'; // Перечеркнутый значок звука
    } else if (volume < 50) {
        volumeIcon.textContent = '🔉'; // Низкая громкость
    } else {
        volumeIcon.textContent = '🔊'; // Высокая громкость
    }
}

// Функция переключения звука (вкл/выкл)
function toggleSound(peerUuid) {
    const screenShareData = peerScreenShares[peerUuid];
    if (!screenShareData) return;
    
    const { video, volumeSlider, volumeIcon, originalVolume } = screenShareData;
    const volumeValue = document.querySelector(`.screen-volume-value[data-peer-uuid="${peerUuid}"]`);
    
    if (screenShareData.isMuted) {
        // Включаем звук
        const restoredVolume = originalVolume || 50; // Если исходной громкости нет, ставим 50
        if (volumeSlider) {
            volumeSlider.value = restoredVolume;
            volumeSlider.style.setProperty('--progress', `${restoredVolume}%`);
        }
        if (volumeValue) {
            volumeValue.textContent = `${restoredVolume}%`;
        }
        if (video) {
            video.volume = restoredVolume / 100;
        }
        if (volumeIcon) {
            updateVolumeIcon(volumeIcon, restoredVolume);
        }
        screenShareData.isMuted = false;
        console.log(`Звук демонстрации ${peerUuid} включен, громкость: ${restoredVolume}%`);
    } else {
        // Выключаем звук
        if (volumeSlider) {
            const currentVolume = parseInt(volumeSlider.value);
            screenShareData.originalVolume = currentVolume; // Сохраняем текущую громкость
            volumeSlider.value = 0;
            volumeSlider.style.setProperty('--progress', '0%');
        }
        if (volumeValue) {
            volumeValue.textContent = '0%';
        }
        if (video) {
            video.volume = 0;
        }
        if (volumeIcon) {
            updateVolumeIcon(volumeIcon, 0);
        }
        screenShareData.isMuted = true;
        console.log(`Звук демонстрации ${peerUuid} выключен`);
    }
}

// Инициализация элементов управления плеером
function initializePlayerControls(peerUuid) {
    const screenShareData = peerScreenShares[peerUuid];
    if (!screenShareData) return;
    
    const { video, volumeSlider, volumeIcon } = screenShareData;
    
    // Обработчик клика на иконку звука
    if (volumeIcon) {
        volumeIcon.addEventListener('click', () => {
            toggleSound(peerUuid);
        });
    }
    
    // Обработчик изменения громкости
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value);
            const volumeValue = document.querySelector(`.screen-volume-value[data-peer-uuid="${peerUuid}"]`);
            if (volumeValue) {
                volumeValue.textContent = `${volume}%`;
            }
            
            // Update progress bar
            e.target.style.setProperty('--progress', `${volume}%`);
            
            // Устанавливаем громкость видео
            if (video) {
                video.volume = volume / 100;
            }
            
            // Обновляем иконку звука
            if (volumeIcon) {
                updateVolumeIcon(volumeIcon, volume);
            }
            
            // Если звук был выключен, включаем его
            if (screenShareData.isMuted) {
                screenShareData.isMuted = false;
            }
            
            console.log(`Громкость демонстрации ${peerUuid} установлена на ${volume}%`);
        });
    }
    
    // Обработчик полноэкранного режима
    const fullscreenBtn = document.querySelector(`.screen-fullscreen-btn[data-peer-uuid="${peerUuid}"]`);
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            toggleFullscreen(video, fullscreenBtn);
        });
    }
    
    // Обработчик выноса в отдельное окно
    const popoutBtn = document.querySelector(`.screen-popout-btn[data-peer-uuid="${peerUuid}"]`);
    if (popoutBtn) {
        popoutBtn.addEventListener('click', () => {
            openPopoutWindow(peerUuid, screenShareData);
        });
    }
    
    // Обработчик закрытия трансляции
    const closeBtn = document.querySelector(`.screen-share-close-btn[data-peer-uuid="${peerUuid}"]`);
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            removeScreenShare(peerUuid);
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
            console.log('✓ Включен полноэкранный режим');
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
            console.log('✓ Выключен полноэкранный режим');
        }
    } catch (err) {
        console.log(`❌ Ошибка переключения полноэкранного режима: ${err.message}`);
    }
}

// Открытие демонстрации в отдельном окне
function openPopoutWindow(peerUuid, screenShareData) {
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
                        <span class="volume-icon" style="cursor: pointer;" title="Переключить звук">🔊</span>
                        <input type="range" class="volume-slider" min="0" max="100" value="100" step="2">
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
                    const volumeIcon = document.querySelector('.volume-icon');
                    
                    let isMuted = false;
                    let originalVolume = 100;
                    
                    // Функция обновления иконки звука
                    function updateVolumeIcon(volume) {
                        if (volume === 0) {
                            volumeIcon.textContent = '🔇';
                        } else if (volume < 50) {
                            volumeIcon.textContent = '🔉';
                        } else {
                            volumeIcon.textContent = '🔊';
                        }
                    }
                    
                    // Функция переключения звука
                    function toggleSound() {
                        if (isMuted) {
                            // Включаем звук
                            const restoredVolume = originalVolume || 50;
                            volumeSlider.value = restoredVolume;
                            volumeValue.textContent = restoredVolume + '%';
                            video.volume = restoredVolume / 100;
                            updateVolumeIcon(restoredVolume);
                            isMuted = false;
                        } else {
                            // Выключаем звук
                            const currentVolume = parseInt(volumeSlider.value);
                            originalVolume = currentVolume;
                            volumeSlider.value = 0;
                            volumeValue.textContent = '0%';
                            video.volume = 0;
                            updateVolumeIcon(0);
                            isMuted = true;
                        }
                    }
                    
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
                        updateVolumeIcon(volume);
                        
                        // Если звук был выключен, включаем его
                        if (isMuted) {
                            isMuted = false;
                        }
                    });
                    
                    // Обработчик клика на иконку звука
                    volumeIcon.addEventListener('click', toggleSound);
                    
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
        const popoutWindow = window.open('', `screen-popout-${peerUuid}`,
            'width=800,height=600,scrollbars=no,resizable=yes');
        
        if (!popoutWindow) {
            console.log('❌ Не удалось открыть новое окно. Разрешите всплывающие окна.');
            return;
        }
        
        // Записываем HTML в новое окно
        popoutWindow.document.write(popoutHTML);
        popoutWindow.document.close();
        
        // Передаем поток в новое окно
        popoutWindow.streamData = stream;
        
        console.log(`✓ Демонстрация ${username} открыта в отдельном окне`);
        
        // Следим за закрытием окна
        const checkClosed = setInterval(() => {
            if (popoutWindow.closed) {
                clearInterval(checkClosed);
                console.log(`✓ Окно демонстрации ${username} закрыто`);
            }
        }, 1000);
        
    } catch (err) {
        console.log(`❌ Ошибка открытия отдельного окна: ${err.message}`);
    }
}
