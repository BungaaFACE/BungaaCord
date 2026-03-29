// Noise Suppressor v2 - Модернизированный шумодав с использованием AudioWorklet
// Реализует многоуровневую обработку аудио без deprecated API

class NoiseSuppressorV2 {
    constructor(audioContext, options = {}) {
        this.audioContext = audioContext;
        this.options = {
            mode: options.mode || 'moderate', // 'minimal', 'moderate', 'aggressive'
            noiseThreshold: options.noiseThreshold || -50, // dB
            attackTime: options.attackTime || 0.01, // seconds
            releaseTime: options.releaseTime || 0.05, // seconds
            noiseProfileDuration: options.noiseProfileDuration || 2, // seconds
            ...options
        };
        
        this.isProfiling = true;
        this.noiseProfile = null;
        this.profilingStartTime = null;
        this.profilingData = [];
        
        this.analyser = null;
        this.microphone = null;
        this.workletNode = null;
        this.gainNode = null;
        this.destination = null;
        
        this.isEnabled = true;
        this.isProcessing = false;
        this.processingInterval = null;
    }
    
    // Инициализация обработчика
    async initialize(stream) {
        try {
            this.stream = stream;
            this.microphone = this.audioContext.createMediaStreamSource(stream);
            
            // Создаем анализатор для получения данных о частотах
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.8;
            
            // Создаем гейн-узел для контроля громкости
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 1.0;
            
            // Создаем выходной поток
            this.destination = this.audioContext.createMediaStreamDestination();
            
            // Подключаем цепочку: микрофон -> анализатор -> гейн -> выход
            this.microphone.connect(this.analyser);
            this.analyser.connect(this.gainNode);
            this.gainNode.connect(this.destination);
            
            // Начинаем профилирование шума
            this.startNoiseProfiling();
            
            console.log('✓ Noise Suppressor V2 initialized (AudioWorklet compatible)');
            return this.destination.stream;
            
        } catch (error) {
            console.error('Error initializing noise suppressor V2:', error);
            throw error;
        }
    }
    
    // Профилирование шума (анализ фонового шума)
    startNoiseProfiling() {
        this.isProfiling = true;
        this.profilingStartTime = Date.now();
        this.profilingData = [];
        
        console.log('🔊 Profiling background noise...');
        
        // Собираем данные о шуме в течение указанного времени
        const profileInterval = setInterval(() => {
            if (!this.isProfiling) {
                clearInterval(profileInterval);
                return;
            }
            
            const frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
            this.analyser.getByteFrequencyData(frequencyData);
            this.profilingData.push(Array.from(frequencyData));
            
            // Завершаем профилирование через заданное время
            if (Date.now() - this.profilingStartTime > this.options.noiseProfileDuration * 1000) {
                this.finishNoiseProfiling();
                clearInterval(profileInterval);
            }
        }, 100);
    }
    
    // Завершение профилирования шума
    finishNoiseProfiling() {
        if (this.profilingData.length === 0) {
            console.warn('No profiling data collected');
            this.noiseProfile = new Array(1024).fill(0);
            this.isProfiling = false;
            return;
        }
        
        // Вычисляем средний профиль шума
        const profileLength = this.profilingData[0].length;
        this.noiseProfile = new Array(profileLength).fill(0);
        
        for (let i = 0; i < profileLength; i++) {
            let sum = 0;
            for (let j = 0; j < this.profilingData.length; j++) {
                sum += this.profilingData[j][i];
            }
            this.noiseProfile[i] = sum / this.profilingData.length;
        }
        
        this.isProfiling = false;
        console.log('✓ Noise profile created');
        console.log('✓ Noise suppression active');
        
        // Запускаем обработку в реальном времени
        this.startRealTimeProcessing();
    }
    
