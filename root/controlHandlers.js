// controlHandlers.js - Event Binding and Handling Helper Functions
// VERSION: Fixed ECG parameter comparison in showPendingChanges.
//          Added color picker handling, preset saving/loading for colors.
//          Fixed local application of changes (including colors) in standalone mode.
//          Revised preset application logic for better change detection.
//          Added logging to showPendingChanges for debugging preset issue.
//          LISÄTTY: Custom-presettien tallennus ja lataus localStorageen.
//          FIXED: When applying a preset that changes from a pulseless rhythm (e.g., VF, HR=0)
//                 to a perfusing rhythm, ensure targetParams.ecg.hr is correctly updated
//                 to the new rhythm's baseHR or preset HR, not stuck at 0.
//          FIXED (V2): Ensure targetParams.ecg.hr updates correctly when MANUALLY changing
//                      from a pulseless rhythm to a perfusing rhythm via dropdown.
//          MODIFIED: Removed RR slider and RR adjust button lock when cpr_artifact is active.
//                    Ensured SpO2, ABP, ETCO2, and Temp controls remain enabled.

import { RHYTHM_PARAMS } from "./rhythms.js";
import {
    KPA_TO_MMHG,
    DEFAULT_ETCO2_KPA,
    DEFAULT_RESP_RATE,
    DEFAULT_SPO2_SHAPE,
    DEFAULT_ABP_SHAPE,
    DEFAULT_ETCO2_SHAPE,
    DEFAULT_TEMP_C,
    DEFAULT_TEMP_UNIT,
    celsiusToFahrenheit,
    fahrenheitToCelsius
} from "./config.js";
import { ensureFinite } from "./waveformUtils.js";

import { updateMonitorColors } from "./uiUpdater.js";
import { checkAlarms, updateAlarmVisuals, triggerAlarmSounds } from './alarmManager.js';
// Import network functions
import {
    sendParamUpdate,
    getCurrentRole,
    sendActivateCommand,
    sendDeactivateCommand,
    sendNibpTrigger
} from './networkManager.js';

// --- Preset Definitions ---
const PRESETS = {
    healthy: { ecg: { rhythm: 'normal', hr: 75 }, spo2: { value: 98, shape: DEFAULT_SPO2_SHAPE, visible: true }, abp: { sys: 120, dia: 80, shape: DEFAULT_ABP_SHAPE, visible: true }, etco2: { valueKpa: DEFAULT_ETCO2_KPA, rr: DEFAULT_RESP_RATE, etco2Shape: DEFAULT_ETCO2_SHAPE, visible: true, unitPref: 'kPa' }, temp: { valueC: DEFAULT_TEMP_C, visible: true, unitPref: 'C' }, nibp: { visible: true } },
    stemi: { ecg: { rhythm: 'stemi', hr: 90 }, spo2: { value: 96, shape: 'low_perfusion', visible: true }, abp: { sys: 145, dia: 90, shape: DEFAULT_ABP_SHAPE, visible: true }, etco2: { valueKpa: DEFAULT_ETCO2_KPA, rr: 18, etco2Shape: DEFAULT_ETCO2_SHAPE, visible: true, unitPref: 'kPa' }, temp: { valueC: DEFAULT_TEMP_C, visible: true, unitPref: 'C' }, nibp: { visible: true } },
    hypovolemic_shock: { ecg: { rhythm: 'tachy', hr: 130 }, spo2: { value: 92, shape: 'low_perfusion', visible: true }, abp: { sys: 80, dia: 50, shape: 'vasoconstricted', visible: true }, etco2: { valueKpa: 4.0, rr: 24, etco2Shape: 'normal', visible: true, unitPref: 'kPa' }, temp: { valueC: 36.0, visible: true, unitPref: 'C' }, nibp: { visible: true } },
    svt: { ecg: { rhythm: 'svt', hr: 180 }, spo2: { value: 97, shape: 'normal', visible: true }, abp: { sys: 100, dia: 70, shape: 'normal', visible: true }, etco2: { valueKpa: DEFAULT_ETCO2_KPA, rr: DEFAULT_RESP_RATE, etco2Shape: DEFAULT_ETCO2_SHAPE, visible: true, unitPref: 'kPa' }, temp: { valueC: DEFAULT_TEMP_C, visible: true, unitPref: 'C' }, nibp: { visible: true } },
    asystole: { ecg: { rhythm: 'asystole', hr: 0 }, spo2: { value: 0, shape: 'no_signal', visible: true }, abp: { sys: 0, dia: 0, shape: 'damped', visible: true }, etco2: { valueKpa: 0, rr: 0, etco2Shape: 'disconnect', visible: true, unitPref: 'kPa' }, temp: { valueC: DEFAULT_TEMP_C, visible: true, unitPref: 'C' }, nibp: { visible: true } },
    vf: { ecg: { rhythm: 'vf', hr: 0 }, spo2: { value: 0, shape: 'no_signal', visible: true }, abp: { sys: 0, dia: 0, shape: 'damped', visible: true }, etco2: { valueKpa: 0, rr: 0, etco2Shape: 'disconnect', visible: true, unitPref: 'kPa' }, temp: { valueC: DEFAULT_TEMP_C, visible: true, unitPref: 'C' }, nibp: { visible: true } },
    pea: { ecg: { rhythm: 'pea', hr: 40 }, spo2: { value: 0, shape: 'no_signal', visible: true }, abp: { sys: 0, dia: 0, shape: 'damped', visible: true }, etco2: { valueKpa: 0, rr: 0, etco2Shape: 'disconnect', visible: true, unitPref: 'kPa' }, temp: { valueC: DEFAULT_TEMP_C, visible: true, unitPref: 'C' }, nibp: { visible: true } }
};

let loadedCustomPresets = [];
let nextCustomPresetId = 0;
const CUSTOM_PRESETS_STORAGE_KEY = 'medicalMonitorCustomPresets_v1.1';

// New: Cases data model (each case has id, name, presets[])
let loadedCases = [];
let nextCaseId = 0;
const CASES_STORAGE_KEY = 'medicalMonitorCases_v1.0';
const ADJUST_STEPS = { HR: 5, SPO2: 1, ABP_SYS: 5, ABP_DIA: 5, ETCO2_KPA: 0.1, ETCO2_MMHG: 1, RR: 1, TEMP_C: 0.1, TEMP_F: 0.2 };

// Compute an auto-adjusted diastolic when systolic is driven below diastolic.
// Uses previous pulse pressure as a guide and clamps to sensible bounds.
function _computeAutoDiaForSys(newSys, prevSys, prevDia) {
    const DEFAULT_PP = 40; // typical pulse pressure
    const MIN_PP = 20; // avoid implausibly narrow PP
    const MAX_PP = 60; // avoid implausibly wide PP for auto-adjust

    let prevPP = DEFAULT_PP;
    if (typeof prevSys === 'number' && typeof prevDia === 'number') {
        prevPP = (prevSys - prevDia) || DEFAULT_PP;
    }
    if (!isFinite(prevPP) || prevPP <= 0) prevPP = DEFAULT_PP;
    const targetPP = Math.max(MIN_PP, Math.min(MAX_PP, Math.round(prevPP)));

    let newDia = Math.round(newSys - targetPP);
    if (newDia >= newSys) newDia = Math.max(0, newSys - 1);
    newDia = Math.max(0, newDia);
    return newDia;
}

function _computeAutoSysForDia(newDia, prevSys, prevDia) {
    const DEFAULT_PP = 40;
    const MIN_PP = 20;
    const MAX_PP = 60;
    let prevPP = DEFAULT_PP;
    if (typeof prevSys === 'number' && typeof prevDia === 'number') {
        prevPP = (prevSys - prevDia) || DEFAULT_PP;
    }
    if (!isFinite(prevPP) || prevPP <= 0) prevPP = DEFAULT_PP;
    const targetPP = Math.max(MIN_PP, Math.min(MAX_PP, Math.round(prevPP)));
    let newSys = Math.round(newDia + targetPP);
    if (newSys <= newDia) newSys = newDia + 1;
    return Math.max(newSys, newDia + 1);
}

function _addListener(elementId, eventType, handler) {
    const element = document.getElementById(elementId);
    if(element) { element.addEventListener(eventType, handler); }
    else { console.warn(`[_addListener] Element #${elementId} not found.`); }
}

function _handleVisibilityChange(paramKey, event, monitorInstance) {
     if(monitorInstance.targetParams[paramKey]) {
         monitorInstance.targetParams[paramKey].visible = event.target.checked;
         monitorInstance.showPendingChanges();
     }
}

function _handleEcgRhythmChange(event, monitorInstance) {
     const rhythmKey = event.target.value;
     const newParamsFromRhythms = RHYTHM_PARAMS[rhythmKey];

    if(newParamsFromRhythms && monitorInstance.targetParams.ecg) {
         const rhythmChanged = monitorInstance.targetParams.ecg.rhythm !== rhythmKey;
         monitorInstance.targetParams.ecg.rhythm = rhythmKey;
         monitorInstance.targetParams.ecg.params = JSON.parse(JSON.stringify(newParamsFromRhythms));

         const currentEcgParams = monitorInstance.targetParams.ecg.params;
         const isCprArtifact = rhythmKey === 'cpr_artifact';
         const isPulseless = !isCprArtifact && (currentEcgParams.isPEA || currentEcgParams.isChaotic || currentEcgParams.isFlat || rhythmKey === 'vt_pulseless');
         const isVTWithPulse = rhythmKey === 'vt';

         if (isCprArtifact || isPulseless) {
             monitorInstance.targetParams.ecg.hr = 0;
             if (monitorInstance.targetParams.spo2) {
                 monitorInstance.targetParams.spo2.value = isCprArtifact ? (currentEcgParams.spo2Value ?? 0) : 0;
                 monitorInstance.targetParams.spo2.shape = isCprArtifact ? (currentEcgParams.spo2Shape ?? 'no_signal') : 'no_signal';
             }
             if (monitorInstance.targetParams.abp) {
                 monitorInstance.targetParams.abp.sys = isCprArtifact ? (currentEcgParams.cpr_abp_sys ?? 0) : 0;
                 monitorInstance.targetParams.abp.dia = isCprArtifact ? (currentEcgParams.cpr_abp_dia ?? 0) : 0;
                 monitorInstance.targetParams.abp.shape = isCprArtifact ? (currentEcgParams.cpr_abp_shape ?? 'damped') : 'damped';
             }
             if (monitorInstance.targetParams.etco2) {
                 monitorInstance.targetParams.etco2.valueKpa = isCprArtifact ? (currentEcgParams.etco2ValueKpa ?? 0) : 0;
                 monitorInstance.targetParams.etco2.rr = isCprArtifact ? (currentEcgParams.respiratoryRate ?? 0) : 0;
                 monitorInstance.targetParams.etco2.etco2Shape = isCprArtifact ? (currentEcgParams.etco2Shape ?? 'cpr_low_flow') : 'disconnect';
             }
         } else {
             let hrSourceValue;
             if (isVTWithPulse || currentEcgParams.baseHR !== undefined) {
                 hrSourceValue = currentEcgParams.baseHR;
             } else {
                 const hrSlider = document.getElementById('hr-slider');
                 const sliderVal = hrSlider ? parseInt(hrSlider.value, 10) : (currentEcgParams.baseHR ?? 75);
                 hrSourceValue = (monitorInstance.targetParams.ecg.hr === 0 && sliderVal === 0) ? (currentEcgParams.baseHR ?? 75) : sliderVal;
             }
             const { initialHR } = monitorInstance._calculateInitialHR(currentEcgParams, hrSourceValue);
             monitorInstance.targetParams.ecg.hr = initialHR;

             if (monitorInstance.targetParams.spo2 && monitorInstance.targetParams.spo2.shape === 'no_signal') {
                 monitorInstance.targetParams.spo2.value = RHYTHM_PARAMS[rhythmKey]?.spo2Value ?? DEFAULT_SPO2_SHAPE === 'no_signal' ? 98 : (monitorInstance.targetParams.spo2.value || 98);
                 monitorInstance.targetParams.spo2.shape = RHYTHM_PARAMS[rhythmKey]?.spo2Shape ?? DEFAULT_SPO2_SHAPE;
             }
             if (monitorInstance.targetParams.abp && monitorInstance.targetParams.abp.shape === 'damped' && (monitorInstance.targetParams.abp.sys === 0 || monitorInstance.targetParams.abp.dia === 0) ) {
                 monitorInstance.targetParams.abp.sys = RHYTHM_PARAMS[rhythmKey]?.abpSys ?? 120;
                 monitorInstance.targetParams.abp.dia = RHYTHM_PARAMS[rhythmKey]?.abpDia ?? 80;
                 monitorInstance.targetParams.abp.shape = RHYTHM_PARAMS[rhythmKey]?.abpShape ?? DEFAULT_ABP_SHAPE;
             }
             if (monitorInstance.targetParams.etco2 && (monitorInstance.targetParams.etco2.etco2Shape === 'disconnect' || monitorInstance.targetParams.etco2.etco2Shape === 'cpr_low_flow')) {
                 monitorInstance.targetParams.etco2.valueKpa = RHYTHM_PARAMS[rhythmKey]?.etco2ValueKpa ?? DEFAULT_ETCO2_KPA;
                 monitorInstance.targetParams.etco2.rr = RHYTHM_PARAMS[rhythmKey]?.respiratoryRate ?? DEFAULT_RESP_RATE;
                 monitorInstance.targetParams.etco2.etco2Shape = RHYTHM_PARAMS[rhythmKey]?.etco2Shape ?? DEFAULT_ETCO2_SHAPE;
             }
         }
         monitorInstance.updateControlsToReflectParams();
         monitorInstance.updateSliderDisplays();
         if (rhythmChanged) {
             console.log(`[_handleEcgRhythmChange] Target rhythm changed to ${rhythmKey}. New Target HR: ${monitorInstance.targetParams.ecg.hr}`);
         }
         monitorInstance.showPendingChanges();
     } else {
         console.error(`[_handleEcgRhythmChange] Params missing for rhythm: ${rhythmKey} or targetParams.ecg missing`);
     }
}

