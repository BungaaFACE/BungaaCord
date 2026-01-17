// audio-mixer-processor.js
class AudioMixerProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        
        this.sampleRate = options.processorOptions?.sampleRate || 48000;
        this.channels = options.processorOptions?.channels || 2;
        this.maxQueueSize = options.processorOptions?.maxQueueSize || 50;
        
        // Хранилище данных по PID
        this.audioQueues = new Map(); // Map<pid, Float32Array[]>
        
        this.port.onmessage = (event) => {
            this.handleMessage(event.data);
        };
        
        console.log('AudioMixerProcessor инициализирован');
    }
    
    handleMessage(data) {
        const { type, pid, data: audioData } = data;
        
        switch (type) {
            case 'add-pid':
                this.addPid(pid);
                break;
                
            case 'remove-pid':
                this.removePid(pid);
                break;
                
            case 'audio-data':
                this.addAudioData(pid, audioData);
                break;
        }
    }
    
    addPid(pid) {
        if (!this.audioQueues.has(pid)) {
            this.audioQueues.set(pid, []);
            
            this.port.postMessage({
                type: 'log',
                pid: pid,
                message: 'PID добавлен в микшер'
            });
            
            console.log(`AudioWorklet: Добавлен PID ${pid}`);
        }
    }
    
    removePid(pid) {
        this.audioQueues.delete(pid);
        
        this.port.postMessage({
            type: 'log',
            pid: pid,
            message: 'PID удален из микшера'
        });
        
        console.log(`AudioWorklet: Удален PID ${pid}`);
    }
    
    addAudioData(pid, audioDataBuffer) {
        const queue = this.audioQueues.get(pid);
        if (!queue) {
            // Если PID еще не добавлен, добавляем его
            this.addPid(pid);
            return this.addAudioData(pid, audioDataBuffer);
        }
        
        const float32Array = new Float32Array(audioDataBuffer);
        queue.push(float32Array);
        
        // Ограничиваем размер очереди
        if (queue.length > this.maxQueueSize) {
            queue.shift();
            console.log('AudioMixerProcessor: Очередь переполнена, удалены старые данные')
        }
    }
    
    process(inputs, outputs) {
        const output = outputs[0];
        const channelCount = output.length;
        const sampleCount = output[0].length;
        
        // Очищаем выходной буфер
        for (let channel = 0; channel < channelCount; channel++) {
            output[channel].fill(0);
        }
        
        // Микшируем все активные PIDs
        for (const [pid, queue] of this.audioQueues) {
            if (queue.length === 0) continue;
            const samplesMixed = this.mixQueueToOutput(pid, queue, output, sampleCount);
        }
        
        
        return true; // Продолжаем обработку
    }
    
    mixQueueToOutput(pid, queue, output, sampleCount) {
        let samplesMixed = 0;
        
        while (samplesMixed < sampleCount && queue.length > 0) {
            const chunk = queue[0];
            const samplesInChunk = chunk.length / this.channels;
            const samplesToMix = Math.min(samplesInChunk, sampleCount - samplesMixed);
            
            // Микшируем чанк в выходной буфер
            for (let i = 0; i < samplesToMix; i++) {
                const sampleIndex = i * this.channels;
                
                for (let channel = 0; channel < output.length; channel++) {
                    // Распределяем каналы: если каналов в чанке меньше, чем выходных,
                    // дублируем каналы
                    const sourceChannel = Math.min(channel, this.channels - 1);
                    output[channel][samplesMixed + i] += 
                        chunk[sampleIndex + sourceChannel];
                }
            }
            
            samplesMixed += samplesToMix;
            
            // Обновляем или удаляем чанк
            if (samplesToMix >= samplesInChunk) {
                queue.shift();
            } else {
                // Обрезаем использованную часть
                const remainingSamples = chunk.slice(samplesToMix * this.channels);
                queue[0] = remainingSamples;
            }
        }
        
        return samplesMixed;
    }
}

registerProcessor('audio-mixer-processor', AudioMixerProcessor);