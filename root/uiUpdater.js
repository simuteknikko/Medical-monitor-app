// uiUpdater.js - UI Update Helper Functions
// VERSION: Throttled numeric display updates. Added color update function with chart refresh.

import {
    KPA_TO_MMHG,
    DEFAULT_TEMP_C,
    celsiusToFahrenheit,
    DEFAULT_ETCO2_KPA,
    NUMERIC_DISPLAY_UPDATE_INTERVAL_MS
} from "./config.js";
import { ensureFinite } from "./waveformUtils.js";

// --- Tilamuuttujat päivityksen rajoittamiseen ---
let lastNumericUpdateTimes = {
    hr: 0, spo2: 0, pr: 0, abp: 0, map: 0, etco2: 0, rr: 0, nibp: 0, temp: 0
};

// --- Apufunktiot ---
function getPulseStatus(currentParams) {
    if (!currentParams || !currentParams.ecg || !currentParams.ecg.params) { return false; }
    const ecgParams = currentParams.ecg.params;
    const ecgGeneratorType = ecgParams.generatorType;
    const isPEA = ecgParams.isPEA ?? false;
    const isChaotic = ecgParams.isChaotic ?? false;
    const isFlat = ecgParams.isFlat ?? false;
    const isArtifact = ecgParams.isArtifact ?? false;
    const isCprArtifact = isArtifact && ecgParams.artifactType === 'cpr';
    const ecgGeneratesPulse = (
        ((ecgGeneratorType === 'pqrst' || ecgGeneratorType === 'avBlock' || ecgGeneratorType === 'paced') && !isPEA) ||
        (!ecgGeneratorType && !(isFlat || isChaotic || isPEA || isArtifact))
    );
    const hasPulse = ecgGeneratesPulse || isCprArtifact;
    return hasPulse;
}

function _shouldUpdateNumeric(key, currentTime) {
    if (currentTime - lastNumericUpdateTimes[key] >= NUMERIC_DISPLAY_UPDATE_INTERVAL_MS) {
        lastNumericUpdateTimes[key] = currentTime;
        return true;
    }
    return false;
}

// --- DOM-päivitysfunktiot ---
export function updateMonitorVisibility(monitorElements, currentParams) {
  for (const key in monitorElements) {
    const wrapperElement = monitorElements[key];
    const params = currentParams[key];
    if (wrapperElement && params && typeof params.visible !== 'undefined') {
      wrapperElement.classList.toggle('d-none', !params.visible);
       const chartElement = wrapperElement.querySelector('.ct-chart');
        if (chartElement) {
           chartElement.style.visibility = params.visible ? 'visible' : 'hidden';
           chartElement.style.opacity = params.visible ? '1' : '0';
        }
    } else if (!wrapperElement) {
      console.warn(`[updateMonitorVisibility] Wrapper element missing for key: ${key}`);
    }
  }
    // If ABP visibility changed, reflect that state on the body so fullscreen
    // styles can respond (e.g. make NIBP much larger when ABP is off).
    try {
        const abpVisible = !!(currentParams && currentParams.abp && currentParams.abp.visible);
        document.body.classList.toggle('abp-hidden', !abpVisible);

        // Compute how many primary vitals are visible so we can scale numbers
        // dynamically when there is extra room (e.g., other vitals toggled off).
        const vitalKeys = ['ecg','spo2','abp','etco2','nibp','temp'];
        let visibleCount = 0;
        for (const k of vitalKeys) {
            if (currentParams && currentParams[k] && currentParams[k].visible) visibleCount += 1;
        }

        // Map visibleCount -> base scale multiplier. Fewer visible vitals -> larger numbers.
        let baseScale = 1.0;
        if (visibleCount <= 1) baseScale = 2.4; // almost only one vital visible -> extra large
        else if (visibleCount === 2) baseScale = 2.1;
        else if (visibleCount === 3) baseScale = 1.6;
        else baseScale = 1.0; // 4+ vitals visible -> default scaling

        // Adjust scale based on viewport width to avoid breaking small tablets.
        const vw = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1200;
        let maxScale = 2.4;
        if (vw < 800) maxScale = 1.15; // small devices (likely phones / small tablets)
        else if (vw < 1000) maxScale = 1.5; // 10" tablets and similar
        else if (vw < 1400) maxScale = 2.0;

        let scale = Math.min(baseScale, maxScale);
        // Ensure scale stays within reasonable bounds
        scale = Math.max(0.9, Math.min(2.8, scale));
        document.body.style.setProperty('--vitals-scale', String(scale));
    } catch (e) {
        /* noop */
    }
}