function _handleHrSliderInput(event, monitorInstance) { if(!monitorInstance.targetParams.ecg || !monitorInstance.targetParams.ecg.params) return; const ecgParams = monitorInstance.targetParams.ecg.params; const isFixedOrPulseless = monitorInstance.targetParams.ecg.rhythm === 'cpr_artifact' || ecgParams.isPEA || ecgParams.isChaotic || ecgParams.isFlat || monitorInstance.targetParams.ecg.rhythm === 'vt_pulseless'; if (!isFixedOrPulseless) { const { canChangeHR } = monitorInstance._calculateInitialHR(ecgParams, monitorInstance.targetParams.ecg.hr); if(!canChangeHR) { const { initialHR } = monitorInstance._calculateInitialHR(ecgParams, monitorInstance.targetParams.ecg.hr); event.target.value = initialHR >= 0 ? initialHR : event.target.min; monitorInstance.updateSliderDisplays(); return; } } else { event.target.value = 0; monitorInstance.targetParams.ecg.hr = 0; monitorInstance.updateSliderDisplays(); return; } monitorInstance.targetParams.ecg.hr = parseInt(event.target.value, 10); monitorInstance.updateSliderDisplays(); monitorInstance.showPendingChanges(); }
function _handleSpo2SliderInput(event, monitorInstance) { if(monitorInstance.targetParams.spo2){ monitorInstance.targetParams.spo2.value = parseInt(event.target.value,10); monitorInstance.updateSliderDisplays(); monitorInstance.showPendingChanges(); } }
function _handleSpo2ShapeChange(event, monitorInstance) { if(monitorInstance.targetParams.spo2) { monitorInstance.targetParams.spo2.shape=event.target.value; monitorInstance.showPendingChanges(); } }
function _handleAbpSysInput(event, monitorInstance) {
    if(!monitorInstance.targetParams.abp) return;
    const newSys = parseInt(event.target.value, 10);
    const dia = monitorInstance.targetParams.abp.dia ?? 0;

    // Preserve existing zero/zero special case
    if (dia === 0 && newSys === 0) {
        monitorInstance.targetParams.abp.sys = 0;
    } else {
        if (newSys <= dia) {
            // User lowered systolic below current diastolic: compute a physiologic
            // diastolic using previous pulse pressure as a guide so the change
            // remains believable and the user can then fine-tune diastolic.
            const prevSys = monitorInstance.targetParams.abp.sys ?? newSys;
            const prevDia = monitorInstance.targetParams.abp.dia ?? dia;
            const newDia = _computeAutoDiaForSys(newSys, prevSys, prevDia);
            monitorInstance.targetParams.abp.dia = newDia;
            monitorInstance.targetParams.abp.sys = newSys;
            const diaSlider = document.getElementById('abp-dia-slider');
            if (diaSlider) diaSlider.value = monitorInstance.targetParams.abp.dia;
        } else {
            monitorInstance.targetParams.abp.sys = newSys;
        }
    }

    // Mark as a recent user edit so animation/interpolation doesn't immediately overwrite
    try { monitorInstance._lastAbpUserEdit = { type: 'sys', ts: Date.now() }; } catch (e) { /* ignore */ }

    monitorInstance.updateSliderDisplays();
    monitorInstance.showPendingChanges();
}
function _handleAbpDiaInput(event, monitorInstance) {
    if(!monitorInstance.targetParams.abp) return;
    const newDia = parseInt(event.target.value, 10);
    const sys = monitorInstance.targetParams.abp.sys ?? 0;
    if (!(sys === 0 && newDia === 0) && newDia >= sys) {
        // User raised diastolic above systolic: auto-raise systolic to maintain
        // a physiologic pulse pressure (use previous PP as guide).
        const prevSys = monitorInstance.targetParams.abp.sys ?? sys;
        const prevDia = monitorInstance.targetParams.abp.dia ?? 0;
        const suggestedSys = Math.max(sys + 1, prevDia >= 0 ? (newDia + Math.max(20, Math.min(60, Math.round(prevSys - prevDia || 40)))) : (newDia + 1));
        monitorInstance.targetParams.abp.sys = suggestedSys;
        monitorInstance.targetParams.abp.dia = Math.max(0, newDia);
        const sysSlider = document.getElementById('abp-sys-slider');
        if (sysSlider) sysSlider.value = monitorInstance.targetParams.abp.sys;
    } else {
        const validDia = (sys === 0 && newDia === 0) ? 0 : Math.min(newDia, sys - 1);
        monitorInstance.targetParams.abp.dia = Math.max(0, validDia);
    }
    if (newDia !== monitorInstance.targetParams.abp.dia && event.target) event.target.value = monitorInstance.targetParams.abp.dia;

    try { monitorInstance._lastAbpUserEdit = { type: 'dia', ts: Date.now() }; } catch (e) { /* ignore */ }

    monitorInstance.updateSliderDisplays();
    monitorInstance.showPendingChanges();
}
function _handleAbpShapeChange(event, monitorInstance) { if(monitorInstance.targetParams.abp) { monitorInstance.targetParams.abp.shape=event.target.value; monitorInstance.showPendingChanges(); } }
function _handleEtco2ValueInput(event, monitorInstance) { if(!monitorInstance.targetParams.etco2) return; const sliderValue=parseFloat(event.target.value); const valueKpa=monitorInstance.targetParams.etco2.unitPref==='mmHg'?sliderValue/KPA_TO_MMHG:sliderValue; monitorInstance.targetParams.etco2.valueKpa=valueKpa; monitorInstance.updateSliderDisplays(); monitorInstance.showPendingChanges(); }
function _handleEtco2RRInput(event, monitorInstance) { if(monitorInstance.targetParams.etco2) { monitorInstance.targetParams.etco2.rr=parseInt(event.target.value,10); monitorInstance.updateSliderDisplays(); monitorInstance.showPendingChanges(); } }
function _handleEtco2UnitChange(event, monitorInstance) { if(!monitorInstance.targetParams.etco2) return; monitorInstance.targetParams.etco2.unitPref=event.target.checked?'mmHg':'kPa'; monitorInstance.updateControlsToReflectParams(); monitorInstance.updateSliderDisplays(); monitorInstance.showPendingChanges(); }
function _handleEtco2ShapeChange(event, monitorInstance) { if(monitorInstance.targetParams.etco2) { monitorInstance.targetParams.etco2.etco2Shape=event.target.value; monitorInstance.showPendingChanges(); } }
function _handleNibpStart(monitorInstance) {
    if (!monitorInstance.targetParams.abp || !monitorInstance.currentParams.nibp) { console.warn("[_handleNibpStart] Cannot start NIBP: Missing target ABP or current NIBP params."); return; }
    console.log("[_handleNibpStart] NIBP Start triggered.");
    const targetSys = ensureFinite(monitorInstance.targetParams.abp.sys, 0); const targetDia = ensureFinite(monitorInstance.targetParams.abp.dia, 0);
    let measuredSys, measuredDia, measuredMap; const measurementTime = new Date();
    if (targetSys < 30 && targetDia < 20) {
        measuredSys = null;
        measuredDia = null;
        measuredMap = null;
        console.log("[_handleNibpStart] Simulating failed NIBP measurement due to low target ABP.");
    } else {
        // Use exact user-specified ABP values for NIBP measurement (no random noise)
        measuredSys = Math.round(targetSys);
        measuredDia = Math.round(targetDia);
        measuredDia = Math.max(0, measuredDia);
        // Ensure systolic is at least a few mmHg above diastolic for plausibility
        if (measuredSys <= measuredDia) measuredSys = measuredDia + 1;
        measuredMap = (measuredSys > measuredDia) ? Math.round(measuredDia + (measuredSys - measuredDia) / 3) : null;
    }
    monitorInstance.currentParams.nibp.sys = measuredSys; monitorInstance.currentParams.nibp.dia = measuredDia; monitorInstance.currentParams.nibp.map = measuredMap; monitorInstance.currentParams.nibp.timestamp = measurementTime;
    monitorInstance.targetParams.nibp.sys = measuredSys; monitorInstance.targetParams.nibp.dia = measuredDia; monitorInstance.targetParams.nibp.map = measuredMap; monitorInstance.targetParams.nibp.timestamp = measurementTime;
    monitorInstance.updateVitalsDisplay(); console.log("[_handleNibpStart] Local NIBP updated:", monitorInstance.currentParams.nibp);
    const role = getCurrentRole();
    if (role === 'controller') { const nibpDataToSend = { sys: measuredSys, dia: measuredDia, map: measuredMap, timestamp: measurementTime.toISOString() }; console.log("[_handleNibpStart] Sending NIBP trigger via network with data:", nibpDataToSend); sendNibpTrigger(nibpDataToSend); }
}
function _handleTempSliderInput(event, monitorInstance) { if(!monitorInstance.targetParams.temp) return; const sliderValue=parseFloat(event.target.value); const isFahrenheit=monitorInstance.targetParams.temp.unitPref==='F'; const newTempC=isFahrenheit?fahrenheitToCelsius(sliderValue):sliderValue; monitorInstance.targetParams.temp.valueC=newTempC; monitorInstance.updateSliderDisplays(); monitorInstance.showPendingChanges(); }
function _handleTempUnitChange(event, monitorInstance) { if(!monitorInstance.targetParams.temp) return; const isFahrenheit=event.target.checked; const newUnitPref=isFahrenheit?'F':'C'; monitorInstance.targetParams.temp.unitPref=newUnitPref; monitorInstance.updateControlsToReflectParams(); monitorInstance.updateSliderDisplays(); monitorInstance.showPendingChanges(); }
function _handleActivateClick(monitorInstance) {
    console.log("Activate/Deactivate button clicked.");
    if (!monitorInstance || !monitorInstance.chartInitialized || typeof monitorInstance.startAnimation !== 'function' || typeof monitorInstance.stopAnimation !== 'function') { console.error("Cannot toggle activation: Monitor object invalid or not fully initialized."); const btn = document.getElementById("activate-button"); if (btn) { btn.textContent = "Error"; btn.disabled = true; btn.classList.remove("btn-success", "btn-danger"); btn.classList.add("btn-secondary"); } return; }
    const role = getCurrentRole();
    if (!monitorInstance.animationRunning) {
        console.log("Activating simulation..."); monitorInstance.startAnimation();
        if (!monitorInstance.animationRunning) console.error("Activation failed internally in startAnimation.");
        else if (role === 'controller') { console.log("[Controller] Sending activate command..."); sendActivateCommand(); }
    } else {
        console.log("Deactivating simulation..."); monitorInstance.stopAnimation();
        if (monitorInstance.animationRunning) console.error("Deactivation failed internally in stopAnimation.");
        else if (role === 'controller') { console.log("[Controller] Sending deactivate command..."); sendDeactivateCommand(); }
    }
    const activateButton = document.getElementById("activate-button");
    if (activateButton) { activateButton.textContent = monitorInstance.animationRunning ? "Deactivate Monitor" : "Activate Monitor"; activateButton.classList.toggle("btn-success", !monitorInstance.animationRunning); activateButton.classList.toggle("btn-danger", monitorInstance.animationRunning); }
}
function _handleEcgShock(monitorInstance) { if(monitorInstance && monitorInstance.animationRunning){ console.log("[_handleEcgShock] Shock button clicked."); monitorInstance.requestShock(); } else { console.log("[_handleEcgShock] Shock ignored (simulation not active)."); } }

