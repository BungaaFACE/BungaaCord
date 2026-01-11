

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

// Получение доступа к микрофону
async function getLocalStream() {
    try {
        console.log('🔊 Запрос доступа к микрофону...');
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true, // Базовый шумодав браузера
                autoGainControl: true
            },
            video: false
        });
        
        console.log('✓ Микрофон доступен');
        console.log('Local stream tracks:', localStream.getTracks().length);
        
        // Инициализация продвинутого шумодава
        await initializeNoiseSuppression();
        
        // Инициализация аудио-анализатора для обнаружения тишины
        await initializeSilenceDetection();
        
        console.log('✓ Все системы активированы');
        return true;
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            console.log('❌ Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.');
        } else if (err.name === 'NotFoundError') {
            console.log('❌ Микрофон не найден');
        } else {
            console.log(`❌ Ошибка доступа к микрофону: ${err.message}`);
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
        console.log('✓ Продвинутый шумодав инициализирован');
        
    } catch (err) {
        console.log(`⚠ Ошибка инициализации шумодава: ${err.message}`);
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
            updateSilenceIndicator(isSilent, volume);
        };
        
        silenceDetector.startDetection(100);
        console.log('✓ Детектор тишины активирован');
    } catch (err) {
        console.log(`⚠ Ошибка инициализации детектора тишины: ${err.message}`);
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
        console.log(`⚠ Ошибка создания контролируемого трека: ${err.message}`);
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
    console.log(isSilenceDetectionEnabled ? '✓ Детектор тишины включен' : '✗ Детектор тишины отключен');
    
    // Сохраняем настройки
    saveSilenceSettings();
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
    
    console.log(isNoiseSuppressionEnabled ? '✓ Шумодав включен' : '✗ Шумодав отключен');
    
    // Сохраняем настройки
    saveNoiseSuppressionSettings();
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
    
    console.log(`✓ Режим шумодава изменен на: ${modeLabels[noiseSuppressionMode]}`);
    
    // Сохраняем настройки
    saveNoiseSuppressionSettings();
}


// Перезапуск профилирования шума
function restartNoiseProfiling() {
    if (noiseSuppressor) {
        noiseSuppressor.restartProfiling();
        console.log('🔊 Перезапуск анализа фонового шума...');
    }
}

// Обработка клика по каналу
async function handleChannelClick(roomName, channelElement) {
    if (currentRoom === roomName) {
        // Уже в этом канале, ничего не делаем
        return;
    }
    
    if (currentRoom) {
        // Покидаем текущий канал
        await leaveCurrentRoom();
    }
    
    // Присоединяемся к новому каналу
    await joinRoom(roomName, channelElement);
}

// Присоединение к комнате
async function joinRoom(roomName, channelElement) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Нет подключения к серверу');
        return;
    }

    // Убеждаемся, что данные пользователя загружены
    if (!currentUsername || !currentUserUUID) {
        console.log('⚠ Данные пользователя не загружены, загружаем...');
        const userLoaded = await loadCurrentUser();
        if (!userLoaded) {
            alert('Ошибка: не удалось загрузить данные пользователя');
            return;
        }
    }

    // Если микрофон еще не доступен, запрашиваем его
    if (!localStream) {
        const hasStream = await getLocalStream();
        if (!hasStream) {
            alert('Не удалось получить доступ к микрофону');
            return;
        }
    } else {
        // Если микрофон уже доступен (из настроек), просто обновляем индикаторы
        console.log('✓ Микрофон уже настроен, используем существующий поток');
    }

    // Отправляем запрос на присоединение
    sendWsMessage({
        type: 'join',
        room: roomName
    });

    console.log(`Запрос на присоединение к каналу "${roomName}"...`);

    // Обновляем активный канал
    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
    });

    if (channelElement) {
        channelElement.classList.add('active');
    }
}


