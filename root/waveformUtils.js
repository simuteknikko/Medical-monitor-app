// waveformUtils.js - Helper functions and OTHER waveform generators
// VERSION: SpO2 uses shapeType='no_signal' and threshold < 60%. Reduced noise for normal SpO2, ABP, ETCO2.
// + Further reduced base noise for normal ETCO2 shape.
// + ETCO2 active breath shape duration capped to prevent excessive stretching at low RR.
// + SIGNIFICANTLY REDUCED/REMOVED baseline noise for SpO2 'no_signal' and ETCO2 'disconnect'/low_value states.
// + Reduced default baseNoiseAmplitude for SpO2 and noiseAmplitude for ETCO2.
// + REMOVED all artificial noise from SpO2, ABP, and ETCO2 waveforms.

// --- Helper Functions ---
// generateNoise is kept for ECG generators that might still use it via rhythms.js
export const generateNoise = (amplitude) => (Math.random() - 0.5) * amplitude * 2;
export const ensureFinite = (value, defaultValue = 0) => Number.isFinite(value) ? value : defaultValue;
export const gaussian = (t, mean, stdDev, amplitude) => {
    const safeStdDev = Math.max(Math.abs(stdDev), 1e-9);
    const safeAmplitude = ensureFinite(amplitude, 0);
    if (safeAmplitude === 0) return 0;

    const exponent = -Math.pow(ensureFinite(t) - ensureFinite(mean), 2) / (2 * safeStdDev * safeStdDev);
    if (exponent < -700) return 0; // Prevent extremely small numbers

    try {
        return safeAmplitude * Math.exp(exponent);
    } catch (e) {
        console.error("Error in gaussian exp:", { t, mean, stdDev, amplitude, exponent }, e);
        return 0; 
    }
};


// --- Other Waveform Generation Functions ---

/**
 * Generates a single point for the SpO2 plethysmography waveform.
 * Noise has been removed.
 */
export function generatePlethPulseShape(t, beatDuration, spo2Value, shapeType = 'normal') {
    const currentSpo2 = ensureFinite(spo2Value, 0);
    const baseLevel = 0.1; 

    if (shapeType === 'no_signal') {
         return ensureFinite(baseLevel, baseLevel); // No noise
    }
    if (currentSpo2 < 1) { 
        return ensureFinite(baseLevel, baseLevel); // No noise
    }

    const DEFAULT_FALLBACK_DURATION = 2.0;
    const effectiveDuration = (beatDuration > 0 && Number.isFinite(beatDuration)) ? beatDuration : DEFAULT_FALLBACK_DURATION;
    const effectiveTime = (t !== null && Number.isFinite(t) && t >= 0) ? t : (performance.now() / 1000);
    const t_rel = effectiveTime % effectiveDuration;

    let pulseAmplitude = 0.85;
    let riseTimeFactor = 0.28;
    let risePower = 2;
    let notchTimeFactor = 0.50;
    let notchWidthFactor = 0.06;
    let notchDepthFactor = 0.20;
    let decayFactor = 2.5;

    if (shapeType === 'low_perfusion') {
        pulseAmplitude = 0.40;
        riseTimeFactor = 0.35;
        risePower = 1.5;
        notchTimeFactor = 0.55;
        notchWidthFactor = 0.08;
        notchDepthFactor = 0.05;
        decayFactor = 2.2;
    }

    pulseAmplitude *= (currentSpo2 / 100) * 0.8 + 0.2;

    const riseEndTime = effectiveDuration * riseTimeFactor;
    const notchTime = effectiveDuration * notchTimeFactor;
    const notchWidth = effectiveDuration * notchWidthFactor;
    let value = 0;

    if (t_rel < riseEndTime && riseEndTime > 1e-6) {
        const phase = (t_rel / riseEndTime) * (Math.PI / 2);
        value = pulseAmplitude * Math.pow(Math.sin(phase), risePower);
    }
    else if (riseEndTime <= t_rel) {
        const timeSinceRiseEnd = t_rel - riseEndTime;
        const decayTimeConstant = effectiveDuration / decayFactor;
        value = pulseAmplitude * Math.exp(-timeSinceRiseEnd / decayTimeConstant);
    }

    const notchDepth = pulseAmplitude * notchDepthFactor;
    const safeNotchWidth = Math.max(notchWidth, 1e-4);
    const notch = gaussian(t_rel, notchTime, safeNotchWidth, -notchDepth);
    value += notch;

    // Removed noise addition: const noiseAmp = baseNoiseAmplitude + value * signalDependentNoiseFactor;
    return ensureFinite(Math.max(0, baseLevel + value), baseLevel);
}