function _handleCprToggle(monitorInstance) {
    if (!monitorInstance || !monitorInstance.targetParams) return;
    const btn = document.getElementById('ecg-cpr-toggle');
    if (!btn) return;

    const isActive = !!monitorInstance._cprOverrideActive;

    if (!isActive) {
        // Activate CPR override: save current targetParams and immediately apply CPR artifact
        try { monitorInstance._cprSavedTargetParams = JSON.parse(JSON.stringify(monitorInstance.targetParams)); } catch (e) { monitorInstance._cprSavedTargetParams = null; }

        const cprParams = RHYTHM_PARAMS['cpr_artifact'] ? JSON.parse(JSON.stringify(RHYTHM_PARAMS['cpr_artifact'])) : null;
        if (!cprParams) { console.error('[CPR Toggle] cpr_artifact params missing'); return; }

        monitorInstance.targetParams.ecg = monitorInstance.targetParams.ecg || {};
        monitorInstance.targetParams.ecg.rhythm = 'cpr_artifact';
        monitorInstance.targetParams.ecg.params = cprParams;
        monitorInstance.targetParams.ecg.hr = 0;

        if (monitorInstance.targetParams.spo2) {
            monitorInstance.targetParams.spo2.value = cprParams.spo2Value ?? 0;
            monitorInstance.targetParams.spo2.shape = cprParams.spo2Shape ?? monitorInstance.targetParams.spo2.shape;
        }
        if (monitorInstance.targetParams.abp) {
            monitorInstance.targetParams.abp.sys = cprParams.cpr_abp_sys ?? (monitorInstance.targetParams.abp.sys || 0);
            monitorInstance.targetParams.abp.dia = cprParams.cpr_abp_dia ?? (monitorInstance.targetParams.abp.dia || 0);
            monitorInstance.targetParams.abp.shape = cprParams.cpr_abp_shape ?? monitorInstance.targetParams.abp.shape;
        }
        if (monitorInstance.targetParams.etco2) {
            monitorInstance.targetParams.etco2.valueKpa = cprParams.etco2ValueKpa ?? monitorInstance.targetParams.etco2.valueKpa;
            monitorInstance.targetParams.etco2.rr = cprParams.respiratoryRate ?? monitorInstance.targetParams.etco2.rr;
            monitorInstance.targetParams.etco2.etco2Shape = cprParams.etco2Shape ?? monitorInstance.targetParams.etco2.etco2Shape;
        }

        try { monitorInstance.currentParams = JSON.parse(JSON.stringify(monitorInstance.targetParams)); } catch (e) { /* ignore */ }

        monitorInstance._cprOverrideActive = true;
        btn.classList.add('active');
        btn.textContent = 'CPR Artifact: ON';

        monitorInstance.updateControlsToReflectParams();
        monitorInstance.updateSliderDisplays();
        monitorInstance.showPendingChanges();

        try { const role = getCurrentRole(); if (role === 'controller') { const paramsToSend = { ...monitorInstance.targetParams }; delete paramsToSend.params; sendParamUpdate(paramsToSend); console.log('[CPR Toggle] Sent CPR param update to session.'); } } catch (e) { console.error('[CPR Toggle] Network send error', e); }
    } else {
        // Deactivate: restore saved target params
        const saved = monitorInstance._cprSavedTargetParams;
        if (saved) {
            monitorInstance.targetParams = JSON.parse(JSON.stringify(saved));
            try { monitorInstance.currentParams = JSON.parse(JSON.stringify(saved)); } catch (e) { /* ignore */ }
        } else {
            console.warn('[CPR Toggle] No saved params to restore.');
        }
        monitorInstance._cprSavedTargetParams = null;
        monitorInstance._cprOverrideActive = false;
        btn.classList.remove('active');
        btn.textContent = 'Toggle CPR Artifact';

        monitorInstance.updateControlsToReflectParams();
        monitorInstance.updateSliderDisplays();
        monitorInstance.showPendingChanges();

        try { const role = getCurrentRole(); if (role === 'controller') { const paramsToSend = { ...monitorInstance.targetParams }; delete paramsToSend.params; sendParamUpdate(paramsToSend); console.log('[CPR Toggle] Sent restore param update to session.'); } } catch (e) { console.error('[CPR Toggle] Network send error', e); }
    }
}

function _handleAdjustButton(paramType, direction, monitorInstance) {
    let sliderId, targetParamKey, targetSubKey, step, isFloat=false, precision=0;
    let currentUnit=null;
    let targetObj=null;

    switch(paramType){
        case 'hr':
            sliderId='hr-slider';targetParamKey='ecg';targetSubKey='hr';step=ADJUST_STEPS.HR;
            targetObj=monitorInstance.targetParams.ecg;
            if(!targetObj||!targetObj.params)return;
            const ecgParams=targetObj.params;
            const isFixedOrPulseless=targetObj.rhythm==='cpr_artifact'||ecgParams.isPEA||ecgParams.isChaotic||ecgParams.isFlat||targetObj.rhythm==='vt_pulseless';
            if(isFixedOrPulseless)return;
            const {canChangeHR}=monitorInstance._calculateInitialHR(ecgParams,targetObj.hr);
            if(!canChangeHR)return;
            break;
        case 'spo2':
            sliderId='spo2-slider';targetParamKey='spo2';targetSubKey='value';step=ADJUST_STEPS.SPO2;
            targetObj=monitorInstance.targetParams.spo2;
            break;
        case 'abp-sys':
            sliderId='abp-sys-slider';targetParamKey='abp';targetSubKey='sys';step=ADJUST_STEPS.ABP_SYS;
            targetObj=monitorInstance.targetParams.abp;
            break;
        case 'abp-dia':
            sliderId='abp-dia-slider';targetParamKey='abp';targetSubKey='dia';step=ADJUST_STEPS.ABP_DIA;
            targetObj=monitorInstance.targetParams.abp;
            break;
        case 'etco2':
            sliderId='etco2-slider';targetParamKey='etco2';targetSubKey='valueKpa';
            targetObj=monitorInstance.targetParams.etco2;
            if(!targetObj)return;
            currentUnit=targetObj.unitPref||'kPa';
            step=(currentUnit==='mmHg')?(ADJUST_STEPS.ETCO2_MMHG/KPA_TO_MMHG):ADJUST_STEPS.ETCO2_KPA;
            isFloat=true;precision=1;
            break;
        case 'rr':
            sliderId='rr-slider';targetParamKey='etco2';targetSubKey='rr';step=ADJUST_STEPS.RR;
            targetObj=monitorInstance.targetParams.etco2;
            // Poistettu: if(monitorInstance.targetParams.ecg?.rhythm==='cpr_artifact')return;
            break;
        case 'temp':
            sliderId='temp-slider';targetParamKey='temp';targetSubKey='valueC';
            targetObj=monitorInstance.targetParams.temp;
            if(!targetObj)return;
            currentUnit=targetObj.unitPref||'C';
            step=(currentUnit==='F')?fahrenheitToCelsius(ADJUST_STEPS.TEMP_F+32)-fahrenheitToCelsius(32):ADJUST_STEPS.TEMP_C;
            isFloat=true;precision=1;
            break;
        default: console.warn(`_handleAdjustButton: Unknown paramType: ${paramType}`);return;
    }

    const slider=document.getElementById(sliderId);
    if(!slider||!targetObj||typeof targetObj[targetSubKey]==='undefined'){console.warn(`_handleAdjustButton: Missing slider, target object or subkey for ${paramType}`);return;}
    const sliderMin=parseFloat(slider.min);const sliderMax=parseFloat(slider.max);
    let currentValue=targetObj[targetSubKey];
    if(typeof currentValue!=='number'){console.warn(`_handleAdjustButton: Current value for ${targetParamKey}.${targetSubKey} is not a number.`);currentValue=parseFloat(slider.value)||sliderMin;}
    let newValue=(direction==='plus')?currentValue+step:currentValue-step;
    if(isFloat){const factor=Math.pow(10,precision);newValue=Math.round(newValue*factor)/factor;}else{newValue=Math.round(newValue);}
    let finalValueToSet=Math.max(sliderMin,Math.min(sliderMax,newValue));
    if (paramType === 'abp-sys') {
        const currentDia = targetObj.dia ?? 0;
        if (!(finalValueToSet === 0 && currentDia === 0)) {
            if (finalValueToSet <= currentDia) {
                // If user adjusts sys lower than dia via +/- buttons, compute a PP-aware diastolic
                const prevSys = targetObj.sys ?? currentDia + finalValueToSet;
                const prevDia = targetObj.dia ?? currentDia;
                const newDia = _computeAutoDiaForSys(finalValueToSet, prevSys, prevDia);
                targetObj.dia = newDia;
            } else {
                finalValueToSet = Math.max(finalValueToSet, currentDia + 1);
            }
        }
        try { monitorInstance._lastAbpUserEdit = { type: 'sys', ts: Date.now() }; } catch (e) { /* ignore */ }
    } else if (paramType === 'abp-dia') {
        const currentSys = targetObj.sys ?? 0;
        if (!(finalValueToSet === 0 && currentSys === 0)) {
            // If user attempts to raise dia above or equal to sys via +/- buttons,
            // auto-raise systolic using PP heuristics so the change stays physiologic.
            if (finalValueToSet >= currentSys) {
                const prevSys = targetObj.sys ?? currentSys;
                const prevDia = targetObj.dia ?? 0;
                const newSys = _computeAutoSysForDia(finalValueToSet, prevSys, prevDia);
                targetObj.sys = newSys;
            }
            // Recalculate cap against possibly-updated sys
            const cappedSys = targetObj.sys ?? currentSys;
            finalValueToSet = Math.min(finalValueToSet, cappedSys - 1);
            finalValueToSet = Math.max(0, finalValueToSet);
        } else {
            finalValueToSet = 0;
        }
        try { monitorInstance._lastAbpUserEdit = { type: 'dia', ts: Date.now() }; } catch (e) { /* ignore */ }
    }
    targetObj[targetSubKey]=finalValueToSet;
    monitorInstance.updateControlsToReflectParams();monitorInstance.updateSliderDisplays();monitorInstance.showPendingChanges();
}

