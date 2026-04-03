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

        this._procNodeSampleRate = 128;
        this._denoiseSampleSize = this._denoiseProcessor.getSampleLength();

        this._circularBufferLength = leastCommonMultiple(this._procNodeSampleRate, this._denoiseSampleSize) * 2;
        this._circularBuffer = new Float32Array(this._circularBufferLength);

        this._inputBufferLength = 0;
        this._denoisedBufferLength = 0;
        this._denoisedBufferIndx = 0;
        
        this._prevFrame = new Float32Array(this._denoiseSampleSize);
        this._overlapLength = 48;
        this._fadeInBuffer = new Float32Array(this._overlapLength);
        this._fadeOutBuffer = new Float32Array(this._overlapLength);
        
        for (let i = 0; i < this._overlapLength; i++) {
            this._fadeInBuffer[i] = i / (this._overlapLength - 1);
            this._fadeOutBuffer[i] = 1 - (i / (this._overlapLength - 1));
        }
    }

    process(inputs, outputs) {
        const inData = inputs[0][0];
        const outData = outputs[0][0];

        if (!inData || inData.length === 0) return true;

        this._circularBuffer.set(inData, this._inputBufferLength);
        this._inputBufferLength += inData.length;

        while (this._denoisedBufferLength + this._denoiseSampleSize <= this._inputBufferLength) {
            const start = this._denoisedBufferLength;
            const end = start + this._denoiseSampleSize;

            const frame = new Float32Array(this._circularBuffer.subarray(start, end));
            this._denoiseProcessor.processAudioFrame(frame, true);

            if (this._denoisedBufferLength > 0) {
                for (let i = 0; i < this._overlapLength; i++) {
                    frame[i] = frame[i] * this._fadeInBuffer[i] + this._prevFrame[this._denoiseSampleSize - this._overlapLength + i] * this._fadeOutBuffer[i];
                }
            }

            this._circularBuffer.set(frame, start);
            this._prevFrame.set(frame);

            this._denoisedBufferLength += this._denoiseSampleSize;
        }

        let toSend = outData.length;
        let available = this._denoisedBufferLength - this._denoisedBufferIndx;

        if (available >= toSend) {
            outData.set(this._circularBuffer.subarray(this._denoisedBufferIndx, this._denoisedBufferIndx + toSend));
            this._denoisedBufferIndx += toSend;
        } else if (available > 0) {
            outData.set(this._circularBuffer.subarray(this._denoisedBufferIndx, this._denoisedBufferIndx + available));
            outData.fill(0, available);
            this._denoisedBufferIndx += available;
        } else {
            outData.fill(0);
        }

        if (this._denoisedBufferIndx >= this._circularBufferLength) {
            this._denoisedBufferIndx = 0;
        }
        if (this._inputBufferLength >= this._circularBufferLength) {
            const remaining = this._inputBufferLength - this._denoisedBufferLength;
            if (remaining > 0) {
                this._circularBuffer.set(this._circularBuffer.subarray(this._denoisedBufferLength, this._inputBufferLength), 0);
            }
            this._inputBufferLength = remaining;
            this._denoisedBufferLength = 0;
            this._denoisedBufferIndx = 0;
        }

        return true;
    }
}

registerProcessor('NoiseSuppressorWorklet', NoiseSuppressorWorklet);