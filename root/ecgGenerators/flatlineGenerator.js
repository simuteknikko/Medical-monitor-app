// ecgGenerators/flatlineGenerator.js
import { generateNoise } from '../waveformUtils.js';

/**
 * Generates a single point for a flatline ECG waveform (Asystole).
 * @param {object} params ECG rhythm parameters from rhythms.js.
 * @returns {number} Calculated ECG value (noise only).
 */
export function generateFlatline(params) {
    const noiseAmp = params?.noise_amp ?? 0.015;
    return generateNoise(noiseAmp);
}