function _handleUpdateVitalsClick(monitorInstance) {
    const updateDelaySelect = document.getElementById("update-delay-select");
    const delayMs = updateDelaySelect ? parseInt(updateDelaySelect.value, 10) : 0;

    // Clear any existing timeout to avoid double-firing
    if (monitorInstance.updateTimeoutId !== null) { 
        clearTimeout(monitorInstance.updateTimeoutId); 
        monitorInstance.updateTimeoutId = null; 
        console.log("[_handleUpdateVitalsClick] Previous update timeout cancelled."); 
    }

    // Immediately hide alert and disable button for visual feedback
    if (monitorInstance.pendingChangesAlert) monitorInstance.pendingChangesAlert.classList.add("d-none"); 
    if (monitorInstance.updateVitalsButton) monitorInstance.updateVitalsButton.disabled = true;

    const role = getCurrentRole(); 
    console.log(`[_handleUpdateVitalsClick] Role: ${role}, Delay: ${delayMs}ms`);

    // --- MODIFIED BLOCK START: HANDLE SETUP MODE (NOT RUNNING) ---
    if (!monitorInstance.animationRunning) {
        console.log("[_handleUpdateVitalsClick] Simulation inactive. Applying changes immediately (setup mode).");

        // 1. Force local update: Snap current params to target immediately
        monitorInstance.currentParams = JSON.parse(JSON.stringify(monitorInstance.targetParams));
        monitorInstance.interpolationTargetParams = JSON.parse(JSON.stringify(monitorInstance.targetParams));
        
        // 2. Clear all pending update flags (we are forcing the state)
        monitorInstance.isEtco2UpdatePending = false;
        monitorInstance.pendingEtco2Params = null;
        monitorInstance.isSpo2UpdatePending = false;
        monitorInstance.pendingSpo2Params = null;
        monitorInstance.isAbpUpdatePending = false;
        monitorInstance.pendingAbpParams = null;

        // 3. Update the Numeric Display immediately (since the animation loop isn't running to do it)
        if (typeof monitorInstance.updateVitalsDisplay === 'function') {
            monitorInstance.updateVitalsDisplay();
        }

        // Re-evaluate alarms immediately so updated thresholds take effect in standalone/setup mode
        try {
            if (typeof checkAlarms === 'function') {
                const currentActive = checkAlarms(monitorInstance.currentParams);
                const newlyActive = {};
                for (const k in currentActive) {
                    if (currentActive[k] && !monitorInstance.previousActiveAlarms?.[k]) newlyActive[k] = true;
                }
                // Only update visuals/play sounds on an active monitor device
                try {
                    const role = getCurrentRole();
                    if (role === 'monitor' && monitorInstance.animationRunning) {
                        updateAlarmVisuals();
                        try { triggerAlarmSounds(newlyActive); } catch (e) { /* ignore sound errors */ }
                    } else {
                        // Ensure sounds are not playing on non-monitor or inactive monitor
                        try { /* call stop via imported manager indirectly by updateAlarmVisuals in script when stopping */ } catch(e){}
                    }
                } catch (e) {
                    console.error('[_handleUpdateVitalsClick] Error while gating alarm visuals/sounds:', e);
                }
                monitorInstance.previousActiveAlarms = currentActive;
            }
        } catch (e) {
            console.error('[_handleUpdateVitalsClick] Error re-evaluating alarms after immediate apply:', e);
        }

        // 3b. Update Colors Immediately
        updateMonitorColors(monitorInstance.currentParams.colors, monitorInstance.charts);

        // 4. Send Network Update (Controller Only)
        // We ignore the delay here to ensure lobby/setup is synced instantly
        if (role === 'controller') {
            const paramsToSend = { ...monitorInstance.targetParams };
            delete paramsToSend.params; // Remove large internal object
            sendParamUpdate(paramsToSend);
            console.log("[_handleUpdateVitalsClick] Sent params update via network (simulation inactive).");
        }

        // 5. Re-check UI state (alert should stay hidden)
        if (typeof monitorInstance.showPendingChanges === 'function') {
            monitorInstance.showPendingChanges();
        }

        return; // Exit early, do not schedule the animation-based update
    }
    // --- MODIFIED BLOCK END ---

    // Standard logic for running simulation (Animation Loop Active)
    const applyFn = () => { 
        console.log(`[Timeout/Immediate] Applying parameter update (delay was ${delayMs}ms). Role: ${role}`); 
        monitorInstance.updateTimeoutId = null;
        
        if (role === 'controller') { 
            const paramsToSend = { ...monitorInstance.targetParams }; 
            delete paramsToSend.params; 
            sendParamUpdate(paramsToSend); 
            console.log("[applyFn] Sent params update via network."); 
        }
        
        if (typeof monitorInstance.initiateParameterChange === 'function') { 
            console.log("[applyFn] Initiating local parameter change application (Controller or Standalone)."); 
            monitorInstance.initiateParameterChange(); 
        } else { 
            console.error("[applyFn] initiateParameterChange function not found on monitorInstance!"); 
        }

            // After initiating parameter change, ensure alarm thresholds are evaluated.
            // Use a temp copy of currentParams but prefer immediate target HR (when
            // the current rhythm is not pulseless) so alarms evaluate against the
            // user-updated numeric value without breaking interpolation of the
            // waveform model.
            try {
                if (typeof checkAlarms === 'function' && monitorInstance.currentParams) {
                    let paramsForCheck;
                    try {
                        paramsForCheck = JSON.parse(JSON.stringify(monitorInstance.currentParams));
                        const curEcgRuntimeParams = paramsForCheck.ecg?.params;
                        const isPulseless = curEcgRuntimeParams && (curEcgRuntimeParams.isPEA || curEcgRuntimeParams.isChaotic || curEcgRuntimeParams.isFlat || (curEcgRuntimeParams.isArtifact && curEcgRuntimeParams.artifactType === 'cpr') || monitorInstance.currentParams.ecg?.rhythm === 'vt_pulseless');
                        if (monitorInstance.targetParams?.ecg && !isPulseless) {
                            paramsForCheck.ecg = paramsForCheck.ecg || {};
                            paramsForCheck.ecg.hr = monitorInstance.targetParams.ecg.hr;
                        }
                    } catch (innerErr) {
                        console.warn('[applyFn] Could not build temp params for alarm check, falling back to currentParams:', innerErr);
                        paramsForCheck = monitorInstance.currentParams;
                    }

                    const currentActive = checkAlarms(paramsForCheck);
                    // Debug logs to help diagnose why alarms may not trigger
                    try {
                        const hrForCheck = paramsForCheck.ecg?.hr;
                        const curEcgParams = paramsForCheck.ecg?.params;
                        const isPulselessForCheck = curEcgParams && (curEcgParams.isPEA || curEcgParams.isChaotic || curEcgParams.isFlat || (curEcgParams.isArtifact && curEcgParams.artifactType === 'cpr') || monitorInstance.currentParams.ecg?.rhythm === 'vt_pulseless');
                        console.log('[applyFn][AlarmCheck] hrForCheck=', hrForCheck, 'isPulseless=', isPulselessForCheck, 'ecgParams=', curEcgParams);
                        console.log('[applyFn][AlarmCheck] thresholds ecg=', paramsForCheck.alarms?.ecg, 'full alarms=', paramsForCheck.alarms);
                        console.log('[applyFn][AlarmCheck] checkAlarms result=', currentActive);
                    } catch (dbgErr) {
                        console.warn('[applyFn][AlarmCheck] debug logging failed', dbgErr);
                    }
                    const newlyActive = {};
                    for (const k in currentActive) {
                        if (currentActive[k] && !monitorInstance.previousActiveAlarms?.[k]) newlyActive[k] = true;
                    }
                    try {
                        const role = getCurrentRole();
                        if (monitorInstance.animationRunning) {
                            updateAlarmVisuals();
                            try { if (role === 'monitor') triggerAlarmSounds(newlyActive); } catch (e) { /* ignore sound errors */ }
                        }
                    } catch (e) {
                        console.error('[applyFn] Error while gating alarm visuals/sounds:', e);
                    }
                    monitorInstance.previousActiveAlarms = currentActive;
                }
            } catch (e) {
                console.error('[applyFn] Error evaluating alarms after parameter change:', e);
            }

            if (monitorInstance.updateVitalsButton) monitorInstance.updateVitalsButton.disabled = true;
    };

    if (delayMs === 0) { 
        applyFn(); 
    } else { 
        console.log(`[_handleUpdateVitalsClick] Scheduling parameter update transmission and local initiation after ${delayMs}ms.`); 
        monitorInstance.updateTimeoutId = setTimeout(applyFn, delayMs); 
        if (monitorInstance.updateVitalsButton) monitorInstance.updateVitalsButton.disabled = true; 
    }
}

function _handleColorChange(colorKey, event, monitorInstance) {
    if (monitorInstance.targetParams && monitorInstance.targetParams.colors) {
        const newColor = event.target.value;
        if (monitorInstance.targetParams.colors[colorKey] !== newColor) {
            monitorInstance.targetParams.colors[colorKey] = newColor;
            console.log(`[_handleColorChange] Target color updated: ${colorKey} = ${newColor}`);
            monitorInstance.showPendingChanges();
        }
    } else {
        console.warn(`[_handleColorChange] targetParams or targetParams.colors not found.`);
    }
}

function _applyPreset(presetKey, monitorInstance) { const presetData = PRESETS[presetKey]; if (!presetData) { console.error(`[Apply Preset] Preset not found: ${presetKey}`); return; } console.log(`[Apply Preset] Applying built-in preset: ${presetKey}`); _applyPresetParameters(presetData, monitorInstance); }
function _applyCustomPreset(presetParams, monitorInstance) { if (!presetParams) { console.error(`[Apply Custom Preset] Invalid preset parameters provided.`); return; } console.log(`[Apply Custom Preset] Applying custom preset parameters.`); _applyPresetParameters(presetParams, monitorInstance); }

function _getSelectedCaseId() {
    const sel = document.getElementById('case-select');
    if (sel && sel.value) return sel.value;
    return null;
}

function _saveCasesToStorage() {
    try {
        localStorage.setItem(CASES_STORAGE_KEY, JSON.stringify(loadedCases));
        console.log('[_saveCasesToStorage] Cases saved to localStorage.');
    } catch (error) {
        console.error('[_saveCasesToStorage] Error saving cases to localStorage:', error);
        alert('Warning: Could not save cases to browser storage. They will be lost on page reload.');
    }
}

function _updateCaseUIState(monitorInstance) {
    const hasCase = Array.isArray(loadedCases) && loadedCases.length > 0 && loadedCases.some(c => !!c.id && c.presets);
    const savePresetBtn = document.getElementById('save-custom-preset-button');
    const uploadPresetBtn = document.getElementById('upload-custom-preset-button');
    const presetFileInput = document.getElementById('preset-file-input');
    const saveCaseBtn = document.getElementById('save-case-button');
    const deleteCaseBtn = document.getElementById('delete-case-button');
    if (savePresetBtn) savePresetBtn.disabled = !hasCase;
    if (uploadPresetBtn) uploadPresetBtn.disabled = !hasCase;
    if (presetFileInput) presetFileInput.disabled = !hasCase;
    if (saveCaseBtn) saveCaseBtn.disabled = !hasCase;
    if (deleteCaseBtn) deleteCaseBtn.disabled = !hasCase;
}

function _renderPresetsForSelectedCase(monitorInstance) {
    const container = document.getElementById('custom-preset-buttons-container');
    const noLabel = document.getElementById('no-custom-presets-label');
    if (!container) return;
    container.innerHTML = '';
    const caseId = _getSelectedCaseId();
    const targetCase = loadedCases.find(c => c.id === caseId);
    if (!targetCase || !targetCase.presets || targetCase.presets.length === 0) {
        if (noLabel) noLabel.classList.remove('d-none');
        return;
    }
    if (noLabel) noLabel.classList.add('d-none');
    for (const p of targetCase.presets) {
        _addPresetButtonForCase(targetCase.id, p, monitorInstance);
    }
}