export function updateVitalsDisplay(currentParams) {
    const ecgSrc = currentParams.ecg;
    const spo2Src = currentParams.spo2;
    const abpSrc = currentParams.abp;
    const etco2Src = currentParams.etco2;
    const tempSrc = currentParams.temp;
    const nibpSrc = currentParams.nibp;
    const currentTime = performance.now();

    _updateEcgDisplay(ecgSrc, currentTime);
    _updateSpo2Display(spo2Src, ecgSrc, currentTime);
    _updateAbpDisplay(abpSrc, ecgSrc, currentTime);
    _updateEtco2Display(etco2Src, currentTime);
    _updateNibpDisplay(nibpSrc, currentTime);
    _updateTempDisplay(tempSrc, currentTime);
}

function _updateEcgDisplay(ecgSrc, currentTime) {
  if (!ecgSrc?.visible) return;
  const hrEl = document.getElementById("hr-value");
  const rhyEl = document.getElementById("ecg-rhythm-display");
  if (hrEl && _shouldUpdateNumeric('hr', currentTime)) {
      if (!ecgSrc.params) { hrEl.textContent = '--'; }
      else { const displayHRValue = Math.round(ensureFinite(ecgSrc.hr, 0)); if (hrEl.textContent !== String(displayHRValue)) { hrEl.textContent = displayHRValue; } }
  }
  if (rhyEl) {
      if (!ecgSrc.params) { rhyEl.textContent = 'N/A'; }
      else { const opt = document.querySelector(`#ecg-rhythm-select option[value="${ecgSrc.rhythm}"]`); const newRhythmText = opt ? opt.textContent : ecgSrc.rhythm; if (rhyEl.textContent !== newRhythmText) { rhyEl.textContent = newRhythmText; } }
  }
}

function _updateSpo2Display(spo2Src, ecgSrc, currentTime) {
    if (!spo2Src?.visible) return;
    const spO2El = document.getElementById("spo2-value");
    const prEl = document.getElementById("spo2-pr-label");
    if (spO2El && _shouldUpdateNumeric('spo2', currentTime)) { const displaySpo2Value = Math.round(ensureFinite(spo2Src.value, 0)); if (spO2El.textContent !== String(displaySpo2Value)) { spO2El.textContent = displaySpo2Value; } }
    if (prEl && _shouldUpdateNumeric('pr', currentTime)) {
        let dPR = '--'; const ecgParams = ecgSrc?.params;
        if (ecgParams) { const isCprArtifact = ecgParams.isArtifact && ecgParams.artifactType === 'cpr'; const ecgGeneratesPulseForPR = getPulseStatus({ ecg: ecgSrc });
            if (isCprArtifact) { dPR = Math.round(ensureFinite(ecgParams.artifact_freq, 0)); }
            else if (ecgGeneratesPulseForPR) { const ecgGeneratorType = ecgParams.generatorType; const hrValue = (ecgGeneratorType === 'avBlock') ? ensureFinite(ecgParams.baseHR, 0) : (ecgGeneratorType === 'paced') ? ensureFinite(ecgParams.pacingRate, 0) : ensureFinite(ecgSrc.hr, 0); dPR = Math.round(hrValue); }
        } const newPrText = `PR: ${dPR}`; if (prEl.textContent !== newPrText) { prEl.textContent = newPrText; }
    }
}

