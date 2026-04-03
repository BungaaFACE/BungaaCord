let streamAudioManager = null;

class ElectronAudioCaptureManager {
    constructor() {
        this.destinationNode = null;
        this.activePids = new Set();
        this.sampleRate = 48000;
        this.channels = 2;
        this.isInitialized = false;
        this.workletNode = null;
        
        // Параметры для регулировки задержки
        this.maxQueueSize = 50; // Максимальное количество чанков в очереди
    }
    
    async initialize() {
        if (this.isInitialized) return;
        try {
            // Создаем конечный узел
            this.destinationNode = window.audioCtx.createMediaStreamDestination();
            try {
                // Загружаем AudioWorkletProcessor из отдельного файла
                console.log('add module');
                
                await window.audioCtx.audioWorklet.addModule('../static/js/rtc/screen/electron-audio-mixer-processor.js');
                console.log('workletNode');
                
                this.workletNode = new AudioWorkletNode(window.audioCtx, 'audio-mixer-processor', {
                    numberOfInputs: 0,
                    numberOfOutputs: 1,
                    outputChannelCount: [this.channels],
                    processorOptions: {
                        sampleRate: this.sampleRate,
                        channels: this.channels,
                        maxQueueSize: this.maxQueueSize
                    }
                });
                
                this.workletNode.connect(this.destinationNode);
                
                // Обработчик сообщений от worklet
                this.workletNode.port.onmessage = (event) => {
                    this.handleWorkletMessage(event);
                };
                
                console.log('✓ AudioWorklet инициализирован');
                
            } catch (error) {
                console.warn('Не удалось загрузить AudioWorklet, используем ScriptProcessorNode:', error);
                throw error;
            }
            
            this.isInitialized = true;
            console.log('✓ AudioCaptureManager инициализирован');
            
        } catch (error) {
            console.error('Ошибка инициализации:', error);
            throw error;
        }
    }
    
    async startAudioCapture(target_handle = null) {
        try {
            if (this.isInitialized) {
                this.stopAudioCapture();
            }
            await this.initialize();
            
            // Запускаем захват через IPC
            const result = await window.electronAPI.startAudioCapture(target_handle);
            
            if (result.success) {
                // Подписываемся на данные
                window.electronAPI.onAudioData((data) => {
                    this.handleAudioData(data);
                });
                
                window.electronAPI.onAudioError((error) => {
                    console.error('Ошибка аудио потока:', error);
                });
                
                console.log('✓ Аудио захват запущен');
                return result;
            }
            
        } catch (error) {
            console.error('Ошибка при запуске аудио захвата:', error);
            return { success: false, error: error.message };
        }
    }
    
    addPid(pid) {
        if (this.activePids.has(pid)) {
            console.log(`PID ${pid} уже добавлен`);
            return;
        }
        
        console.log(`Добавляем новый PID: ${pid}`);
        this.activePids.add(pid);

        if (this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'add-pid',
                pid: pid
            });
        }
    }
    
    removePid(pid) {
        if (!this.activePids.has(pid)) return;
        
        console.log(`Удаляем PID: ${pid}`);
        this.activePids.delete(pid);
        
        if (this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'remove-pid',
                pid: pid
            });
        }
    }
    
    handleAudioData(data) {
        const { pid, data: rawData } = data;
        
        // Динамически добавляем PID если его еще нет
        if (!this.activePids.has(pid)) {
            this.addPid(pid);
        }
        
        // Преобразуем Array в Uint8Array
        const uint8Array = new Uint8Array(rawData);
        
        // Преобразуем в Float32Array
        const float32Array = this.convertUint8ToFloat32Array(uint8Array);
        
        // Отправляем данные в AudioWorklet
        this.workletNode.port.postMessage({
            type: 'audio-data',
            pid: pid,
            data: float32Array.buffer
        }, [float32Array.buffer]);

    }
    
    convertUint8ToFloat32Array(uint8Array) {
        // Предполагаем 16-битный PCM, little-endian
        const bytesPerSample = 2;
        const sampleCount = uint8Array.length / (bytesPerSample * this.channels);
        
        const float32Array = new Float32Array(sampleCount * this.channels);
        const dataView = new DataView(uint8Array.buffer);
        
        for (let i = 0; i < sampleCount; i++) {
            for (let channel = 0; channel < this.channels; channel++) {
                const byteOffset = (i * this.channels + channel) * bytesPerSample;
                const int16 = dataView.getInt16(byteOffset, true);
                float32Array[i * this.channels + channel] = int16 / 32768.0;
            }
        }
        
        return float32Array;
    }
    
    getCombinedAudioStream() {
        if (!this.destinationNode) {
            console.warn('Destination node не инициализирован');
            return null;
        }
        return this.destinationNode.stream;
    }
    
    attachAudioToMediaStream(mediaStream) {
        const audioStream = this.getCombinedAudioStream();
        
        if (!audioStream) {
            console.warn('Нет доступного аудиопотока');
            return mediaStream;
        }
        
        const combinedStream = new MediaStream();
        
        // Добавляем все видео треки
        mediaStream.getVideoTracks().forEach(track => {
            combinedStream.addTrack(track);
        });
        
        // Добавляем аудио из нашего микшера
        audioStream.getAudioTracks().forEach(track => {
            combinedStream.addTrack(track);
        });
        
        return combinedStream;
    }
    
    handleWorkletMessage(event) {
        const { type, pid, message } = event.data;
        
        switch (type) {
            case 'log':
                console.log(`AudioWorklet[PID ${pid}]:`, message);
                break;
            case 'error':
                console.error(`AudioWorklet[PID ${pid}]:`, message);
                break;
        }
    }
    
    async stopAudioCapture() {
        // Очищаем все PIDs
        for (const pid of this.activePids) {
            this.removePid(pid);
        }
        this.activePids.clear();
        
        // Отписываемся от событий
        if (window.electronAPI) {
            window.electronAPI.removeAllListeners('audio-data');
            window.electronAPI.removeAllListeners('audio-error');
            window.electronAPI.stopAudioCapture();
        }
        
        this.destinationNode = null;
        this.isInitialized = false;
        
        console.log('✓ Аудио захват остановлен');
    }
}

streamAudioManager = new ElectronAudioCaptureManager();

// Основная функция для запуска захвата экрана
async function startScreenStream() {
    console.log('🖥️ Запрос на захват экрана... (electron)');

    constraints = await window.electronAPI.startElectronScreenConstraints();
    try {
        screenStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log(`📹 Поток содержит ${screenStream.getTracks().length} треков`);
        
        const sourceHandleId = constraints.video.mandatory.chromeMediaSourceId
        console.log('sourceHandleId', sourceHandleId);
        if (sourceHandleId.startsWith("screen")) {
            await streamAudioManager.startAudioCapture();
        } else {
            await streamAudioManager.startAudioCapture(sourceHandleId.split(":")[1]);
        }
        screenStream = streamAudioManager.attachAudioToMediaStream(screenStream);

        return screenStream;
    } catch (error) {
        console.error('❌ Ошибка создания потока:', error);
        throw error;
    }
}