function _addPresetButtonForCase(caseId, presetObj, monitorInstance) {
    const container = document.getElementById('custom-preset-buttons-container');
    if (!container) { console.error("[_addPresetButtonForCase] Custom preset button container not found."); return; }
    const wrapper = document.createElement('div');
    wrapper.classList.add('preset-item', 'd-inline-flex', 'align-items-center', 'mb-2', 'me-2');

    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add('btn', 'btn-info', 'btn-sm');
    button.textContent = presetObj.name || 'Unnamed Preset';
    button.dataset.presetId = presetObj.id;
    button.dataset.caseId = caseId;
    button.style.marginRight = '6px';
    button.addEventListener('click', () => {
        console.log(`[Custom Preset Button] Clicked: ${presetObj.name} (ID: ${presetObj.id}) in case ${caseId}`);
        const targetCase = loadedCases.find(c => c.id === caseId);
        if (targetCase) {
            const presetToApply = targetCase.presets.find(p => p.id === presetObj.id);
            if (presetToApply) {
                _applyCustomPreset(presetToApply.params, monitorInstance);
                return;
            }
        }
        console.error(`[_addPresetButtonForCase] Could not find preset ${presetObj.id} in case ${caseId}`);
        alert('Error: Preset data not found.');
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.classList.add('btn', 'btn-outline-danger', 'btn-sm', 'preset-delete-btn');
    delBtn.title = 'Delete preset';
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _deletePresetFromCase(caseId, presetObj.id, monitorInstance);
    });

    wrapper.appendChild(button);
    wrapper.appendChild(delBtn);
    container.appendChild(wrapper);
    console.log(`[_addPresetButtonForCase] Added button for preset: ${presetObj.name} (ID: ${presetObj.id})`);
}

function _deletePresetFromCase(caseId, presetId, monitorInstance) {
    const targetCase = loadedCases.find(c => c.id === caseId);
    if (!targetCase) { alert('Case not found.'); return; }
    const idx = targetCase.presets.findIndex(p => p.id === presetId);
    if (idx === -1) { alert('Preset not found.'); return; }
    const presetName = targetCase.presets[idx].name || presetId;
    if (!confirm(`Delete preset '${presetName}' from case '${targetCase.name}'?`)) return;
    targetCase.presets.splice(idx, 1);
    _saveCasesToStorage();
    _renderPresetsForSelectedCase(monitorInstance);
    alert(`Preset '${presetName}' deleted.`);
}

function _applyPresetParameters(presetParamsToApply, monitorInstance) {
    const currentTargetColors = monitorInstance.targetParams?.colors
        ? JSON.parse(JSON.stringify(monitorInstance.targetParams.colors))
        : {};
    const preset = JSON.parse(JSON.stringify(presetParamsToApply));
    const presetParams = preset.params || preset;
    const newTargetParams = {};
    const allKeys = Object.keys(monitorInstance.targetParams);

    for (const paramKey of allKeys) {
        if (paramKey === 'params') continue;

        if (presetParams.hasOwnProperty(paramKey)) {
            if (paramKey === 'ecg') {
                const ecgPreset = presetParams.ecg;
                const newRhythmKey = ecgPreset.rhythm;
                const newParamsFromRhythms = RHYTHM_PARAMS[newRhythmKey];

                if (newParamsFromRhythms) {
                    newTargetParams.ecg = {
                        rhythm: newRhythmKey,
                        params: JSON.parse(JSON.stringify(newParamsFromRhythms)),
                        hr: 0,
                        visible: ecgPreset.hasOwnProperty('visible') ? ecgPreset.visible : (monitorInstance.targetParams.ecg?.visible ?? true)
                    };
                    let hrSourceValue = ecgPreset.hr !== undefined ? ecgPreset.hr : newParamsFromRhythms.baseHR;
                    const { initialHR } = monitorInstance._calculateInitialHR(newTargetParams.ecg.params, hrSourceValue);
                    newTargetParams.ecg.hr = initialHR;
                } else {
                    console.error(`[Apply Preset Params] ECG rhythm params not found for: ${newRhythmKey}. Keeping old ECG.`);
                    newTargetParams.ecg = JSON.parse(JSON.stringify(monitorInstance.targetParams.ecg));
                }
            } else if (paramKey === 'nibp') {
                newTargetParams.nibp = {
                    sys: null, dia: null, map: null, timestamp: null,
                    visible: presetParams.nibp?.hasOwnProperty('visible') ? presetParams.nibp.visible : (monitorInstance.targetParams.nibp?.visible ?? true)
                };
            } else if (paramKey === 'colors') {
                newTargetParams.colors = { ...currentTargetColors, ...(presetParams.colors || {}) };
            } else if (typeof presetParams[paramKey] === 'object' && presetParams[paramKey] !== null) {
                 const base = monitorInstance.targetParams[paramKey] || {};
                 newTargetParams[paramKey] = { ...base, ...presetParams[paramKey] };
                if (paramKey === 'abp') {
                    let sys = newTargetParams.abp.sys;
                    let dia = newTargetParams.abp.dia;
                    dia = Math.max(0, Math.min(dia ?? 0, (sys ?? 0) - 1));
                    sys = Math.max((dia ?? 0) + 1, sys ?? 0);
                    newTargetParams.abp.sys = sys;
                    newTargetParams.abp.dia = dia;
                }
            } else {
                newTargetParams[paramKey] = presetParams[paramKey];
            }
        } else {
            if (monitorInstance.targetParams.hasOwnProperty(paramKey)) {
                newTargetParams[paramKey] = JSON.parse(JSON.stringify(monitorInstance.targetParams[paramKey]));
            }
        }
    }
     if (!newTargetParams.colors) {
         newTargetParams.colors = JSON.parse(JSON.stringify(currentTargetColors));
     }

    if (newTargetParams.ecg?.rhythm === 'cpr_artifact') {
        const cprDefaults = RHYTHM_PARAMS['cpr_artifact'] || {};
        if (!presetParams.spo2 && newTargetParams.spo2) { newTargetParams.spo2.value = cprDefaults.spo2Value ?? 0; newTargetParams.spo2.shape = cprDefaults.spo2Shape ?? 'no_signal'; }
        if (!presetParams.abp && newTargetParams.abp) {
            newTargetParams.abp.sys = cprDefaults.cpr_abp_sys ?? 70;
            newTargetParams.abp.dia = cprDefaults.cpr_abp_dia ?? 25;
            let sys = newTargetParams.abp.sys; let dia = newTargetParams.abp.dia;
            dia = Math.max(0, Math.min(dia, sys - 1)); sys = Math.max(dia + 1, sys);
            newTargetParams.abp.sys = sys; newTargetParams.abp.dia = dia;
            newTargetParams.abp.shape = cprDefaults.cpr_abp_shape ?? 'damped';
        }
        if (!presetParams.etco2 && newTargetParams.etco2) { newTargetParams.etco2.valueKpa = cprDefaults.etco2ValueKpa ?? 2.0; newTargetParams.etco2.rr = cprDefaults.respiratoryRate ?? 10; newTargetParams.etco2.etco2Shape = cprDefaults.etco2Shape ?? 'cpr_low_flow'; }
    }
    monitorInstance.targetParams = newTargetParams;
    console.log("[Apply Preset] New targetParams after applying preset:", JSON.parse(JSON.stringify(monitorInstance.targetParams)));
    monitorInstance.updateControlsToReflectParams();
    monitorInstance.updateSliderDisplays();
    monitorInstance.showPendingChanges();
}


function _handleSavePreset(monitorInstance) {
    console.log("[_handleSavePreset] Initiating preset save...");
    if (!monitorInstance || !monitorInstance.targetParams) { console.error("[_handleSavePreset] Monitor instance or targetParams missing."); alert("Error: Could not read simulator state."); return; }
    const presetName = prompt("Enter preset name:", "My Custom Preset");
    if (!presetName) { console.log("[_handleSavePreset] Save cancelled by user."); return; }
    const paramsToSave = {}; const sourceParams = monitorInstance.targetParams;
    for (const key in sourceParams) {
        if (key === 'ecg') { paramsToSave.ecg = { rhythm: sourceParams.ecg.rhythm, hr: sourceParams.ecg.hr, visible: sourceParams.ecg.visible }; }
        else if (key === 'nibp') { paramsToSave.nibp = { visible: sourceParams.nibp.visible }; }
        else if (key !== 'params' && sourceParams[key] && typeof sourceParams[key] === 'object') { paramsToSave[key] = JSON.parse(JSON.stringify(sourceParams[key])); }
    }

    // Save into currently selected case and persist to cache
    let caseId = _getSelectedCaseId();
    if (!caseId) {
        alert('Please create or select a case before saving a preset. Use "New Case".');
        return;
    }
    let targetCase = loadedCases.find(c => c.id === caseId);
    if (!targetCase) {
        alert('Selected case not found. Please recreate or select a different case.');
        return;
    }
    const presetObj = { id: `preset-${nextCustomPresetId++}`, name: presetName, params: paramsToSave };
    targetCase.presets.push(presetObj);
    _addPresetButtonForCase(targetCase.id, presetObj, monitorInstance);
    _saveCasesToStorage();
    alert(`Preset '${presetName}' saved to case '${targetCase.name}' (cached).`);

    // Optionally allow user to download file as well
    if (confirm('Also download this preset as a .json file to your device?')) {
        const presetFileContent = { presetName: presetName, formatVersion: "1.1", params: paramsToSave };
        try {
            const jsonString = JSON.stringify(presetFileContent, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const safeFileName = presetName.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.json';
            link.download = safeFileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            console.log(`[_handleSavePreset] Preset '${presetName}' downloaded as '${safeFileName}'.`);
        } catch (error) {
            console.error("[_handleSavePreset] Error creating or saving file:", error);
            alert("Error saving preset to file.");
        }
    }
}
function _handleUploadClick() { const fileInput = document.getElementById('preset-file-input'); if (fileInput) { fileInput.click(); } else { console.error("[_handleUploadClick] File input element not found."); } }

function _handleLoadPresetFile(event, monitorInstance) {
    const files = event.target.files; if (!files || files.length === 0) { console.log("[_handleLoadPresetFile] No files selected."); return; }
    console.log(`[_handleLoadPresetFile] Loading ${files.length} file(s)...`); let loadedCount = 0; let errorCount = 0;
    const allLoadedPresetsFromFile = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i]; const reader = new FileReader();
        reader.onload = (e) => {
            let presetData;
            try {
                presetData = JSON.parse(e.target.result);
                console.log(`[_handleLoadPresetFile] File '${file.name}' parsed successfully.`);
                if (!presetData || typeof presetData !== 'object' || !presetData.presetName || typeof presetData.presetName !== 'string' || !presetData.params || typeof presetData.params !== 'object') {
                    throw new Error(`Invalid preset file structure (missing name or params) in '${file.name}'.`);
                }
                if (!presetData.params.ecg || !presetData.params.ecg.rhythm || !RHYTHM_PARAMS[presetData.params.ecg.rhythm]) {
                    throw new Error(`Invalid or unknown ECG rhythm key: '${presetData.params.ecg?.rhythm}' in '${file.name}'. Preset cannot be loaded.`);
                }
                if (presetData.params.colors) {
                    for (const key in presetData.params.colors) {
                        if (typeof presetData.params.colors[key] !== 'string' || !presetData.params.colors[key].match(/^#[0-9a-fA-F]{6}$/)) {
                            console.warn(`Invalid color format for key '${key}' in preset '${presetData.presetName}'. Using default.`);
                        }
                    }
                }
                console.log(`[_handleLoadPresetFile] Preset '${presetData.presetName}' from file '${file.name}' validated.`);
                const presetId = `custom-${nextCustomPresetId++}`;
                const newPreset = { id: presetId, name: presetData.presetName, params: presetData.params };
                allLoadedPresetsFromFile.push(newPreset);
                loadedCount++;
            }
            catch (error) {
                console.error(`[_handleLoadPresetFile] Error parsing or validating file '${file.name}':`, error);
                alert(`Error loading or validating preset file '${file.name}': ${error.message}`);
                errorCount++;
            }
            finally {
                if (loadedCount + errorCount === files.length) {
                    // Attach loaded presets to the currently selected case
                    let caseId = _getSelectedCaseId();
                    let targetCase = loadedCases.find(c => c.id === caseId);
                    if (!targetCase) {
                        alert('No case selected. Create or select a case before loading presets.');
                        if(event.target) event.target.value = null;
                        return;
                    }

                    allLoadedPresetsFromFile.forEach(preset => {
                        const presetObj = { id: `preset-${nextCustomPresetId++}`, name: preset.name, params: preset.params };
                        targetCase.presets.push(presetObj);
                        _addPresetButtonForCase(targetCase.id, presetObj, monitorInstance);
                    });

                    if (allLoadedPresetsFromFile.length > 0) {
                        _saveCasesToStorage();
                    }

                    if (loadedCount > 0) {
                        alert(`${loadedCount} preset(s) loaded successfully! ${errorCount > 0 ? errorCount + ' file(s) failed.' : ''}`);
                    } else if (errorCount > 0) {
                        alert(`Failed to load any presets. ${errorCount} file(s) had errors.`);
                    }
                    if(event.target) event.target.value = null;
                }
            }
        };
        reader.onerror = (e) => {
            console.error(`[_handleLoadPresetFile] Error reading file '${file.name}':`, e);
            alert(`Error reading file '${file.name}'.`); errorCount++;
            if (loadedCount + errorCount === files.length) {
                // attach any successfully parsed presets
                let caseId = _getSelectedCaseId();
                let targetCase = loadedCases.find(c => c.id === caseId);
                if (!targetCase) {
                    alert('No case selected. Create or select a case before loading presets.');
                    if(event.target) event.target.value = null;
                    return;
                }
                allLoadedPresetsFromFile.forEach(preset => {
                    const presetObj = { id: `preset-${nextCustomPresetId++}`, name: preset.name, params: preset.params };
                    targetCase.presets.push(presetObj);
                    _addPresetButtonForCase(targetCase.id, presetObj, monitorInstance);
                });
                if (allLoadedPresetsFromFile.length > 0) {
                    _saveCasesToStorage();
                }

                if (loadedCount > 0) { alert(`${loadedCount} preset(s) loaded successfully! ${errorCount > 0 ? errorCount + ' file(s) failed.' : ''}`); }
                else if (errorCount > 0) { alert(`Failed to load any presets. ${errorCount} file(s) had errors.`); }
                if(event.target) event.target.value = null;
            }
        };
        reader.readAsText(file);
    }
}