function _updateAbpDisplay(abpSrc, ecgSrc, currentTime) {
    if (!abpSrc?.visible) return;
    if (_shouldUpdateNumeric('abp', currentTime)) {
        const sysEl = document.getElementById("abp-sys-value"); const diaEl = document.getElementById("abp-dia-value"); const meanEl = document.getElementById("abp-mean-value");
        let sys = '--', dia = '--', map = '--'; const ecgParams = ecgSrc?.params;
        if (ecgParams) { const isCprArtifact = ecgParams.isArtifact && ecgParams.artifactType === 'cpr'; let rawSys, rawDia;
            if (isCprArtifact) { rawSys = ensureFinite(ecgParams.cpr_abp_sys, 0); rawDia = ensureFinite(ecgParams.cpr_abp_dia, 0); }
            else { rawSys = ensureFinite(abpSrc.sys, 0); rawDia = ensureFinite(abpSrc.dia, 0); }
            const displayDia = Math.round(Math.max(0, rawDia));
            const displaySys = Math.round(Math.max(0, rawSys));
            sys = displaySys;
            dia = displayDia;
            map = (displaySys > displayDia) ? Math.round(displayDia + (displaySys - displayDia) / 3) : '--';
        } if (sysEl && sysEl.textContent !== String(sys)) sysEl.textContent = sys; if (diaEl && diaEl.textContent !== String(dia)) diaEl.textContent = dia; if (meanEl && meanEl.textContent !== String(map)) meanEl.textContent = map;
    }
     const mapControlEl = document.getElementById("map-display");
     if (mapControlEl) { let mapValue = '--'; if (abpSrc && ensureFinite(abpSrc.sys, 0) > ensureFinite(abpSrc.dia, 0)) { mapValue = Math.round(ensureFinite(abpSrc.dia,0) + (ensureFinite(abpSrc.sys,0) - ensureFinite(abpSrc.dia,0)) / 3); } const newMapText = `${mapValue} mmHg`; if (mapControlEl.textContent !== newMapText) { mapControlEl.textContent = newMapText; } }
}

function _updateEtco2Display(etco2Src, currentTime) {
    if (!etco2Src?.visible) return;
    const valEl = document.getElementById("etco2-value"); const unitEl = document.getElementById("etco2-unit"); const rrEl = document.getElementById("resp-rate-label");
    if (valEl && unitEl && _shouldUpdateNumeric('etco2', currentTime)) {
        const shape = etco2Src.etco2Shape; let displayEtco2Value = "--"; const valueKpa = ensureFinite(etco2Src.valueKpa, 0);
        const CPR_ETCO2_VALUE_KPA = 1.5; const valToUse = (shape === 'cpr_low_flow') ? CPR_ETCO2_VALUE_KPA : valueKpa; let currentUnit = etco2Src.unitPref || 'kPa';
        if (currentUnit === 'mmHg') { displayEtco2Value = Math.round(valToUse * KPA_TO_MMHG); } else { displayEtco2Value = valToUse.toFixed(1); }
        if (shape === 'disconnect') { displayEtco2Value = "---"; }
        if (valEl.textContent !== String(displayEtco2Value)) { valEl.textContent = displayEtco2Value; } if (unitEl.textContent !== currentUnit) { unitEl.textContent = currentUnit; }
    }
    if (rrEl && _shouldUpdateNumeric('rr', currentTime)) { const displayRR = Math.round(ensureFinite(etco2Src.rr, 0)); const newRrText = `RR: ${displayRR}`; if (rrEl.textContent !== newRrText) { rrEl.textContent = newRrText; } }
}

function _updateNibpDisplay(nibpSrc, currentTime) {
    if (!nibpSrc?.visible) return;
    if (_shouldUpdateNumeric('nibp', currentTime)) {
        const sysEl = document.getElementById("nibp-sys-value"); const diaEl = document.getElementById("nibp-dia-value"); const meanEl = document.getElementById("nibp-mean-value"); const timeEl = document.getElementById("nibp-time-label");
        if (sysEl && diaEl && meanEl && timeEl) { let sys='--', dia='--', map='--', time='Last: --:--';
            if (nibpSrc.sys !== null && nibpSrc.dia !== null && Number.isFinite(nibpSrc.sys) && Number.isFinite(nibpSrc.dia)) { sys = Math.round(nibpSrc.sys); dia = Math.round(nibpSrc.dia); map = (nibpSrc.map !== null && Number.isFinite(nibpSrc.map)) ? Math.round(nibpSrc.map) : '--'; }
             if (nibpSrc.timestamp instanceof Date) { const t = nibpSrc.timestamp; time = `Last: ${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}` }
            if(sysEl.textContent !== String(sys)) sysEl.textContent = sys; if(diaEl.textContent !== String(dia)) diaEl.textContent = dia; if(meanEl.textContent !== String(map)) meanEl.textContent = map; if(timeEl.textContent !== time) timeEl.textContent = time;
        }
    }
}