/**
 * Generates a single point for the ABP waveform.
 * Noise has been removed.
 */
export function generateAbpWaveformShape(t, beatDuration, amplitudeSystolic, amplitudeDiastolic, shapeType = 'normal') {
    const sys = ensureFinite(amplitudeSystolic, 0);
    const dia = ensureFinite(amplitudeDiastolic, 0);

    if (sys < 1 && dia < 1) { // If pressures are effectively zero
        return ensureFinite(0, 0); // Return flat zero, no noise
    }
    const safeDia = Math.max(0, dia);
    const safeSys = Math.max(safeDia + 1, sys);

    const DEFAULT_FALLBACK_DURATION = 2.0;
    const effectiveDuration = (beatDuration > 0 && Number.isFinite(beatDuration)) ? beatDuration : DEFAULT_FALLBACK_DURATION;
    const effectiveTime = (t !== null && Number.isFinite(t) && t >= 0) ? t : (performance.now() / 1000);
    const t_rel = effectiveTime % effectiveDuration;

    const pulsePressure = safeSys - safeDia;
    if (pulsePressure <= 0) return safeDia; // No noise if no pulse pressure

    let upstrokeEndTimeFactor = 0.15;
    let upstrokePower = 3;
    let notchTimeFactor = 0.35;
    let notchWidthFactor = 0.05;
    let notchDepthFactor = 0.10;
    let diastolicDecayFactor = 3.0;

    switch (shapeType) {
        case 'damped':
            upstrokeEndTimeFactor = 0.28; upstrokePower = 2;
            notchTimeFactor = 0.45; notchDepthFactor = 0.005; notchWidthFactor = 0.15;
            diastolicDecayFactor = 2.5;
            break;
        case 'hyperdynamic':
            upstrokeEndTimeFactor = 0.09; upstrokePower = 5;
            notchTimeFactor = 0.45; notchDepthFactor = 0.07; notchWidthFactor = 0.06;
            diastolicDecayFactor = 4.8;
            break;
        case 'vasoconstricted':
            upstrokeEndTimeFactor = 0.13; upstrokePower = 3.5;
            notchTimeFactor = 0.30; notchDepthFactor = 0.09; notchWidthFactor = 0.04;
            diastolicDecayFactor = 1.9;
            break;
        case 'normal': default: break;
    }

    const upstrokeEndTime = effectiveDuration * upstrokeEndTimeFactor;
    const notchTime = effectiveDuration * notchTimeFactor;
    const safeNotchWidth = Math.max(effectiveDuration * notchWidthFactor, 1e-4);
    let value = 0;

    if (t_rel < upstrokeEndTime && upstrokeEndTime > 1e-6) {
        const phase = (t_rel / upstrokeEndTime) * (Math.PI / 2);
        value = safeDia + pulsePressure * Math.pow(Math.sin(phase), upstrokePower);
    }
    else if (upstrokeEndTime <= t_rel) {
        const timeSinceUpstrokeEnd = t_rel - upstrokeEndTime;
        const decayTimeConstant = effectiveDuration / diastolicDecayFactor;
        const effectiveDecay = pulsePressure * Math.exp(-timeSinceUpstrokeEnd / decayTimeConstant);
        value = safeDia + effectiveDecay;
    }
     else { value = safeDia; }

    const notchDepth = pulsePressure * notchDepthFactor;
    const notch = gaussian(t_rel, notchTime, safeNotchWidth, -notchDepth);
    value += notch;

    // Removed noise addition: const noiseAmp = baseNoiseAmplitude + pulsePressure * ppDependentNoiseFactor;
    return ensureFinite(Math.max(0, Math.min(safeSys + 15, value)), safeDia);
}