// Backwards-compat wrapper (kept for legacy callers)
function _saveCustomPresetsToStorage() {
    _saveCasesToStorage();
}

function _loadCasesFromStorage(monitorInstance) {
    try {
        const stored = localStorage.getItem(CASES_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                loadedCases = parsed;
                // compute nextCaseId
                let maxCase = -1;
                loadedCases.forEach(c => {
                    if (c.id && typeof c.id === 'string' && c.id.startsWith('case-')) {
                        const n = parseInt(c.id.replace('case-', ''), 10);
                        if (!isNaN(n) && n > maxCase) maxCase = n;
                    }
                });
                nextCaseId = maxCase + 1;
            }
        } else {
            // Try migrating old flat presets storage into a default case
            const old = localStorage.getItem(CUSTOM_PRESETS_STORAGE_KEY);
            if (old) {
                try {
                    const oldArr = JSON.parse(old);
                    if (Array.isArray(oldArr) && oldArr.length > 0) {
                        const defaultCase = { id: `case-${nextCaseId++}`, name: 'Default Case', presets: [] };
                        oldArr.forEach(p => {
                            defaultCase.presets.push({ id: `preset-${nextCustomPresetId++}`, name: p.name || p.presetName || 'Imported Preset', params: p.params || p });
                        });
                        loadedCases.push(defaultCase);
                        _saveCasesToStorage();
                        try { localStorage.removeItem(CUSTOM_PRESETS_STORAGE_KEY); } catch (e) { /* ignore */ }
                    }
                } catch (e) { console.warn('[_loadCasesFromStorage] Failed to migrate old presets:', e); }
            }
        }

        // Ensure at least one case exists
        // If no cases exist, prompt user to create one (do not auto-create)
        const sel = document.getElementById('case-select');
        if (sel) {
            sel.innerHTML = '';
            if (loadedCases.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = '-- Create a case first --';
                sel.appendChild(opt);
            } else {
                loadedCases.forEach(c => {
                    const opt = document.createElement('option'); opt.value = c.id; opt.textContent = c.name; sel.appendChild(opt);
                });
                sel.value = loadedCases[0].id;
            }
        }

        _renderPresetsForSelectedCase(monitorInstance);
        _updateCaseUIState(monitorInstance);
    } catch (error) {
        console.error('[_loadCasesFromStorage] Error loading cases from storage:', error);
    }
}

function _handleNewCase(monitorInstance) {
    const name = prompt('Enter case name:', 'New Case');
    if (!name) return;
    const id = `case-${nextCaseId++}`;
    const newCase = { id, name, presets: [] };
    loadedCases.push(newCase);
    const sel = document.getElementById('case-select');
    if (sel) {
        const opt = document.createElement('option'); opt.value = newCase.id; opt.textContent = newCase.name; sel.appendChild(opt); sel.value = newCase.id;
    }
    _saveCasesToStorage();
    _renderPresetsForSelectedCase(monitorInstance);
    // Ensure UI buttons (Add/Upload/Save preset, etc.) reflect the new case state
    _updateCaseUIState(monitorInstance);
}

function _handleDeleteCase(monitorInstance) {
    const sel = document.getElementById('case-select');
    if (!sel) return;
    const caseId = sel.value;
    const idx = loadedCases.findIndex(c => c.id === caseId);
    if (idx === -1) return;
    if (!confirm('Delete this case and all its presets?')) return;
    loadedCases.splice(idx, 1);
    if (loadedCases.length === 0) {
        loadedCases.push({ id: `case-${nextCaseId++}`, name: 'Default Case', presets: [] });
    }
    // rebuild select
    sel.innerHTML = '';
    loadedCases.forEach(c => { const opt = document.createElement('option'); opt.value = c.id; opt.textContent = c.name; sel.appendChild(opt); });
    sel.value = loadedCases[0].id;
    _saveCasesToStorage();
    _renderPresetsForSelectedCase(monitorInstance);
}


function _handleFullscreenToggle() { const targetElement = document.getElementById('monitor-wrapper-fullscreen-target'); if (!targetElement) { console.error("Fullscreen target element (#monitor-wrapper-fullscreen-target) not found."); return; } const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement; if (!isFullscreen) { console.log("Requesting fullscreen..."); const requestMethod = targetElement.requestFullscreen || targetElement.webkitRequestFullscreen || targetElement.mozRequestFullScreen || targetElement.msRequestFullscreen; if (requestMethod) { requestMethod.call(targetElement).catch(err => { console.error("Error attempting to enable full-screen mode:", err); document.body.classList.remove('fullscreen-active'); }); document.body.classList.add('fullscreen-active'); } else { console.error("Fullscreen API is not supported by this browser."); alert("Fullscreen mode is not supported by your browser."); } } else { console.log("Exiting fullscreen..."); const exitMethod = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen; if (exitMethod) { exitMethod.call(document).catch(err => console.error("Error attempting to disable full-screen mode:", err)); document.body.classList.remove('fullscreen-active'); } } }
function _updateFullscreenState() { const button = document.getElementById('fullscreen-button'); const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement); console.log("Fullscreen change event detected. Is fullscreen:", isFullscreen); document.body.classList.toggle('fullscreen-active', isFullscreen); if (button) { const icon = button.querySelector('i'); if (isFullscreen) { button.innerHTML = '<i class="fas fa-compress me-1"></i> Poistu'; } else { button.innerHTML = '<i class="fas fa-expand me-1"></i> Koko näyttö'; } } window.dispatchEvent(new Event('resize')); }

export function bindControlEvents(monitorInstance) {
    console.log("[bindControlEvents] Attaching event listeners...");
    monitorInstance.pendingChangesAlert = document.getElementById("pending-changes-alert");
    monitorInstance.updateVitalsButton = document.getElementById("update-vitals-button");
    if (!monitorInstance.pendingChangesAlert || !monitorInstance.updateVitalsButton) { console.error("CRITICAL: Pending changes alert or Update button not found!"); }
    _addListener("activate-button", "click", () => _handleActivateClick(monitorInstance));
    _addListener("update-vitals-button", "click", () => _handleUpdateVitalsClick(monitorInstance));
    _addListener("ecg-visibility-switch", "change", (e) => _handleVisibilityChange('ecg', e, monitorInstance));
    _addListener("spo2-visibility-switch", "change", (e) => _handleVisibilityChange('spo2', e, monitorInstance));
    _addListener("abp-visibility-switch", "change", (e) => _handleVisibilityChange('abp', e, monitorInstance));
    _addListener("etco2-visibility-switch", "change", (e) => _handleVisibilityChange('etco2', e, monitorInstance));
    _addListener("nibp-visibility-switch", "change", (e) => _handleVisibilityChange('nibp', e, monitorInstance));
    _addListener("temp-visibility-switch", "change", (e) => _handleVisibilityChange('temp', e, monitorInstance));
    _addListener("ecg-rhythm-select", "change", (e) => _handleEcgRhythmChange(e, monitorInstance));
    _addListener("hr-slider", "input", (e) => _handleHrSliderInput(e, monitorInstance));
    _addListener("ecg-shock-button", "click", () => _handleEcgShock(monitorInstance));
    _addListener("ecg-cpr-toggle", "click", () => _handleCprToggle(monitorInstance));
    _addListener("hr-minus-btn", "click", () => _handleAdjustButton('hr', 'minus', monitorInstance));
    _addListener("hr-plus-btn", "click", () => _handleAdjustButton('hr', 'plus', monitorInstance));
    _addListener("spo2-slider", "input", (e) => _handleSpo2SliderInput(e, monitorInstance));
    _addListener("spo2-shape-select", "change", (e) => _handleSpo2ShapeChange(e, monitorInstance));
    _addListener("spo2-minus-btn", "click", () => _handleAdjustButton('spo2', 'minus', monitorInstance));
    _addListener("spo2-plus-btn", "click", () => _handleAdjustButton('spo2', 'plus', monitorInstance));
    _addListener("abp-sys-slider", "input", (e) => _handleAbpSysInput(e, monitorInstance));
    _addListener("abp-dia-slider", "input", (e) => _handleAbpDiaInput(e, monitorInstance));
    _addListener("abp-shape-select", "change", (e) => _handleAbpShapeChange(e, monitorInstance));
    _addListener("abp-sys-minus-btn", "click", () => _handleAdjustButton('abp-sys', 'minus', monitorInstance));
    _addListener("abp-sys-plus-btn", "click", () => _handleAdjustButton('abp-sys', 'plus', monitorInstance));
    _addListener("abp-dia-minus-btn", "click", () => _handleAdjustButton('abp-dia', 'minus', monitorInstance));
    _addListener("abp-dia-plus-btn", "click", () => _handleAdjustButton('abp-dia', 'plus', monitorInstance));
    _addListener("etco2-slider", "input", (e) => _handleEtco2ValueInput(e, monitorInstance));
    _addListener("rr-slider", "input", (e) => _handleEtco2RRInput(e, monitorInstance));
    _addListener("etco2-unit-switch", "change", (e) => _handleEtco2UnitChange(e, monitorInstance));
    _addListener("etco2-shape-select", "change", (e) => _handleEtco2ShapeChange(e, monitorInstance));
    _addListener("etco2-minus-btn", "click", () => _handleAdjustButton('etco2', 'minus', monitorInstance));
    _addListener("etco2-plus-btn", "click", () => _handleAdjustButton('etco2', 'plus', monitorInstance));
    _addListener("rr-minus-btn", "click", () => _handleAdjustButton('rr', 'minus', monitorInstance));
    _addListener("rr-plus-btn", "click", () => _handleAdjustButton('rr', 'plus', monitorInstance));
    _addListener("start-nibp-button", "click", () => _handleNibpStart(monitorInstance));
    _addListener("temp-slider", "input", (e) => _handleTempSliderInput(e, monitorInstance));
    _addListener("temp-unit-switch", "change", (e) => _handleTempUnitChange(e, monitorInstance));
    _addListener("temp-minus-btn", "click", () => _handleAdjustButton('temp', 'minus', monitorInstance));
    _addListener("temp-plus-btn", "click", () => _handleAdjustButton('temp', 'plus', monitorInstance));
    _addListener("preset-healthy-button", "click", () => _applyPreset('healthy', monitorInstance));
    _addListener("preset-stemi-button", "click", () => _applyPreset('stemi', monitorInstance));
    _addListener("preset-hypovolemia-button", "click", () => _applyPreset('hypovolemic_shock', monitorInstance));
    _addListener("preset-svt-button", "click", () => _applyPreset('svt', monitorInstance));
    _addListener("preset-asystole-button", "click", () => _applyPreset('asystole', monitorInstance));
    _addListener("preset-vf-button", "click", () => _applyPreset('vf', monitorInstance));
    _addListener("preset-pea-button", "click", () => _applyPreset('pea', monitorInstance));
    _addListener("save-custom-preset-button", "click", () => _handleSavePreset(monitorInstance));
    _addListener("upload-custom-preset-button", "click", _handleUploadClick);
    _addListener("preset-file-input", "change", (e) => _handleLoadPresetFile(e, monitorInstance));
    _addListener('case-select', 'change', (e) => {
        _renderPresetsForSelectedCase(monitorInstance);
        _updateCaseUIState(monitorInstance);
    });
    _addListener('new-case-button', 'click', () => _handleNewCase(monitorInstance));
    _addListener('delete-case-button', 'click', () => _handleDeleteCase(monitorInstance));
    _addListener('save-case-button', 'click', () => _handleSaveCase(monitorInstance));
    _addListener('upload-case-button', 'click', _handleCaseUploadClick);
    _addListener('case-file-input', 'change', (e) => _handleLoadCaseFile(e, monitorInstance));
    _addListener("fullscreen-button", "click", _handleFullscreenToggle);
    document.addEventListener('fullscreenchange', _updateFullscreenState);
    document.addEventListener('webkitfullscreenchange', _updateFullscreenState);
    document.addEventListener('mozfullscreenchange', _updateFullscreenState);
    document.addEventListener('MSFullscreenChange', _updateFullscreenState);
    _addListener("ecg-color-picker", "input", (e) => _handleColorChange('ecgColor', e, monitorInstance));
    _addListener("spo2-color-picker", "input", (e) => _handleColorChange('spo2Color', e, monitorInstance));
    _addListener("abp-color-picker", "input", (e) => _handleColorChange('abpColor', e, monitorInstance));
    _addListener("etco2-color-picker", "input", (e) => _handleColorChange('etco2Color', e, monitorInstance));
    _addListener("nibp-color-picker", "input", (e) => _handleColorChange('nibpColor', e, monitorInstance));
    _addListener("temp-color-picker", "input", (e) => _handleColorChange('tempColor', e, monitorInstance));
    // --- Alarm Limit Bindings ---
    const alarmBindings = [
        { id: 'alarm-ecg-low', cat: 'ecg', key: 'low' },
        { id: 'alarm-ecg-high', cat: 'ecg', key: 'high' },
        { id: 'alarm-spo2-low', cat: 'spo2', key: 'low' },
        { id: 'alarm-abp-low', cat: 'abp', key: 'low_map' },
        { id: 'alarm-abp-sys-low', cat: 'abp', key: 'low_sys' },
        { id: 'alarm-abp-sys-high', cat: 'abp', key: 'high_sys' },
        { id: 'alarm-abp-dia-low', cat: 'abp', key: 'low_dia' },
        { id: 'alarm-abp-dia-high', cat: 'abp', key: 'high_dia' },
        { id: 'alarm-etco2-low', cat: 'etco2', key: 'low' },
        { id: 'alarm-etco2-high', cat: 'etco2', key: 'high' }
    ];

    alarmBindings.forEach(binding => {
        const inputEl = document.getElementById(binding.id);
        const sliderEl = document.getElementById(binding.id + '-slider');

        // Helper to update global state and mark pending changes (do NOT apply immediately)
        const updateState = (val) => {
            if (isNaN(val) || !monitorInstance.targetParams || !monitorInstance.targetParams.alarms) return;
            // Update target params (pending change)
            monitorInstance.targetParams.alarms[binding.cat][binding.key] = val;

            // Do NOT copy into currentParams here; controller changes must be applied
            // by pressing the "Update Vitals" button to preserve core program logic.

            // Only mark pending changes and update UI state.
            monitorInstance.showPendingChanges();
        };

        // If user types in the box: update slider and state
        if (inputEl) {
            inputEl.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (sliderEl) sliderEl.value = val; // Sync slider to box
                updateState(val);
            });
        }

        // If user moves the slider: update box and state
        if (sliderEl) {
            sliderEl.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (inputEl) inputEl.value = val; // Sync box to slider
                updateState(val);
            });
        }
    });

    _loadCasesFromStorage(monitorInstance);

    console.log("[bindControlEvents] All event listeners attached.");
    monitorInstance.showPendingChanges();
}

