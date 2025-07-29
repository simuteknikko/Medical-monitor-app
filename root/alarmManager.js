// alarmManager.js - Manages alarm logic, visuals, and sounds
// VERSION: Updated thresholds and sound profiles. Added MAP alarm. English UI text.
//          + Added network sync for alarm sound state.
//          + CORRECTED UNMUTE: Ensures sounds resume correctly on remote unmute if alarms are active.
//          + REVERTED SOUND INTERVALS: Restored original alarm sound intervals.
//          + PREVENT SOUND RESTART: Avoids restarting sound if already scheduled.

import { KPA_TO_MMHG } from './config.js';
import { ensureFinite } from './waveformUtils.js';
import { getCurrentRole, sendSoundStateUpdate } from './networkManager.js';

// Alarm Thresholds
const ALARM_THRESHOLDS = {
    ecg: { low_hr: 50, high_hr: 100 }, // HR < 50 or > 100
    spo2: { low: 95 }, // SpO2 < 95%
    abp: { low_map: 60 }, // MAP < 60 mmHg (Calculated from Sys/Dia)
    etco2: { low_kpa: 3.0, high_kpa: 7.0 }, // Approx 22.5 - 52.5 mmHg
};

// Alarm State
let activeAlarms = {};
let soundsEnabled = true; // Oletuksena äänet päällä
let soundToggleButton = null;
let audioContext = null;
let currentOscillator = null;
let visualAlarmElements = {};
let alarmSoundTimeoutId = null; // ID for the setTimeout that schedules the next beep

// Alkuperäiset ääniasetukset
const ALARM_SOUNDS = {
    critical_low_priority: { freq: 440, type: 'sine', duration: 0.15, interval: 0.5 },
    high_priority: { freq: 523.25, type: 'sine', duration: 0.2, interval: 1.0 },
    medium_priority: { freq: 392, type: 'sine', duration: 0.25, interval: 1.5 },
};

// Initialization
export function initializeAlarms(monitorElements) {
    console.log("[AlarmManager] Initializing (v2 - English + Network Mute + Original Sound Intervals + Sound Restart Prevention)...");
    soundToggleButton = document.getElementById("toggle-alarm-sounds-btn");
    if (soundToggleButton) {
        soundToggleButton.addEventListener('click', toggleSounds);
        _updateSoundButtonVisuals();
    } else {
        console.warn("[AlarmManager] Sound toggle button not found.");
    }

    visualAlarmElements = {
        ecg: { wrapper: monitorElements?.ecg, value: document.getElementById("hr-value") },
        spo2: { wrapper: monitorElements?.spo2, value: document.getElementById("spo2-value") },
        abp: { wrapper: monitorElements?.abp, value: document.getElementById("abp-sys-value") },
        etco2: { wrapper: monitorElements?.etco2, value: document.getElementById("etco2-value") },
    };

    try {
        if (!audioContext && (window.AudioContext || window.webkitAudioContext)) {
           audioContext = new (window.AudioContext || window.webkitAudioContext)();
           console.log("[AlarmManager] AudioContext initialized.");
           if (audioContext.state === 'suspended') {
               const resumeContext = () => {
                   audioContext.resume().then(() => {
                       console.log("[AlarmManager] AudioContext resumed successfully.");
                       document.body.removeEventListener('click', resumeContext);
                       document.body.removeEventListener('touchend', resumeContext);
                   }).catch(e => console.error("[AlarmManager] Error resuming AudioContext:", e));
               };
               console.log("[AlarmManager] AudioContext suspended. Add click/touch listener to resume.");
               document.body.addEventListener('click', resumeContext, { once: true });
               document.body.addEventListener('touchend', resumeContext, { once: true });
           }
        } else if (!audioContext) {
             throw new Error("Web Audio API not supported.");
        }
    } catch (e) {
        console.error("[AlarmManager] Web Audio API initialization failed:", e);
        if (soundToggleButton) {
            soundToggleButton.disabled = true;
            soundToggleButton.textContent = "Audio Error";
        }
        soundsEnabled = false;
    }
     resetActiveAlarms();
}

