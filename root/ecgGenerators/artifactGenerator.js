// ecgGenerators/artifactGenerator.js
import { ensureFinite, gaussian, generateNoise } from '../waveformUtils.js';

/**
 * Generates a single point for the CPR artifact waveform.
 * @param {number} t Current simulation time relative to the artifact cycle.
 * @param {object} params Parameters for the CPR artifact rhythm.
 * @returns {number} Calculated artifact value for the given time.
 */
export function generateArtifact(t_relative_artifact, params) {
    // Oletetaan, että t_relative_artifact on aika viimeisimmästä painalluksen alusta
    const freq = params?.artifact_freq ?? 110; // Compressions per minute
    const amp = params?.artifact_amp ?? 1.8;
    const shapeFactor = params?.artifact_shape_factor ?? 0.15; // Controls width
    const noiseAmp = params?.noise_amp ?? 0.1;

    if (freq <= 0) return generateNoise(noiseAmp);

    const period = 60.0 / freq; // Seconds per compression

    // Käytetään gaussian-funktiota luomaan painallusta muistuttava piikki
    const mean = period / 2; // Piikki syklin keskellä
    const stdDev = period * shapeFactor;

    // Luodaan yksi alaspäin suuntautuva gaussian-piikki
    let artifactValue = gaussian(t_relative_artifact, mean, stdDev, -amp);

    // Lisätään pientä ylöspäin suuntautuvaa komponenttia
    artifactValue += gaussian(t_relative_artifact, mean, stdDev * 2.5, amp * 0.2);

    // Lisätään peruskohina
    artifactValue += generateNoise(noiseAmp);

    return ensureFinite(artifactValue);
}