function _handleCaseUploadClick() { const fileInput = document.getElementById('case-file-input'); if (fileInput) { fileInput.click(); } else { console.error('[_handleCaseUploadClick] case-file-input not found'); } }

function _handleSaveCase(monitorInstance) {
    const sel = document.getElementById('case-select');
    if (!sel) { alert('No case selector found.'); return; }
    const caseId = sel.value;
    const targetCase = loadedCases.find(c => c.id === caseId);
    if (!targetCase) { alert('Selected case not found.'); return; }
    try {
        const out = JSON.parse(JSON.stringify(targetCase));
        // remove runtime-only IDs to make file portable
        out.id = undefined;
        const json = JSON.stringify({ caseName: targetCase.name, formatVersion: '1.0', case: targetCase }, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; const safeFileName = (targetCase.name || 'case').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.json'; link.download = safeFileName; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
        console.log(`[_handleSaveCase] Case '${targetCase.name}' exported.`);
        alert(`Case '${targetCase.name}' saved to file.`);
    } catch (e) { console.error('[_handleSaveCase] Error exporting case:', e); alert('Error exporting case.'); }
}

function _handleLoadCaseFile(event, monitorInstance) {
    const files = event.target.files; if (!files || files.length === 0) { console.log('[_handleLoadCaseFile] No files selected.'); return; }
    const file = files[0]; const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            const payload = parsed.case || parsed;
            const name = parsed.caseName || payload.name || payload.caseName || ('Imported Case ' + Date.now());
            if (!payload || !Array.isArray(payload.presets)) {
                throw new Error('Invalid case file format (missing presets array).');
            }
            // Validate presets minimally
            for (const p of payload.presets) {
                if (!p.name || !p.params || !p.params.ecg || !p.params.ecg.rhythm || !RHYTHM_PARAMS[p.params.ecg.rhythm]) {
                    throw new Error('Invalid preset structure or unknown ECG rhythm in one of the presets.');
                }
            }

            // If case with same name exists, ask to overwrite or keep both
            const existing = loadedCases.find(c => c.name === name);
            if (existing) {
                if (!confirm(`Case named '${name}' already exists. Overwrite existing case? (Cancel to import as new)`)) {
                    // Import as new, give a new unique name
                    let i = 1; let newName = name + ' (' + i + ')';
                    while (loadedCases.find(c => c.name === newName)) { i++; newName = name + ' (' + i + ')'; }
                    const newCase = { id: `case-${nextCaseId++}`, name: newName, presets: [] };
                    payload.presets.forEach(p => newCase.presets.push({ id: `preset-${nextCustomPresetId++}`, name: p.name, params: p.params }));
                    loadedCases.push(newCase);
                    const sel = document.getElementById('case-select'); if (sel) { const opt = document.createElement('option'); opt.value = newCase.id; opt.textContent = newCase.name; sel.appendChild(opt); sel.value = newCase.id; }
                    _saveCasesToStorage(); _renderPresetsForSelectedCase(monitorInstance);
                    alert('Case imported as: ' + newName);
                } else {
                    // Overwrite
                    existing.presets = [];
                    payload.presets.forEach(p => existing.presets.push({ id: `preset-${nextCustomPresetId++}`, name: p.name, params: p.params }));
                    _saveCasesToStorage();
                    const sel = document.getElementById('case-select'); if (sel) sel.value = existing.id;
                    _renderPresetsForSelectedCase(monitorInstance);
                    alert('Case overwritten: ' + existing.name);
                }
            } else {
                const newCase = { id: `case-${nextCaseId++}`, name: name, presets: [] };
                payload.presets.forEach(p => newCase.presets.push({ id: `preset-${nextCustomPresetId++}`, name: p.name, params: p.params }));
                loadedCases.push(newCase);
                const sel = document.getElementById('case-select'); if (sel) { const opt = document.createElement('option'); opt.value = newCase.id; opt.textContent = newCase.name; sel.appendChild(opt); sel.value = newCase.id; }
                _saveCasesToStorage(); _renderPresetsForSelectedCase(monitorInstance);
                alert('Case imported: ' + newCase.name);
            }
        } catch (err) {
            console.error('[_handleLoadCaseFile] Error parsing or validating case file:', err);
            alert('Error loading case file: ' + err.message);
        } finally {
            if (event.target) event.target.value = null;
        }
    };
    reader.onerror = (e) => { console.error('[_handleLoadCaseFile] File read error', e); alert('Error reading file.'); if (event.target) event.target.value = null; };
    reader.readAsText(file);
}

