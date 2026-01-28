// ecgGenerators/pqrstGenerator.js
import { ensureFinite, gaussian } from '../waveformUtils.js'; // Tuodaan apufunktiot

/**
 * Generates a single point for a standard PQRST-based ECG waveform.
 * @param {number} t_relative Time since the last beat start.
 * @param {object} params ECG rhythm parameters from rhythms.js.
 * @returns {number} Calculated ECG value for the given time.
 */
export function generatePQRST(t_relative, params) {
    let p_value = 0;
    let qrs_value = 0;
    let t_value = 0;

    // Parametrien luku
    const p_amp = params?.p_amp ?? 0.15;
    const t_amp = params?.t_amp ?? 0.25;
    const qrs_amp = params?.qrs_amp ?? 1.0;
    const q_amp_factor = params?.q_amp_factor ?? 0.1;
    const s_amp_factor = params?.s_amp_factor ?? 0.15;
    const pr_interval = params?.pr_interval ?? 0.16;
    const qrs_width = params?.qrs_width ?? 0.08;
    const t_width = params?.t_width ?? 0.07;
    const t_mean_offset = params?.t_mean_offset ?? 0.25;
    const hasP = params?.hasP ?? true;
    const hasT = params?.hasT ?? true;
    const st_elevation_amp = params?.st_elevation_amp ?? 0; // Voi olla posit. tai negat.

    // P-aalto
    if (hasP && p_amp !== 0 && pr_interval > 0) {
        // Prevent P-wave from becoming unrealistically long when PR is prolonged.
        // Allow override with `params.p_duration` for specific rhythms.
        const p_duration = params?.p_duration ?? Math.min(pr_interval * 0.7, 0.12);
        if (p_duration > 1e-3 && t_relative >= 0 && t_relative < p_duration) {
            const Bp = Math.PI / p_duration;
            p_value = p_amp * Math.sin(Bp * t_relative);
            if (p_value < 0) p_value = 0;
        }
    }

    // QRS-kompleksi
    if (qrs_amp !== 0 && qrs_width > 0) {
        const Aq = qrs_amp * q_amp_factor;
        const Ar = qrs_amp;
        const As = qrs_amp * s_amp_factor;
        const tq = pr_interval + qrs_width * 0.1;
        const tr = pr_interval + qrs_width * 0.5;
        const ts = pr_interval + qrs_width * 0.9;
        const sigma_q = qrs_width / 6;
        const sigma_r = qrs_width / 5;
        const sigma_s = qrs_width / 5;
        qrs_value = gaussian(t_relative, tr, sigma_r, Ar) -
                    gaussian(t_relative, tq, sigma_q, Aq) -
                    gaussian(t_relative, ts, sigma_s, As);
    }

    // T-aalto (Lasketaan perus-T-aalto)
    let t_wave_start_time = Infinity;
    let t_wave_end_time = -Infinity;
    if (hasT && t_amp !== 0 && t_width > 0) {
        const t_duration = Math.max(0.1, 3.0 * t_width);
        const t_mean = pr_interval + t_mean_offset;
        t_wave_start_time = t_mean - t_duration / 2;
        t_wave_end_time = t_wave_start_time + t_duration;

        if (t_relative >= t_wave_start_time && t_relative < t_wave_end_time) {
            const Bt = Math.PI / t_duration;
            const t_phase = Bt * (t_relative - t_wave_start_time);
            t_value = t_amp * Math.pow(Math.sin(t_phase), 2);
             if (t_amp > 0 && t_value < 0) t_value = 0;
             if (t_amp < 0 && t_value > 0) t_value = 0;
        }
    }

    // --- YKSINKERTAISTETTU ST-NOUSUN/-LASKUN KÄSITTELY ---
    let total_value = p_value + qrs_value + t_value;
    const j_point_time = pr_interval + qrs_width * 0.9; // Arvioitu J-pisteen aika

    // ST-NOUSU (st_elevation_amp > 0)
    if (st_elevation_amp > 0) {
        const elevation_end_time = hasT ? t_wave_end_time : j_point_time + 0.3;
        if (t_relative >= j_point_time && t_relative < elevation_end_time) {
            const time_since_j_point = t_relative - j_point_time;
            const total_elevation_duration = Math.max(1e-6, elevation_end_time - j_point_time);
            const progress = time_since_j_point / total_elevation_duration;
            const decay_start_factor = 1.0;
            const decay_end_factor = 0.6;
            const current_decay = decay_start_factor - (decay_start_factor - decay_end_factor) * progress;
            const current_st_elevation = st_elevation_amp * current_decay;

            if (t_relative >= t_wave_start_time && t_relative < t_wave_end_time) {
                total_value = p_value + qrs_value + current_st_elevation + (t_value * current_decay);
            } else {
                total_value = p_value + qrs_value + current_st_elevation;
            }
        }
    }
    // ST-LASKU (st_elevation_amp < 0)
    else if (st_elevation_amp < 0) {
        if (t_relative >= j_point_time && t_relative < t_wave_start_time) {
             total_value = p_value + qrs_value + st_elevation_amp;
        }
    }
    // --- Käsittelyn loppu ---

    return ensureFinite(total_value);
}