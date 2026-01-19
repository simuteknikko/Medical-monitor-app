// config.js - Configuration constants
// VERSION: Slower interpolation, Added display update interval, Added GAP_SAMPLES
//          + Added separate ETCO2 sweep time configuration.

export const BUFFER_SECONDS = 9; // Duration of one sweep in seconds for most waveforms
export const SAMPLE_RATE = 100;  // Data points per second
export const BUFFER_SIZE = BUFFER_SECONDS * SAMPLE_RATE; // Total points in buffer for most waveforms

// --- LISÄTTY: ETCO2-kohtainen pyyhkäisyaika ---
export const ETCO2_BUFFER_SECONDS = 15; // Duration of one sweep in seconds for ETCO2 (esim. 10-12s)
export const ETCO2_BUFFER_SIZE = ETCO2_BUFFER_SECONDS * SAMPLE_RATE; // Total points in ETCO2 buffer
// --- LISÄYS LOPPUU ---

// --- Vitals Interpolation ---
export const VITAL_INTERPOLATION_RATE = 0.3;
export const INTERPOLATION_SNAP_THRESHOLD = 0.1;
export const NUMERIC_DISPLAY_UPDATE_INTERVAL_MS = 500;

export const GAP_SAMPLES = 10;

// --- ETCO2 Constants ---
export const DEFAULT_ETCO2_KPA = 5.3;
export const DEFAULT_RESP_RATE = 15;
export const KPA_TO_MMHG = 7.50062;
export const DEFAULT_ETCO2_SHAPE = 'normal';
export const CPR_ETCO2_VALUE_KPA = 1.5;

// --- ABP Constants ---
export const DEFAULT_ABP_SHAPE = 'normal';

// --- SpO2 Constants ---
export const DEFAULT_SPO2_SHAPE = 'normal';

// --- Temperature Constants ---
export const DEFAULT_TEMP_C = 37.0;
export const DEFAULT_TEMP_UNIT = 'C';

// --- Temperature Conversion Helpers ---
export const celsiusToFahrenheit = (c) => (c * 9/5) + 32;
export const fahrenheitToCelsius = (f) => (f - 32) * 5/9;

export const DEFAULT_ALARM_THRESHOLDS = {
    ecg: { low: 50, high: 120 },   // Low/High Heart Rate
    spo2: { low: 90 },             // Low SpO2
    abp: { low_map: 65 },          // Low Mean Arterial Pressure
    etco2: { low: 3.0, high: 6.0 } // Low/High ETCO2 (kPa)
};