export function updateControlsToReflectParams(monitorInstance) {
    try { const paramsToReflect = JSON.parse(JSON.stringify(monitorInstance.targetParams)); _updateVisibilitySwitches(paramsToReflect); _updateEcgControlsUI(paramsToReflect, monitorInstance._calculateInitialHR); _updateSpo2ControlsUI(paramsToReflect); _updateAbpControlsUI(paramsToReflect); _updateEtco2ControlsUI(paramsToReflect); _updateTempControlsUI(paramsToReflect); _updateColorControlsUI(paramsToReflect); }
    catch(error) { console.error("[updateControlsToReflectParams] Error updating controls UI:", error); }
}
function _updateVisibilitySwitches(params) { const ecgVisSwitch = document.getElementById("ecg-visibility-switch"); const spo2VisSwitch = document.getElementById("spo2-visibility-switch"); const abpVisSwitch = document.getElementById("abp-visibility-switch"); const etco2VisSwitch = document.getElementById("etco2-visibility-switch"); const nibpVisSwitch = document.getElementById("nibp-visibility-switch"); const tempVisSwitch = document.getElementById("temp-visibility-switch"); if(ecgVisSwitch&&params.ecg) ecgVisSwitch.checked=params.ecg.visible; if(spo2VisSwitch&&params.spo2) spo2VisSwitch.checked=params.spo2.visible; if(abpVisSwitch&&params.abp) abpVisSwitch.checked=params.abp.visible; if(etco2VisSwitch&&params.etco2) etco2VisSwitch.checked=params.etco2.visible; if(nibpVisSwitch&&params.nibp) nibpVisSwitch.checked=params.nibp.visible; if(tempVisSwitch&&params.temp) tempVisSwitch.checked=params.temp.visible; }
function _updateEcgControlsUI(params, calculateInitialHRFunc) { const rhythmSelect=document.getElementById("ecg-rhythm-select"); const hrSlider=document.getElementById("hr-slider"); const hrSliderDisplay=document.getElementById("hr-slider-display"); if(rhythmSelect&&params.ecg){ rhythmSelect.value=params.ecg.rhythm; try { rhythmSelect.disabled = (params.ecg.rhythm === 'cpr_artifact'); } catch(e){} } if(params.ecg&&calculateInitialHRFunc&&params.ecg.params&&hrSlider&&hrSliderDisplay){ const ecgParams=params.ecg.params; const targetHRValue=params.ecg.hr; const isCprOrPulseless=params.ecg.rhythm==='cpr_artifact'||ecgParams.isPEA||ecgParams.isChaotic||ecgParams.isFlat||params.ecg.rhythm==='vt_pulseless'; const {canChangeHR}=calculateInitialHRFunc(ecgParams,targetHRValue); const enableSlider=!isCprOrPulseless&&canChangeHR; hrSlider.value=ensureFinite(targetHRValue,0); hrSlider.disabled=!enableSlider; hrSliderDisplay.textContent=ensureFinite(targetHRValue,0); }else if(hrSliderDisplay){ hrSliderDisplay.textContent='N/A'; if(hrSlider)hrSlider.disabled=true; } }
function _updateSpo2ControlsUI(params) {
    const spo2Slider=document.getElementById("spo2-slider");
    const spo2ShapeSelect=document.getElementById("spo2-shape-select");
    const spo2MinusBtn = document.getElementById("spo2-minus-btn");
    const spo2PlusBtn = document.getElementById("spo2-plus-btn");

    if(params.spo2){
        if(spo2Slider) spo2Slider.value=ensureFinite(params.spo2.value,0);
        if(spo2ShapeSelect) spo2ShapeSelect.value=params.spo2.shape;
        if(spo2Slider) spo2Slider.disabled = false;
        if(spo2ShapeSelect) spo2ShapeSelect.disabled = false;
        if(spo2MinusBtn) spo2MinusBtn.disabled = false;
        if(spo2PlusBtn) spo2PlusBtn.disabled = false;
    } else {
        if(spo2Slider) spo2Slider.disabled = true;
        if(spo2ShapeSelect) spo2ShapeSelect.disabled = true;
        if(spo2MinusBtn) spo2MinusBtn.disabled = true;
        if(spo2PlusBtn) spo2PlusBtn.disabled = true;
    }
}
function _updateAbpControlsUI(params) {
    const abpSysSlider=document.getElementById("abp-sys-slider");
    const abpDiaSlider=document.getElementById("abp-dia-slider");
    const abpShapeSelect=document.getElementById("abp-shape-select");
    const mapDisplay=document.getElementById("map-display");
    const abpSysMinusBtn = document.getElementById("abp-sys-minus-btn");
    const abpSysPlusBtn = document.getElementById("abp-sys-plus-btn");
    const abpDiaMinusBtn = document.getElementById("abp-dia-minus-btn");
    const abpDiaPlusBtn = document.getElementById("abp-dia-plus-btn");

    if(params.abp){
        const sys=ensureFinite(params.abp.sys,0);
        const dia=ensureFinite(params.abp.dia,0);
        if(abpSysSlider)abpSysSlider.value=sys;
        if(abpDiaSlider)abpDiaSlider.value=dia;
        if(abpShapeSelect)abpShapeSelect.value=params.abp.shape;
        if(mapDisplay){ const map=(sys>dia&&sys>0)?Math.round(dia+(sys-dia)/3):"--"; mapDisplay.textContent=`${map} mmHg`; }
        if(abpSysSlider) abpSysSlider.disabled = false;
        if(abpDiaSlider) abpDiaSlider.disabled = false;
        if(abpShapeSelect) abpShapeSelect.disabled = false;
        if(abpSysMinusBtn) abpSysMinusBtn.disabled = false;
        if(abpSysPlusBtn) abpSysPlusBtn.disabled = false;
        if(abpDiaMinusBtn) abpDiaMinusBtn.disabled = false;
        if(abpDiaPlusBtn) abpDiaPlusBtn.disabled = false;
    } else {
        if(abpSysSlider) abpSysSlider.disabled = true;
        if(abpDiaSlider) abpDiaSlider.disabled = true;
        if(abpShapeSelect) abpShapeSelect.disabled = true;
        if(abpSysMinusBtn) abpSysMinusBtn.disabled = true;
        if(abpSysPlusBtn) abpSysPlusBtn.disabled = true;
        if(abpDiaMinusBtn) abpDiaMinusBtn.disabled = true;
        if(abpDiaPlusBtn) abpDiaPlusBtn.disabled = true;
    }
}
function _updateEtco2ControlsUI(params) {
    const etco2Slider=document.getElementById("etco2-slider");
    const rrSlider=document.getElementById("rr-slider");
    const etco2UnitSwitch=document.getElementById("etco2-unit-switch");
    const etco2ShapeSelect=document.getElementById("etco2-shape-select");
    const etco2SliderUnit=document.getElementById("etco2-slider-unit");
    const etco2MinusBtn = document.getElementById("etco2-minus-btn");
    const etco2PlusBtn = document.getElementById("etco2-plus-btn");
    const rrMinusBtn = document.getElementById("rr-minus-btn");
    const rrPlusBtn = document.getElementById("rr-plus-btn");
    const etco2Params=params.etco2;

    if(etco2Params&&etco2Slider&&rrSlider&&etco2UnitSwitch&&etco2ShapeSelect&&etco2SliderUnit){
        const isMmHg=(etco2Params.unitPref==='mmHg');
        etco2UnitSwitch.checked=isMmHg;
        const valueKpa=ensureFinite(etco2Params.valueKpa,0);
        if(isMmHg){ etco2Slider.min="0"; etco2Slider.max="80"; etco2Slider.step="1"; etco2Slider.value=Math.round(valueKpa*KPA_TO_MMHG); etco2SliderUnit.textContent='mmHg';
        }else{ etco2Slider.min="0"; etco2Slider.max="10.7"; etco2Slider.step="0.1"; etco2Slider.value=valueKpa.toFixed(1); etco2SliderUnit.textContent='kPa'; }
        rrSlider.value=ensureFinite(etco2Params.rr,0);
        etco2ShapeSelect.value=etco2Params.etco2Shape;

        etco2Slider.disabled = false;
        rrSlider.disabled = false;
        etco2UnitSwitch.disabled = false;
        etco2ShapeSelect.disabled = false;
        if(etco2MinusBtn) etco2MinusBtn.disabled = false;
        if(etco2PlusBtn) etco2PlusBtn.disabled = false;
        if(rrMinusBtn) rrMinusBtn.disabled = false;
        if(rrPlusBtn) rrPlusBtn.disabled = false;
    } else {
        if(etco2Slider) etco2Slider.disabled = true;
        if(rrSlider) rrSlider.disabled = true;
        if(etco2UnitSwitch) etco2UnitSwitch.disabled = true;
        if(etco2ShapeSelect) etco2ShapeSelect.disabled = true;
        if(etco2MinusBtn) etco2MinusBtn.disabled = true;
        if(etco2PlusBtn) etco2PlusBtn.disabled = true;
        if(rrMinusBtn) rrMinusBtn.disabled = true;
        if(rrPlusBtn) rrPlusBtn.disabled = true;
    }
}
function _updateTempControlsUI(params) {
    const tempSlider=document.getElementById("temp-slider");
    const tempUnitSwitch=document.getElementById("temp-unit-switch");
    const tempSliderUnit=document.getElementById("temp-slider-unit");
    const tempMinusBtn = document.getElementById("temp-minus-btn");
    const tempPlusBtn = document.getElementById("temp-plus-btn");
    const tempParams=params.temp;

    if(tempParams&&tempSlider&&tempUnitSwitch&&tempSliderUnit){
        const isFahrenheit=(tempParams.unitPref==='F');
        tempUnitSwitch.checked=isFahrenheit;
        const targetTempC=ensureFinite(tempParams.valueC,DEFAULT_TEMP_C);
        if(isFahrenheit){ tempSlider.min="93.2"; tempSlider.max="107.6"; tempSlider.step="0.1"; tempSlider.value=celsiusToFahrenheit(targetTempC).toFixed(1); tempSliderUnit.textContent='°F';
        }else{ tempSlider.min="34.0"; tempSlider.max="42.0"; tempSlider.step="0.1"; tempSlider.value=targetTempC.toFixed(1); tempSliderUnit.textContent='°C'; }
        tempSlider.disabled = false;
        tempUnitSwitch.disabled = false;
        if(tempMinusBtn) tempMinusBtn.disabled = false;
        if(tempPlusBtn) tempPlusBtn.disabled = false;
    } else {
        if(tempSlider) tempSlider.disabled = true;
        if(tempUnitSwitch) tempUnitSwitch.disabled = true;
        if(tempMinusBtn) tempMinusBtn.disabled = true;
        if(tempPlusBtn) tempPlusBtn.disabled = true;
    }
}
function _updateColorControlsUI(params) {
    const colors = params.colors; if (!colors) return;
    const ecgPicker = document.getElementById("ecg-color-picker"); const spo2Picker = document.getElementById("spo2-color-picker"); const abpPicker = document.getElementById("abp-color-picker"); const etco2Picker = document.getElementById("etco2-color-picker"); const nibpPicker = document.getElementById("nibp-color-picker"); const tempPicker = document.getElementById("temp-color-picker");
    if (ecgPicker && colors.ecgColor) ecgPicker.value = colors.ecgColor; if (spo2Picker && colors.spo2Color) spo2Picker.value = colors.spo2Color; if (abpPicker && colors.abpColor) abpPicker.value = colors.abpColor; if (etco2Picker && colors.etco2Color) etco2Picker.value = colors.etco2Color; if (nibpPicker && colors.nibpColor) nibpPicker.value = colors.nibpColor; if (tempPicker && colors.tempColor) tempPicker.value = colors.tempColor;

// Update Alarm Inputs & Sliders from current state
    if (params.alarms) {
        const syncAlarmControls = (baseId, val) => {
            const inputEl = document.getElementById(baseId);
            const sliderEl = document.getElementById(baseId + '-slider');
            // Set values if elements exist
            if (inputEl) inputEl.value = val;
            if (sliderEl) sliderEl.value = val;
        };

        syncAlarmControls('alarm-ecg-low', params.alarms.ecg.low);
        syncAlarmControls('alarm-ecg-high', params.alarms.ecg.high);
        syncAlarmControls('alarm-spo2-low', params.alarms.spo2.low);
        syncAlarmControls('alarm-abp-low', params.alarms.abp.low_map);
        syncAlarmControls('alarm-abp-sys-low', params.alarms.abp.low_sys);
        syncAlarmControls('alarm-abp-sys-high', params.alarms.abp.high_sys);
        syncAlarmControls('alarm-abp-dia-low', params.alarms.abp.low_dia);
        syncAlarmControls('alarm-abp-dia-high', params.alarms.abp.high_dia);
        syncAlarmControls('alarm-etco2-low', params.alarms.etco2.low);
        syncAlarmControls('alarm-etco2-high', params.alarms.etco2.high);
    }
}

export function showPendingChanges(monitorInstance) {
    const alertElement = monitorInstance.pendingChangesAlert;
    const updateButton = monitorInstance.updateVitalsButton;
    if (!alertElement || !updateButton) return;

    const role = getCurrentRole();
    if (role === 'monitor') {
        alertElement.classList.add("d-none");
        updateButton.disabled = true;
        return;
    }
    
    let hasPendingChanges = false;
    const target = monitorInstance.targetParams;
    const compareTo = monitorInstance.interpolationTargetParams;

    if (monitorInstance.isEtco2UpdatePending || monitorInstance.isSpo2UpdatePending || monitorInstance.isAbpUpdatePending) { // Check reinstated pending flags
        hasPendingChanges = true;
    } else if (!compareTo) {
        hasPendingChanges = true;
        console.log("[showPendingChanges] No interpolationTargetParams, assuming pending changes if targetParams exist.");
    } else {
        try {
            const keysToCompare = ['ecg', 'spo2', 'abp', 'etco2', 'temp', 'nibp', 'colors', 'alarms'];
            for (const key of keysToCompare) {
                if (!target[key] || !compareTo[key]) {
                    if (target[key] !== compareTo[key]) {
                        hasPendingChanges = true; break;
                    }
                    continue;
                }
                if (key === 'nibp') {
                     if (target.nibp.visible !== compareTo.nibp.visible) {
                        hasPendingChanges = true; break;
                    }
                    continue;
                }
                const targetString = JSON.stringify(target[key]);
                const compareToString = JSON.stringify(compareTo[key]);
                if (targetString !== compareToString) {
                    hasPendingChanges = true;
                    break;
                }
            }
        } catch (error) {
            console.error("[showPendingChanges] Error comparing params:", error);
            hasPendingChanges = true;
        }
    }

    alertElement.classList.toggle("d-none", !hasPendingChanges);
    updateButton.disabled = !hasPendingChanges || monitorInstance.updateTimeoutId !== null;
}

// NEW: Exported function to trigger fullscreen programmatically
export function triggerFullscreen() {
    const elem = document.getElementById("monitor-wrapper-fullscreen-target");
    if (!elem) return;

    if (!document.fullscreenElement) {
        elem.requestFullscreen().catch((err) => {
            console.error(`Error attempting to enable fullscreen: ${err.message} (${err.name})`);
        });
        document.body.classList.add("fullscreen-active");
    }
}