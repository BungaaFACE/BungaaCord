// RnnoiseProcessor.js
const RNNOISE_SAMPLE_LENGTH = 480;
const RNNOISE_BUFFER_SIZE = RNNOISE_SAMPLE_LENGTH * 4;
const PCM_FREQUENCY = 44100;
const SHIFT_16_BIT_NR = 32768;

class RnnoiseProcessor {
    constructor(wasmInterface) {
        this._destroyed = false;
        this._wasmInterface = wasmInterface;

        try {
            this._wasmPcmInput = this._wasmInterface._malloc(RNNOISE_BUFFER_SIZE);
            this._wasmPcmInputF32Index = this._wasmPcmInput >> 2;

            if (!this._wasmPcmInput) {
                throw new Error("Failed to create wasm input memory buffer!");
            }

            this._context = this._wasmInterface._rnnoise_create();
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    _releaseWasmResources() {
        if (this._wasmPcmInput) {
            this._wasmInterface._free(this._wasmPcmInput);
        }
        if (this._context) {
            this._wasmInterface._rnnoise_destroy(this._context);
        }
    }

    getSampleLength() {
        return RNNOISE_SAMPLE_LENGTH;
    }

    getRequiredPCMFrequency() {
        return PCM_FREQUENCY;
    }

    destroy() {
        if (this._destroyed) return;
        this._releaseWasmResources();
        this._destroyed = true;
    }

    calculateAudioFrameVAD(pcmFrame) {
        return this.processAudioFrame(pcmFrame);
    }

    processAudioFrame(pcmFrame, shouldDenoise = false, intensity = 1.0) {
        // Convert 32 bit Float PCM samples to 16 bit Float PCM samples
        for (let i = 0; i < RNNOISE_SAMPLE_LENGTH; i++) {
            this._wasmInterface.HEAPF32[this._wasmPcmInputF32Index + i] =
                pcmFrame[i] * SHIFT_16_BIT_NR;
        }

        const vadScore = this._wasmInterface._rnnoise_process_frame(
            this._context,
            this._wasmPcmInput,
            this._wasmPcmInput
        );

        if (shouldDenoise) {
            for (let i = 0; i < RNNOISE_SAMPLE_LENGTH; i++) {
                const denoised = this._wasmInterface.HEAPF32[this._wasmPcmInputF32Index + i] / SHIFT_16_BIT_NR;
                // Mix original and denoised signal based on intensity
                pcmFrame[i] = pcmFrame[i] * (1 - intensity) + denoised * intensity;
            }
        }

        return vadScore;
    }
}


export default RnnoiseProcessor;