const ETCO2_MAX_SHAPE_REFERENCE_RR = 20;
const ETCO2_MAX_ACTIVE_SHAPE_DURATION = 60.0 / ETCO2_MAX_SHAPE_REFERENCE_RR; 

/**
 * Generates a single point for the ETCO2 waveform.
 * Noise has been removed.
 */
export function generateEtco2WaveformShape(t, breathDuration, etco2Value, shapeType = 'normal') { 
    if (breathDuration <= 0 || !Number.isFinite(breathDuration)) {
        return 0; // No noise if duration invalid
    }
    if (ensureFinite(etco2Value, 0) < 0.01 || shapeType === 'disconnect') { // Adjusted threshold for "zero"
        return 0; // No noise for disconnect/very low ETCO2
    }

    const effectiveTime = (t !== null && Number.isFinite(t) && t >= 0) ? t : (performance.now() / 1000);
    const t_rel = (effectiveTime % breathDuration + breathDuration) % breathDuration;
    const durationForShapeCalculation = Math.min(breathDuration, ETCO2_MAX_ACTIVE_SHAPE_DURATION);

    let inspirationEndFactor = 0.40; 
    let plateauStartFactor = 0.50;   
    let plateauEndFactor = 0.90;     
    let plateauSlopeFactor = 0.05;   
    let upstrokeSteepness = 10;      
    let downstrokeSteepness = 12;    

    switch (shapeType) {
        case 'bronchospasm': 
            plateauStartFactor = 0.65; plateauSlopeFactor = 0.30; upstrokeSteepness = 6;
            break;
        case 'leak_obstruction': 
             plateauStartFactor = 0.60; plateauSlopeFactor = -0.15; upstrokeSteepness = 7;
             break;
        case 'cpr_low_flow': 
             // Shape parameters remain default, value is handled by caller
             break;
        case 'normal':
        default:
            break;
    }

    const inspirationEnd = durationForShapeCalculation * inspirationEndFactor;
    const plateauStart = durationForShapeCalculation * plateauStartFactor;
    const plateauEnd = durationForShapeCalculation * plateauEndFactor;
    const activeWaveformEnd = durationForShapeCalculation;

    let value = 0;
    const targetEtco2 = ensureFinite(etco2Value);

    if (t_rel < activeWaveformEnd) {
        if (t_rel < inspirationEnd) {
            value = 0;
        } else if (t_rel < plateauStart) {
            const phaseDuration = plateauStart - inspirationEnd;
            if (phaseDuration > 1e-6) { 
                const phaseProgress = (t_rel - inspirationEnd) / phaseDuration;
                value = targetEtco2 * (1 / (1 + Math.exp(-upstrokeSteepness * (phaseProgress - 0.5))));
            } else {
                value = targetEtco2; 
            }
        } else if (t_rel < plateauEnd) {
            const plateauDuration = plateauEnd - plateauStart;
            if (plateauDuration > 1e-6) {
                const plateauProgress = (t_rel - plateauStart) / plateauDuration;
                value = targetEtco2 * (1 + plateauProgress * plateauSlopeFactor); 
            } else {
                value = targetEtco2; 
            }
        } else {
            const phaseDuration = activeWaveformEnd - plateauEnd; 
            if (phaseDuration > 1e-6) {
                const phaseProgress = (t_rel - plateauEnd) / phaseDuration;
                const startValue = targetEtco2 * (1 + plateauSlopeFactor); 
                value = startValue * (1 - (1 / (1 + Math.exp(-downstrokeSteepness * (phaseProgress - 0.5)))));
            } else {
                value = 0; 
            }
        }
    } else {
        value = 0;
    }

    // Removed noise addition: value += generateNoise(noiseAmplitude);
    return ensureFinite(Math.max(0, value), 0); 
}