function resetActiveAlarms() {
    activeAlarms = {};
     Object.keys(visualAlarmElements).forEach(paramKey => {
         const elements = visualAlarmElements[paramKey];
         if (elements?.wrapper) {
             elements.wrapper.classList.remove('alarm-active-low', 'alarm-active-high');
         }
         if (elements?.value) {
             elements.value.classList.remove('alarm-value-active');
         }
     });
}

export function checkAlarms(currentParams) {
    if (!currentParams) return {};
    const nowActive = {};
    const thresholds = ALARM_THRESHOLDS;

    if (currentParams.ecg?.visible && currentParams.ecg.params &&
        !currentParams.ecg.params.isFlat && !currentParams.ecg.params.isChaotic &&
        !currentParams.ecg.params.isPEA && !currentParams.ecg.params.isArtifact) {
        const hr = ensureFinite(currentParams.ecg.hr, null);
        if (hr !== null) {
            if (hr < thresholds.ecg.low_hr) nowActive['low_hr'] = true;
            if (hr > thresholds.ecg.high_hr) nowActive['high_hr'] = true;
        }
    }

    if (currentParams.spo2?.visible) {
        const spo2 = ensureFinite(currentParams.spo2.value, null);
         if (spo2 !== null && spo2 > 0 && currentParams.spo2.shape !== 'no_signal') {
             if (spo2 < thresholds.spo2.low) nowActive['low_spo2'] = true;
         }
    }

    if (currentParams.abp?.visible && !(currentParams.ecg?.params?.isArtifact && currentParams.ecg?.params?.artifactType === 'cpr')) {
         const sys = ensureFinite(currentParams.abp.sys, null);
         const dia = ensureFinite(currentParams.abp.dia, null);
         if (sys !== null && dia !== null && sys > 0 && dia >= 0 && sys > dia) {
            const map = Math.round(dia + (sys - dia) / 3);
            if (map < thresholds.abp.low_map) {
                nowActive['low_map'] = true;
            }
         }
    }

    if (currentParams.etco2?.visible) {
        const valueKpa = ensureFinite(currentParams.etco2.valueKpa, null);
        if (valueKpa !== null && valueKpa > 0 &&
            currentParams.etco2.etco2Shape !== 'disconnect' &&
            currentParams.etco2.etco2Shape !== 'cpr_low_flow') {
            if (valueKpa < thresholds.etco2.low_kpa) nowActive['low_etco2'] = true;
            if (valueKpa > thresholds.etco2.high_kpa) nowActive['high_etco2'] = true;
        }
    }
    activeAlarms = nowActive;
    return activeAlarms;
}

export function updateAlarmVisuals() {
    _updateSingleVisual('ecg', 'low_hr', 'high_hr');
    _updateSingleVisual('spo2', 'low_spo2', null);
    _updateSingleVisual('abp', 'low_map', null);
    _updateSingleVisual('etco2', 'low_etco2', 'high_etco2');
}

function _updateSingleVisual(paramKey, lowAlarmKey, highAlarmKey) {
    const elements = visualAlarmElements[paramKey];
    if (!elements || (!elements.wrapper && !elements.value)) return;
    const isLow = lowAlarmKey && activeAlarms[lowAlarmKey];
    const isHigh = highAlarmKey && activeAlarms[highAlarmKey];
    if (elements.wrapper) {
       elements.wrapper.classList.toggle('alarm-active-low', !!isLow);
       elements.wrapper.classList.toggle('alarm-active-high', !!isHigh && !isLow);
    }
    if (elements.value) {
        elements.value.classList.toggle('alarm-value-active', !!isLow || !!isHigh);
    }
}

