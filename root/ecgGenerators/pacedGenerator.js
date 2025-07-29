// ecgGenerators/pacedGenerator.js
import { ensureFinite, gaussian, generateNoise } from '../waveformUtils.js'; // Tuodaan apufunktiot

/**
 * Generates a single point for a paced ECG waveform, based on PQRST structure,
 * potentially including a pacing spike and a native P-wave.
 * This generator is intended to be called similarly to pqrstGenerator,
 * relying on script.js for beat timing based on HR.
 *
 * @param {number} t_relative Time since the last beat start.
 * @param {object} params ECG rhythm parameters from rhythms.js.
 * Expected new params for pacing spike:
 * - hasPacingSpike (boolean, optional, default: true for paced rhythms)
 * - pacing_spike_amp (number, amplitude of the pacing P-wave/spike)
 * - pacing_spike_duration (number, duration of the pacing P-wave/spike)
 * - pacing_spike_pr_offset (number, time from t_relative=0 to the start of pacing P-wave/spike)
 * - qrs_start_after_spike_delay (number, time from pacing spike start to QRS start, effectively PR interval for the spike)
 * Expected standard PQRST params (for native P, QRS, T):
 * - hasP (boolean, for native P-wave)
 * - p_amp, pr_interval, qrs_amp, qrs_width, t_amp, t_width, etc.
 * - t_mean_offset (number, for this generator: offset from QRS start to T-wave center)
 * @returns {number} Calculated ECG value for the given time.
 */