function _updateTempDisplay(tempSrc, currentTime) {
    if (!tempSrc?.visible) return;
    const valEl = document.getElementById("temp-value"); const unitEl = document.getElementById("temp-unit");
    if (valEl && unitEl && _shouldUpdateNumeric('temp', currentTime)) {
        const tempC = ensureFinite(tempSrc.valueC, DEFAULT_TEMP_C); let displayTemp = '--'; let currentUnit = tempSrc.unitPref === 'F' ? '°F' : '°C';
        if (Number.isFinite(tempC)) { if (tempSrc.unitPref === 'F') { displayTemp = celsiusToFahrenheit(tempC).toFixed(1); currentUnit = '°F'; } else { displayTemp = tempC.toFixed(1); currentUnit = '°C'; } }
         if (valEl.textContent !== displayTemp) { valEl.textContent = displayTemp; } if (unitEl.textContent !== currentUnit) { unitEl.textContent = currentUnit; }
    }
}

export function updateSliderDisplays(targetParams, calculateInitialHRFunc) {
    _updateHrSliderDisplay(targetParams, calculateInitialHRFunc);
    _updateSpo2SliderDisplay(targetParams);
    _updateAbpSliderDisplay(targetParams);
    _updateEtco2SliderDisplay(targetParams);
    _updateTempSliderDisplay(targetParams);
}
function _updateHrSliderDisplay(targetParams, calculateInitialHRFunc) { const hrD=document.getElementById("hr-slider-display"); if(targetParams.ecg && hrD && calculateInitialHRFunc){ const ecgP=targetParams.ecg.params||{}; const displayHRValue=ensureFinite(targetParams.ecg.hr,0); hrD.textContent=displayHRValue; }else if(hrD){ hrD.textContent='N/A'; } }
function _updateSpo2SliderDisplay(targetParams) { const spD=document.getElementById("spo2-slider-display"); if(targetParams.spo2 && spD){ spD.textContent=Math.round(ensureFinite(targetParams.spo2.value,0)) } else if(spD){ spD.textContent='N/A'; } }
function _updateAbpSliderDisplay(targetParams) { const abS=document.getElementById("abp-sys-slider-display"); const abD=document.getElementById("abp-dia-slider-display"); if(targetParams.abp && abS){ abS.textContent=Math.round(ensureFinite(targetParams.abp.sys,0)) } else if(abS){ abS.textContent='N/A'; } if(targetParams.abp && abD){ abD.textContent=Math.round(ensureFinite(targetParams.abp.dia,0)) } else if(abD){ abD.textContent='N/A'; } }
function _updateEtco2SliderDisplay(targetParams) { const etD=document.getElementById("etco2-slider-display"),etU=document.getElementById("etco2-slider-unit"),rrD=document.getElementById("rr-slider-display"),etP=targetParams.etco2; if(etP && etD && rrD && etU){ const targetKpa=ensureFinite(etP.valueKpa,0); if(etP.unitPref==='mmHg'){ etD.textContent=Math.round(targetKpa*KPA_TO_MMHG); etU.textContent="mmHg"; }else{ etD.textContent=targetKpa.toFixed(1); etU.textContent="kPa"; } rrD.textContent=Math.round(ensureFinite(etP.rr,0)); }else{ if(etD)etD.textContent='N/A'; if(etU)etU.textContent='-'; if(rrD)rrD.textContent='N/A'; } }
function _updateTempSliderDisplay(targetParams) { const tmD=document.getElementById("temp-slider-display"),tmP=targetParams.temp; if(tmP && tmD){ const tempC=ensureFinite(tmP.valueC,DEFAULT_TEMP_C); if(tmP.unitPref==='F'){ tmD.textContent=celsiusToFahrenheit(tempC).toFixed(1); }else{ tmD.textContent=tempC.toFixed(1); } }else if(tmD){ tmD.textContent='N/A'; } }

