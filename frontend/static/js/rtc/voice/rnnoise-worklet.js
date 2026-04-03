import createRNNWasmModuleSync from './rnnoise-lib/rnnoise-sync.js';
import RnnoiseProcessor from './rnnoise-lib/rnnoise-processor.js';
import leastCommonMultiple from './rnnoise-lib/math.js';

// NoiseSuppressorWorklet.js
const NoiseSuppressorWorklet_Name = "NoiseSuppressorWorklet";

// Import the synchronous rnnoise wasm module (assumed to be available as global or via bundler)
// Since we are in AudioWorkletGlobalScope, we assume createRNNWasmModuleSync is already defined.
// If not, it must be imported from "./generated/rnnoise-sync". For standalone file we keep it as is.
// In a real scenario you would include the generated wasm module script before this.
// Here we assume it is available (e.g., via importScripts or bundled).
// For the purpose of this transformation, we leave the reference as is.
// The user will need to ensure that createRNNWasmModuleSync is defined.

class NoiseSuppressorWorklet extends AudioWorkletProcessor {
    constructor() {
        super();

        this._denoiseProcessor = new RnnoiseProcessor(createRNNWasmModuleSync());
        this._denoiseSampleSize = this._denoiseProcessor.getSampleLength();
        this._procNodeSampleRate = 128;
        this._circularBufferLength = leastCommonMultiple(
            this._procNodeSampleRate,
            this._denoiseSampleSize
        );
        this._circularBuffer = new Float32Array(this._circularBufferLength);
        this._inputBufferLength = 0;
        this._denoisedBufferLength = 0;
        this._denoisedBufferIndx = 0;
    }

    process(inputs, outputs) {
        const inData = inputs[0][0];
        const outData = outputs[0][0];

        if (!inData) {
            return true;
        }

        // Append new raw PCM samples
        this._circularBuffer.set(inData, this._inputBufferLength);
        this._inputBufferLength += inData.length;

        // Process as many complete frames as possible
        for (
            ;
            this._denoisedBufferLength + this._denoiseSampleSize <= this._inputBufferLength;
            this._denoisedBufferLength += this._denoiseSampleSize
        ) {
            const denoiseFrame = this._circularBuffer.subarray(
                this._denoisedBufferLength,
                this._denoisedBufferLength + this._denoiseSampleSize
            );
            this._denoiseProcessor.processAudioFrame(denoiseFrame, true);
        }

        // Determine how much denoised audio is available to output
        let unsentDenoisedDataLength;
        if (this._denoisedBufferIndx > this._denoisedBufferLength) {
            unsentDenoisedDataLength = this._circularBufferLength - this._denoisedBufferIndx;
        } else {
            unsentDenoisedDataLength = this._denoisedBufferLength - this._denoisedBufferIndx;
        }

        // If we have enough denoised data to fill the output buffer, copy it
        if (unsentDenoisedDataLength >= outData.length) {
            const denoisedFrame = this._circularBuffer.subarray(
                this._denoisedBufferIndx,
                this._denoisedBufferIndx + outData.length
            );
            outData.set(denoisedFrame, 0);
            this._denoisedBufferIndx += outData.length;
        }

        // Wrap around when reaching the end of the circular buffer
        if (this._denoisedBufferIndx === this._circularBufferLength) {
            this._denoisedBufferIndx = 0;
        }

        // Reset indices when the circular buffer is fully consumed
        if (this._inputBufferLength === this._circularBufferLength) {
            this._inputBufferLength = 0;
            this._denoisedBufferLength = 0;
        }

        return true;
    }
}

registerProcessor(NoiseSuppressorWorklet_Name, NoiseSuppressorWorklet);