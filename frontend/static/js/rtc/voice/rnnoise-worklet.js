// Импортируем синхронный rnnoise (важно именно import, а не dynamic)
import createRNNWasmModuleSync from './rnnoise-lib/rnnoise-sync.js';   // ← укажи правильный путь

import RnnoiseProcessor from './rnnoise-lib/rnnoise-processor.js';

// Простая функция НОК (least common multiple)
function leastCommonMultiple(a, b) {
    const gcd = (x, y) => (y === 0 ? x : gcd(y, x % y));
    return (a * b) / gcd(a, b);
}

class NoiseSuppressorWorklet extends AudioWorkletProcessor {
    constructor() {
        super();

        this._denoiseProcessor = new RnnoiseProcessor(createRNNWasmModuleSync());

        this._procNodeSampleRate = 128;                    // обычно приходит по 128 сэмплов
        this._denoiseSampleSize = this._denoiseProcessor.getSampleLength();

        this._circularBufferLength = leastCommonMultiple(this._procNodeSampleRate, this._denoiseSampleSize);
        this._circularBuffer = new Float32Array(this._circularBufferLength);

        this._inputBufferLength = 0;
        this._denoisedBufferLength = 0;
        this._denoisedBufferIndx = 0;
    }

    process(inputs, outputs) {
        const inData = inputs[0][0];
        const outData = outputs[0][0];

        if (!inData || inData.length === 0) return true;

        // Копируем новые сэмплы в кольцевой буфер
        this._circularBuffer.set(inData, this._inputBufferLength);
        this._inputBufferLength += inData.length;

        // Обрабатываем по блокам по 480 сэмплов
        while (this._denoisedBufferLength + this._denoiseSampleSize <= this._inputBufferLength) {
            const start = this._denoisedBufferLength;
            const end = start + this._denoiseSampleSize;

            const frame = this._circularBuffer.subarray(start, end);
            this._denoiseProcessor.processAudioFrame(frame, true);

            this._denoisedBufferLength += this._denoiseSampleSize;
        }

        // Отправляем обработанные данные на выход
        let toSend = outData.length;
        let available = this._denoisedBufferLength - this._denoisedBufferIndx;

        if (available >= toSend) {
            outData.set(this._circularBuffer.subarray(this._denoisedBufferIndx, this._denoisedBufferIndx + toSend));
            this._denoisedBufferIndx += toSend;
        } else if (available > 0) {
            outData.set(this._circularBuffer.subarray(this._denoisedBufferIndx, this._denoisedBufferIndx + available));
            this._denoisedBufferIndx += available;
        }

        // rollover кольцевого буфера
        if (this._denoisedBufferIndx >= this._circularBufferLength) this._denoisedBufferIndx = 0;
        if (this._inputBufferLength >= this._circularBufferLength) {
            this._inputBufferLength = 0;
            this._denoisedBufferLength = 0;
        }

        return true;
    }
}

registerProcessor('NoiseSuppressorWorklet', NoiseSuppressorWorklet);