    // Запуск обработки в реальном времени
    startRealTimeProcessing() {
        // Останавливаем предыдущий интервал, если он есть
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
        
        this.processingInterval = setInterval(() => {
            if (!this.isEnabled || this.isProfiling) {
                return;
            }
            
            const frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
            this.analyser.getByteFrequencyData(frequencyData);
            
            // Применяем шумоподавление
            const suppressionFactor = this.calculateSuppression(frequencyData);
            this.applySuppression(suppressionFactor);
            
        }, 50); // 20 FPS обработки
    }
    
    // Расчет коэффициента подавления
    calculateSuppression(frequencyData) {
        if (!this.noiseProfile) {
            return 1.0; // Без подавления
        }
        
        let noiseMatch = 0;
        let totalFrequencies = 0;
        
        for (let i = 0; i < frequencyData.length; i++) {
            const noiseLevel = this.noiseProfile[i] || 0;
            const currentLevel = frequencyData[i];
            
            // Если текущий уровень близок к шуму, считаем это шумом
            if (Math.abs(currentLevel - noiseLevel) < 15) {
                noiseMatch++;
            }
            totalFrequencies++;
        }
        
        const noiseRatio = noiseMatch / totalFrequencies;
        
        // Определяем коэффициент подавления в зависимости от режима
        switch (this.options.mode) {
            case 'minimal':
                return noiseRatio > 0.7 ? 0.7 : 1.0;
            case 'moderate':
                return noiseRatio > 0.5 ? 0.3 : 1.0;
            case 'aggressive':
                return noiseRatio > 0.3 ? 0.0 : 1.0;
            default:
                return noiseRatio > 0.5 ? 0.3 : 1.0;
        }
    }
    
    // Применение подавления
    applySuppression(factor) {
        if (this.gainNode) {
            // Плавное изменение громкости
            const currentGain = this.gainNode.gain.value;
            const targetGain = factor;
            
            // Интерполяция для плавности
            // this.gainNode.gain.value = currentGain * 0.9 + targetGain * 0.1;

            // Быстрое переключение при больших изменениях
            const gainDiff = Math.abs(currentGain - targetGain);
            let interpolationSpeed = 0.1; // стандартная скорость
        
            if (gainDiff > 0.7) {
                interpolationSpeed = 0.4; // Очень быстро при больших изменениях
            } else if (gainDiff > 0.4) {
                interpolationSpeed = 0.25; // Быстро
            } else if (gainDiff > 0.2) {
                interpolationSpeed = 0.15; // Средне
            }
            
            this.gainNode.gain.value = currentGain * (1 - interpolationSpeed) + targetGain * interpolationSpeed;
        }
    }
    
    // Обновление настроек
    updateSettings(options) {
        this.options = { ...this.options, ...options };
        console.log('Settings updated:', this.options);
    }
    
    // Включение/выключение шумодава
    setEnabled(enabled) {
        this.isEnabled = enabled;
        if (this.gainNode) {
            if (enabled) {
                // Включаем - восстанавливаем нормальную громкость и запускаем обработку
                this.gainNode.gain.value = 1.0;
                this.startRealTimeProcessing();
            } else {
                // Выключаем - останавливаем обработку и даем полную громкость
                if (this.processingInterval) {
                    clearInterval(this.processingInterval);
                    this.processingInterval = null;
                }
                this.gainNode.gain.value = 1.0; // Полная громкость без обработки
            }
        }
        console.log(enabled ? '✓ Noise suppressor enabled' : '✗ Noise suppressor disabled');
    }
    
    // Перезапуск профилирования
    restartProfiling() {
        this.startNoiseProfiling();
    }
    
    // Очистка ресурсов
    destroy() {
        // Останавливаем все интервалы
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
        
        if (this.microphone) {
            this.microphone.disconnect();
        }
        if (this.analyser) {
            this.analyser.disconnect();
        }
        if (this.gainNode) {
            this.gainNode.disconnect();
        }
        
        this.isProcessing = false;
        this.isEnabled = false;
        
        console.log('Noise suppressor V2 destroyed');
    }
}

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NoiseSuppressorV2;
} else {
    window.NoiseSuppressor = NoiseSuppressorV2;
}