// Покидание текущей комнаты
async function leaveCurrentRoom() {
    if (!currentRoom || !currentUsername) {
        return;
    }
    
    sendWsMessage({
        type: 'leave'
    });
    
    // Очищаем состояние комнаты
    currentRoom = '';
    currentUsername = '';
    
    // Сбрасываем активный канал
    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Закрываем все peer соединения
    Object.keys(peerConnections).forEach(id => {
        peerConnections[id].close();
    });
    peerConnections = {};
    
    // Останавливаем шумодав (но не уничтожаем, если он нужен для настроек)
    if (noiseSuppressor) {
        // Не уничтожаем полностью, чтобы сохранить настройки
        noiseSuppressor.setEnabled(false);
    }
    
    // Останавливаем обнаружение тишины (но не уничтожаем)
    if (silenceDetector) {
        silenceDetector.stopDetection();
    }
    
    // Останавливаем интервал измерения громкости
    if (volumeMeterInterval) {
        clearInterval(volumeMeterInterval);
        volumeMeterInterval = null;
    }
    
    // Не закрываем audioContext и не останавливаем localStream,
    // чтобы они оставались доступными для настроек
    
    isCurrentlySilent = false;
    currentVolume = 0;
    updateSilenceIndicator(false, -100);
    updateVolumeMeter(0, -100);
    
    // Очищаем все ресурсы участников
    Object.keys(volumeAnalyzers).forEach(peerUuid => {
        if (volumeAnalyzers[peerUuid].intervalId) {
            clearInterval(volumeAnalyzers[peerUuid].intervalId);
        }
        if (volumeAnalyzers[peerUuid].source) {
            volumeAnalyzers[peerUuid].source.disconnect();
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
    Object.keys(peerScreenShares).forEach(peerUuid => {
        removeScreenShare(peerUuid);
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
    
    // Скрываем панель управления голосовым каналом
    hideVoiceControlPanel();
    
    console.log('Покинули канал (микрофон остается доступным для настроек)');
}

// Запрос доступа к микрофону для настроек
async function requestMicrophoneAccessForSettings() {
    try {
        console.log('🔊 Запрос доступа к микрофону для настроек...');
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });
        
        localStream = stream;
        console.log('✓ Микрофон доступен для настроек');
        
        // Инициализируем шумодав
        await initializeNoiseSuppression();
        
        // Инициализируем детектор тишины
        await initializeSilenceDetection();
        
        // Обновляем индикаторы в настройках
        updateSettingsIndicators();
        
        return true;
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            console.log('❌ Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.');
        } else if (err.name === 'NotFoundError') {
            console.log('❌ Микрофон не найден');
        } else {
            console.log(`❌ Ошибка доступа к микрофону: ${err.message}`);
        }
        console.error('Microphone access error:', err);
        return false;
    }
}

// Создание анализатора громкости для аудиопотока участника
function createVolumeAnalyzer(peerUuid, audioElement) {
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
        peerVolumes[peerUuid] = 0;
        
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
            peerVolumes[peerUuid] = volumePercent;
            
            // Обновляем индикатор
            updatePeerVolumeIndicator(peerUuid, volumePercent);
        }, 100);
        
        volumeAnalyzers[peerUuid] = {
            analyser,
            source,
            intervalId
        };
    } catch (err) {
        console.error('Error creating volume analyzer:', err);
    }
}

// Создание GainNode для регулировки громкости участника
function createGainNodeForPeer(peerUuid, stream) {
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
        peerGainNodes[peerUuid] = {
            gainNode,
            audioContext,
            source
        };
        
        // Восстанавливаем сохраненную громкость для этого участника
        if (peerVolumes[peerUuid] !== undefined && peerVolumes[peerUuid] !== 100) {
            const savedVolume = peerVolumes[peerUuid];
            gainNode.gain.setValueAtTime(savedVolume / 100, audioContext.currentTime);
            console.log(`✓ Восстановлена сохраненная громкость для ${peerUuid}: ${savedVolume}%`);
        }
        
        console.log(`✓ GainNode создан для ${peerUuid}`);
    } catch (err) {
        console.error('Error creating GainNode:', err);
        console.log(`❌ Ошибка создания GainNode для ${peerUuid}: ${err.message}`);
    }
}

// Регулировка громкости участника через GainNode
function setPeerVolume(peerUuid, volume) {
    const gainData = peerGainNodes[peerUuid];
    if (gainData && gainData.gainNode) {
        // Конвертируем проценты в значение gain (0% = 0.0, 100% = 1.0, 250% = 2.5)
        const gainValue = volume / 100;
        
        // Плавно изменяем громкость
        gainData.gainNode.gain.setValueAtTime(gainValue, gainData.audioContext.currentTime);
        
        // Обновляем отображение
        const volumeValueElement = document.querySelector(`.volume-value[data-peer-uuid="${peerUuid}"]`);
        if (volumeValueElement) {
            volumeValueElement.textContent = `${volume}%`;
        }
        
        console.log(`Громкость ${peerUuid} установлена на ${volume}% (gain: ${gainValue.toFixed(2)})`);
        
        // Сохраняем громкость участника
        savePeerVolumes();
    } else {
        console.log(`⚠ GainNode не найден для ${peerUuid}`);
    }
}

// Управление микрофоном
function switchMute() {
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
        console.log('🔇 Микрофон выключен');
    } else {
        console.log('🎤 Микрофон включен');
    }
    // Отправляем статус на сервер
    sendStatusUpdate();

};

// Управление заглушением звука
function switchMuteAll() {
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
        
        console.log('🔇 Звук заглушен');
        
        // Если был включен микрофон, меняем его состояние
        if (!isMicMuted) {
            isMicMuted = true;
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
        
        console.log('🔊 Звук включен');
    }
    
    // Отправляем статус на сервер
    sendStatusUpdate();
    

};