export function triggerAlarmSounds(newlyActiveAlarms) {
    if (!audioContext || audioContext.state !== 'running') {
        stopAlarmSound();
        return;
    }
    if (!soundsEnabled) {
        stopAlarmSound();
        return;
    }

    // --- LISÄTTY TARKISTUS: Älä tee mitään, jos ääniajastin on jo aktiivinen ---
    // Tämä estää triggerAlarmSounds-funktion (jota kutsutaan usein)
    // keskeyttämästä ja käynnistämästä playAlarmSound-funktiota uudelleen ennenaikaisesti.
    if (alarmSoundTimeoutId !== null || currentOscillator !== null) {
        // console.log("[AlarmManager] Sound sequence already in progress or scheduled. Skipping new trigger.");
        return;
    }
    // --- TARKISTUKSEN LOPPU ---

    const anyAlarmsActive = Object.values(activeAlarms).some(isActive => isActive);
    if (!anyAlarmsActive) {
        stopAlarmSound();
        return;
    }

    let soundProfileToPlay = null;
    if (activeAlarms['low_spo2'] || activeAlarms['low_map']) {
        soundProfileToPlay = ALARM_SOUNDS.critical_low_priority;
    } else if (activeAlarms['low_hr'] || activeAlarms['high_hr']) {
        soundProfileToPlay = ALARM_SOUNDS.high_priority;
    } else if (activeAlarms['low_etco2'] || activeAlarms['high_etco2']) {
        soundProfileToPlay = ALARM_SOUNDS.medium_priority;
    }

    if (soundProfileToPlay) {
        playAlarmSound(soundProfileToPlay);
    } else {
        console.warn("[AlarmManager] Active alarms present, but no specific sound profile matched. Stopping sound.");
        stopAlarmSound();
    }
}

function playAlarmSound(soundProfile) {
    if (!audioContext || audioContext.state !== 'running' || !soundsEnabled) {
         stopAlarmSound();
         return;
    }
    // Pysäytä AINOASTAAN edellinen oskillaattori, ÄLÄ timeoutId:tä tässä.
    // TimeoutId:n nollaus tapahtuu vain, kun uusi timeout asetetaan tai kun äänet eksplisiittisesti pysäytetään.
    if (currentOscillator && audioContext) {
        try {
            currentOscillator.stop(audioContext.currentTime);
        } catch (e) { /* ignore */ }
        currentOscillator = null;
    }
    // Nollaa AINA timeoutId ennen uuden asettamista, jotta vanhat eivät jää kummittelemaan.
    if (alarmSoundTimeoutId) {
        clearTimeout(alarmSoundTimeoutId);
        alarmSoundTimeoutId = null;
    }

    try {
         if (!audioContext || typeof audioContext.currentTime === 'undefined') {
            console.warn("[AlarmManager] AudioContext not ready for playback.");
            return;
         }
        const now = audioContext.currentTime;
        const osc = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        osc.type = soundProfile.type;
        osc.frequency.setValueAtTime(soundProfile.freq, now);
        gainNode.gain.setValueAtTime(0.2, now);
        osc.connect(gainNode);
        gainNode.connect(audioContext.destination);
        osc.start(now);
        osc.stop(now + soundProfile.duration);
        currentOscillator = osc;

        // Ajasta seuraava äänen tarkistus/toisto
        alarmSoundTimeoutId = setTimeout(() => {
            currentOscillator = null; // Oskillaattori on pysähtynyt
            alarmSoundTimeoutId = null; // Nollaa ID, jotta triggerAlarmSounds voi käynnistää uuden sekvenssin tarvittaessa

            // Kutsu triggerAlarmSounds uudelleen tarkistamaan tilanne ja mahdollisesti toistamaan ääni
            // Tämä on parempi kuin suoraan playAlarmSound, jotta priorisointi ja ehdot tarkistetaan uudelleen.
            // Välitetään tyhjä objekti, koska tämä ei ole "uusi" hälytys vaan jatkoa.
            if (soundsEnabled && Object.values(activeAlarms).some(isActive => isActive)) {
                 triggerAlarmSounds({}); // Kutsu triggerAlarmSounds uudelleen
            } else {
                stopAlarmSound(); // Jos äänet on mykistetty tai hälytyksiä ei ole, pysäytä.
            }
        }, soundProfile.interval * 1000);
    } catch (e) {
        console.error("[AlarmManager] Error playing sound:", e);
        stopAlarmSound();
    }
}