export function generatePaced(t_relative, params) {
    let pacing_spike_p_value = 0;
    let native_p_value = 0;
    let qrs_value = 0;
    let t_value = 0;

    // --- Pacing Spike P-wave Parameters ---
    const hasPacingSpike = params?.hasPacingSpike ?? true; // Default to true for a "paced" generator
    const pacing_spike_amp = params?.pacing_spike_amp ?? 0.2; // Amplitude of the pacing spike
    const pacing_spike_duration = params?.pacing_spike_duration ?? 0.04; // Duration of the pacing spike
    const pacing_spike_pr_offset = params?.pacing_spike_pr_offset ?? 0.0; // Time from t_relative to start of spike

    // --- Native P-wave Parameters ---
    const hasP_native = params?.hasP ?? false; // Native P-wave
    const p_amp_native = params?.p_amp ?? 0.15;
    const pr_interval_native = params?.pr_interval ?? 0.16; // PR for native P-wave

    // --- QRS Parameters ---
    const qrs_amp = params?.qrs_amp ?? 1.0;
    const q_amp_factor = params?.q_amp_factor ?? 0.1;
    const s_amp_factor = params?.s_amp_factor ?? 0.15;
    const qrs_width = params?.pacedQrsWidth ?? params?.qrs_width ?? 0.12;

    // --- T-wave Parameters ---
    const hasT = params?.hasT ?? true;
    const t_amp = params?.pacedTWaveAmp ?? params?.t_amp ?? 0.25;
    const t_width = params?.pacedTWaveWidth ?? params?.t_width ?? 0.07;
    // For this generator, params.t_mean_offset is defined as the offset
    // from the START of the QRS complex to the CENTER of the T-wave.
    const t_mean_from_qrs_start = params?.t_mean_offset ?? 0.20; // Default: T-center 0.20s after QRS start

    // --- Timing & ST Segment ---
    let qrs_start_delay;

    if (hasPacingSpike) {
        qrs_start_delay = (pacing_spike_pr_offset) + (params?.qrs_start_after_spike_delay ?? 0.04);
    } else if (hasP_native) {
        qrs_start_delay = pr_interval_native; // Native P-wave dictates QRS timing
    } else {
        qrs_start_delay = params?.qrs_start_delay_no_p ?? 0.0;
    }

    const st_elevation_amp = params?.st_elevation_amp ?? 0;

    // 1. Pacing Spike P-wave
    if (hasPacingSpike && pacing_spike_amp !== 0 && pacing_spike_duration > 1e-3) {
        const spike_actual_start_time = pacing_spike_pr_offset;
        const spike_actual_end_time = spike_actual_start_time + pacing_spike_duration;

        if (t_relative >= spike_actual_start_time && t_relative < spike_actual_end_time) {
            const B_spike = Math.PI / pacing_spike_duration;
            pacing_spike_p_value = pacing_spike_amp * Math.sin(B_spike * (t_relative - spike_actual_start_time));
            if (pacing_spike_p_value < 0 && pacing_spike_amp > 0) pacing_spike_p_value = 0;
            if (pacing_spike_p_value > 0 && pacing_spike_amp < 0) pacing_spike_p_value = 0;
        }
    }

    // 2. Native P-wave
    let native_p_start_time = qrs_start_delay - pr_interval_native;
    let native_p_duration = pr_interval_native * 0.7;

    if (hasP_native && p_amp_native !== 0 && pr_interval_native > 0 && native_p_duration > 1e-3) {
        if (t_relative >= native_p_start_time && t_relative < (native_p_start_time + native_p_duration)) {
            const Bp_native = Math.PI / native_p_duration;
            native_p_value = p_amp_native * Math.sin(Bp_native * (t_relative - native_p_start_time));
            if (native_p_value < 0) native_p_value = 0;
        }
    }

    // 3. QRS Complex
    const t_relative_to_qrs_start = t_relative - qrs_start_delay;

    if (qrs_amp !== 0 && qrs_width > 0) {
        const Aq = qrs_amp * q_amp_factor;
        const Ar = qrs_amp;
        const As = qrs_amp * s_amp_factor;
        const tq_peak = qrs_width * 0.1;
        const tr_peak = qrs_width * 0.5;
        const ts_peak = qrs_width * 0.9;
        const sigma_q = qrs_width / 6;
        const sigma_r = qrs_width / 5;
        const sigma_s = qrs_width / 5;

        if (t_relative_to_qrs_start >= -qrs_width && t_relative_to_qrs_start < qrs_width * 1.5) {
             qrs_value = gaussian(t_relative_to_qrs_start, tr_peak, sigma_r, Ar) -
                         gaussian(t_relative_to_qrs_start, tq_peak, sigma_q, Aq) -
                         gaussian(t_relative_to_qrs_start, ts_peak, sigma_s, As);
        }
    }

    // 4. T-wave
    let t_wave_start_time_from_qrs = -Infinity;
    let t_wave_end_time_from_qrs = Infinity;

    if (hasT && t_amp !== 0 && t_width > 0) {
        const t_duration_calc = Math.max(0.1, 3.0 * t_width);
        // t_mean_from_qrs_start is already defined based on params.t_mean_offset
        t_wave_start_time_from_qrs = t_mean_from_qrs_start - t_duration_calc / 2;
        t_wave_end_time_from_qrs = t_wave_start_time_from_qrs + t_duration_calc;

        if (t_relative_to_qrs_start >= t_wave_start_time_from_qrs && t_relative_to_qrs_start < t_wave_end_time_from_qrs) {
            const Bt = Math.PI / t_duration_calc;
            const t_phase = Bt * (t_relative_to_qrs_start - t_wave_start_time_from_qrs);
            t_value = t_amp * Math.pow(Math.sin(t_phase), 2);
            if (t_amp > 0 && t_value < 0) t_value = 0;
            if (t_amp < 0 && t_value > 0) t_value = 0;
        }
    }

    // ST Segment
    const j_point_time_from_qrs_start = qrs_width * 0.9;
    let total_value = pacing_spike_p_value + native_p_value + qrs_value + t_value;

    if (st_elevation_amp !== 0) {
        const st_segment_start_from_qrs = j_point_time_from_qrs_start;
        const st_segment_end_from_qrs = (hasT && t_amp !== 0) ? t_wave_start_time_from_qrs : (j_point_time_from_qrs_start + 0.2);

        if (t_relative_to_qrs_start >= st_segment_start_from_qrs && t_relative_to_qrs_start < st_segment_end_from_qrs) {
            // Simplified ST handling: add elevation/depression directly to the sum
            // More complex interaction with T-wave (especially for elevation) could be added if needed.
            total_value += st_elevation_amp;
        }
    }

    total_value += generateNoise(params?.noise_amp ?? 0.015);
    return ensureFinite(total_value);
}