export function resetVitalsDisplay(targetParams) {
    const idsToReset = ["hr-value", "ecg-rhythm-display", "spo2-value", "spo2-pr-label", "abp-sys-value", "abp-dia-value", "abp-mean-value", "map-display", "etco2-value", "resp-rate-label", "nibp-sys-value", "nibp-dia-value", "nibp-mean-value", "nibp-time-label", "temp-value"];
    idsToReset.forEach(id => { const el = document.getElementById(id); if (el) { if (id === 'spo2-pr-label') el.textContent = "PR: --"; else if (id === 'resp-rate-label') el.textContent = "RR: --"; else if (id === 'nibp-time-label') el.textContent = "Last: --:--"; else if (id === 'map-display') el.textContent = "-- mmHg"; else el.textContent = "--"; } });
    const etco2UnitEl = document.getElementById("etco2-unit"); if(etco2UnitEl && targetParams?.etco2) etco2UnitEl.textContent = targetParams.etco2.unitPref; else if (etco2UnitEl) etco2UnitEl.textContent="kPa";
    const tempUnitEl = document.getElementById("temp-unit"); if(tempUnitEl && targetParams?.temp) tempUnitEl.textContent = targetParams.temp.unitPref==='F'?'°F':'°C'; else if (tempUnitEl) tempUnitEl.textContent="°C";
    Object.keys(lastNumericUpdateTimes).forEach(key => lastNumericUpdateTimes[key] = 0);
    console.log("[resetVitalsDisplay] Vitals displays reset.");
}

export function hideMonitorElements(monitorElements) {
     for(const k in monitorElements){ const wrapper=monitorElements[k]; if(wrapper) wrapper.classList.add('d-none'); }
    console.log("[hideMonitorElements] Monitor elements hidden.");
}

// --- VÄRIMUUTOS: Muokattu funktio ---
/**
 * Updates the monitor UI colors based on the provided colors object.
 * Sets CSS variables and forces chart update.
 * @param {object} colors - An object containing color values (e.g., { ecgColor: '#00ff00', ... }).
 * @param {object} charts - The Chartist chart instances object.
 */
export function updateMonitorColors(colors, charts) { // Lisätty charts-parametri
    if (!colors) {
        console.warn("[updateMonitorColors] Colors object is missing.");
        return;
    }
    console.log("[updateMonitorColors] Updating UI colors:", colors);

    const root = document.documentElement;

    // Määritä CSS-muuttujat
    if (colors.ecgColor) root.style.setProperty('--ecg-color', colors.ecgColor);
    if (colors.spo2Color) root.style.setProperty('--spo2-color', colors.spo2Color);
    if (colors.abpColor) root.style.setProperty('--abp-color', colors.abpColor);
    if (colors.etco2Color) root.style.setProperty('--etco2-color', colors.etco2Color);
    if (colors.nibpColor) root.style.setProperty('--nibp-color', colors.nibpColor);
    if (colors.tempColor) root.style.setProperty('--temp-color', colors.tempColor);

    // Pakota Chartist-kaavioiden päivitys, jotta ne käyttävät uusia CSS-muuttujia
    // Tämä on tarpeen, koska pelkkä CSS-muuttujan muutos ei välttämättä riitä SVG-elementeille.
    if (charts) {
        try {
            if (charts.ecgChart) charts.ecgChart.update(null, null, true); // Kolmas parametri 'true' voi auttaa joissain tapauksissa
            if (charts.spo2Chart) charts.spo2Chart.update(null, null, true);
            if (charts.abpChart) charts.abpChart.update(null, null, true);
            if (charts.etco2Chart) charts.etco2Chart.update(null, null, true);
            console.log("[updateMonitorColors] Forced chart updates.");
        } catch (e) {
            console.error("[updateMonitorColors] Error forcing chart update:", e);
        }
    } else {
        console.warn("[updateMonitorColors] Charts object missing, cannot force chart update.");
    }
}
// --- VÄRIMUUTOS LOPPUU ---
