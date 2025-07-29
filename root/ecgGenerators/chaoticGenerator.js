// ecgGenerators/chaoticGenerator.js
import { ensureFinite, generateNoise } from '../waveformUtils.js';

// --- Moduulinlaajuiset muuttujat VF-aaltomuodon sulavampaan generointiin ---
let lastChaoticValue = 0;
let nextChaoticValue = 0; // Tuleva arvo, johon interpoloidaan
let holdCounter = 0;
let interpolationStep = 0; // Nykyinen askel interpolaatiossa
const DEFAULT_VF_HOLD_DURATION = 4; // Oletuspitoaika näytteinä (interpolaation kesto)
// ---

/**
 * Generates a single point for a chaotic ECG waveform (e.g., VF).
 * The waveform now interpolates between random values over vf_hold_duration samples
 * to make it appear less "blocky" and more flowing.
 * @param {object} params ECG rhythm parameters from rhythms.js.
 * - vf_amp: Amplitude of the ventricular fibrillation.
 * - noise_amp: Amplitude of the baseline noise.
 * - vf_hold_duration (optional): Specific hold duration (interpolation steps) for this rhythm.
 * @returns {number} Calculated ECG value for the given time.
 */
export function generateChaotic(params) {
    const vfAmplitude = params?.vf_amp ?? 0.7; // Default VF amplitude if not specified
    const noiseAmp = params?.noise_amp ?? 0.03; // Default noise amplitude
    // Use vf_hold_duration from params if available, otherwise use the module's default
    const currentVfHoldDuration = params?.vf_hold_duration ?? DEFAULT_VF_HOLD_DURATION;

    // Check if it's time to generate new target values for interpolation
    if (holdCounter <= 0) {
        // The previous target value becomes the starting point for the new interpolation
        lastChaoticValue = nextChaoticValue;
        // Generate a new random target value for the VF waveform
        nextChaoticValue = (Math.random() - 0.5) * 2 * vfAmplitude;
        
        // Reset the interpolation step and the hold counter
        interpolationStep = 0;
        holdCounter = currentVfHoldDuration; // This counter ensures a new value is picked after duration
    }

    let currentValue;
    // Perform linear interpolation if the hold duration is positive and we haven't reached the end
    if (currentVfHoldDuration > 0 && interpolationStep < currentVfHoldDuration) {
        const progress = interpolationStep / currentVfHoldDuration;
        currentValue = lastChaoticValue + (nextChaoticValue - lastChaoticValue) * progress;
        interpolationStep++; // Increment the step for the next point
    } else {
        // If hold duration is 0 or interpolation is complete, use the target value directly
        currentValue = nextChaoticValue;
    }
    
    // Decrement the main counter that triggers new random value generation
    holdCounter--;

    // Add baseline noise to the current interpolated or target value
    let ecgValue = currentValue + generateNoise(noiseAmp);

    // Ensure the final value is a finite number
    return ensureFinite(ecgValue);
}
