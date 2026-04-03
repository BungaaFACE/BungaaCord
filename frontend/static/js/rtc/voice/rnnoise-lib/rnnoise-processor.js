const RNNOISE_SAMPLE_LENGTH = 480;
const RNNOISE_BUFFER_SIZE = RNNOISE_SAMPLE_LENGTH * 4;
const SHIFT_16_BIT_NR = 32768;

class RnnoiseProcessor {
    constructor(wasmInterface) {
        this._wasmInterface = wasmInterface;
        this._destroyed = false;

        this._wasmPcmInput = wasmInterface._malloc(RNNOISE_BUFFER_SIZE);
        this._wasmPcmInputF32Index = this._wasmPcmInput >> 2;

        if (!this._wasmPcmInput) {
            throw new Error('Failed to allocate WASM memory for RNNoise');
        }

        this._context = wasmInterface._rnnoise_create();
    }

    getSampleLength() {
        return RNNOISE_SAMPLE_LENGTH;
    }

    destroy() {
        if (this._destroyed) return;
        this._wasmInterface._free(this._wasmPcmInput);
        this._wasmInterface._rnnoise_destroy(this._context);
        this._destroyed = true;
    }

    // pcmFrame — Float32Array длиной 480
    processAudioFrame(pcmFrame, shouldDenoise = false) {
        // Float32 → int16
        for (let i = 0; i < RNNOISE_SAMPLE_LENGTH; i++) {
            this._wasmInterface.HEAPF32[this._wasmPcmInputF32Index + i] = pcmFrame[i] * SHIFT_16_BIT_NR;
        }

        const vadScore = this._wasmInterface._rnnoise_process_frame(
            this._context,
            this._wasmPcmInput,
            this._wasmPcmInput
        );

        if (shouldDenoise) {
            for (let i = 0; i < RNNOISE_SAMPLE_LENGTH; i++) {
                pcmFrame[i] = this._wasmInterface.HEAPF32[this._wasmPcmInputF32Index + i] / SHIFT_16_BIT_NR;
            }
        }

        return vadScore;
    }
}

export default RnnoiseProcessor;