// stopAlarmSound pysyy pääosin ennallaan, mutta varmistetaan, että se nollaa molemmat.
function stopAlarmSound() {
     if (alarmSoundTimeoutId) {
         clearTimeout(alarmSoundTimeoutId);
         alarmSoundTimeoutId = null;
     }
    if (currentOscillator && audioContext) {
        try {
            currentOscillator.stop(audioContext.currentTime);
        } catch (e) {
            // Ohita virheet
        } finally {
             currentOscillator = null;
        }
    }
}

export function toggleSounds() {
     if (!audioContext) return;
    soundsEnabled = !soundsEnabled;
    console.log(`[AlarmManager] Sounds ${soundsEnabled ? 'Enabled' : 'Disabled'} (Toggled locally)`);
    _updateSoundButtonVisuals();
    if (getCurrentRole() === 'controller') {
        console.log("[AlarmManager] Sending sound state update via network.");
        sendSoundStateUpdate(soundsEnabled);
    }

    if (!soundsEnabled) {
        stopAlarmSound(); // Pysäytä äänet heti, jos mykistetään
    } else {
        // Jos äänet laitetaan päälle, triggerAlarmSounds (joka kutsutaan animaatioloopista)
        // hoitaa äänien uudelleenkäynnistyksen, jos hälytyksiä on aktiivisena.
        // Ei tarvitse kutsua erikseen tässä, koska animaatioloppi hoitaa.
        // Varmistetaan kuitenkin, että jos mitään ei ole ajoitettu, se voi alkaa.
        if (!alarmSoundTimeoutId && !currentOscillator && Object.values(activeAlarms).some(isActive => isActive)) {
            triggerAlarmSounds({});
        }
    }
}

export function setSoundState(newState) {
    if (typeof newState !== 'boolean') {
        console.warn("[AlarmManager] Invalid sound state received:", newState);
        return;
    }
    if (getCurrentRole() !== 'monitor') {
        return;
    }
    if (soundsEnabled === newState) {
        return;
    }
    console.log(`[AlarmManager] Setting sound state to: ${newState ? 'Enabled' : 'Disabled'} based on remote command.`);
    soundsEnabled = newState;
    _updateSoundButtonVisuals();

    if (!soundsEnabled) {
        stopAlarmSound();
    } else {
        // Jos äänet laitetaan päälle etäkomennolla ja hälytyksiä on aktiivisena,
        // annetaan animaatioloopin triggerAlarmSounds-kutsun hoitaa käynnistys.
        // Varmistetaan, että jos mitään ei ole ajoitettu, se voi alkaa.
        if (!alarmSoundTimeoutId && !currentOscillator && Object.values(activeAlarms).some(isActive => isActive)) {
            triggerAlarmSounds({});
        }
    }
}

function _updateSoundButtonVisuals() {
    if (soundToggleButton) {
        if (soundsEnabled) {
            soundToggleButton.textContent = "Mute Alarms";
            soundToggleButton.classList.remove('btn-warning');
            soundToggleButton.classList.add('btn-secondary');
        } else {
            soundToggleButton.textContent = "Unmute Alarms";
            soundToggleButton.classList.remove('btn-secondary');
            soundToggleButton.classList.add('btn-warning');
        }
    }
}

export function resetAlarmsOnStop() {
    console.log("[AlarmManager] Resetting alarms on simulation stop.");
    stopAlarmSound();
    resetActiveAlarms();
}
