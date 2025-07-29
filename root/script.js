// script.js - MedicalMonitor Main Class
// VERSION: ETCO2/RR update immediately. Separate sweep time for ETCO2.
//          Other params (HR, SpO2, ABP) retain interpolation.
//          + Added sound state callback for network manager.
//          + MODIFIED: ECG generation logic for new 'paced' generator.
//          + FIX: Initial beat timing for ECG and SpO2 waveforms.
//          + IMPROVEMENT: Implemented fixed timestep for simulation logic in _animationLoop
//                         to improve waveform stability, especially for ECG.
//          + IMPROVEMENT: Refined initiateParameterChange to reset beat/breath timing
//                         more effectively for smoother waveform transitions on vital updates.
//          + IMPROVEMENT (V2): Ensured currentParams.ecg.hr is updated to targetParams.ecg.hr
//                              before _calculateNextBeatTime in initiateParameterChange
//                              when HR changes, for more stable SpO2/ABP transitions.
//          + IMPROVEMENT (V3): ETCO2 parameter changes are now deferred to the end of the
//                              current breath cycle for smoother visual transitions.
//          + FIX (V4): Allow HR slider to control pacing rate for 'paced' generator types.
//          + IMPROVEMENT (V5): SpO2 and ABP parameter changes (value, shape) are now
//                              deferred to the start of the next beat cycle for smoother visuals.
//          + FIX (V6): Corrected ECG waveform generation for PEA and Pulseless VT
//                      to use the rhythm's baseHR for waveform shape cycle timing.
//          + FIX (V7): Restored interpolation for HR, SpO2, and ABP numeric values.
//                      Ensured _calculateNextBeatTime uses the target HR for interval calculation
//                      during HR interpolation. PEA/PVT drawing confirmed.
//          + FIX (Ongelma 1 & 2): Shock button logic corrected to use UI selected rhythm.
//                                ETCO2 visibility toggle fixed in initiateParameterChange.
//          + FIX (Ongelma 1 V2): Simplified _executeShock: only ECG parameters change immediately.
//          + FIX (Ongelma 1 V3): Enhanced _executeShock: other vitals change immediately based on new rhythm's perfusion status.
//          + FIX (Ongelma 1 V4): Modified _executeShock: ECG/HR change immediately, other vitals interpolate to new state.
//          + FIX (Ongelma 1 V5): Modified _executeShock: ETCO2 update after shock now uses its pending update mechanism.
//          + FIX (Ongelma 1 V6): Modified _executeShock: Force immediate re-evaluation of ETCO2 by resetting breath timing.
//          + ADDED: Pass monitor interface to networkManager for deactivation on session creation.
//          + MODIFIED (CPR Params Fix): Refined initiateParameterChange to allow user modification of
//                                     SpO2/ABP/ETCO2 parameters even when a pulseless/CPR rhythm
//                                     is active, ensuring currentParams for these vitals only snap
//                                     to defaults when the rhythm *initially changes* to pulseless/CPR.
//          + FIX (ReferenceError): Added missing CPR_ETCO2_VALUE_KPA to imports from config.js.
//          + MODIFIED (VF/Pulseless ETCO2/RR Fix V10): Ensured that if a pulseless rhythm (like VF)
//                                     is active, user changes to ETCO2/RR (and SpO2/ABP)
//                                     are correctly scheduled for update or interpolated,
//                                     instead of being overridden by pulseless defaults after initial switch.
//          + MODIFIED (VF/Pulseless ETCO2/RR Fix V11): Further refined ETCO2 pending update logic
//                                     in initiateParameterChange to correctly reset breath timing
//                                     when user sets a positive RR while current RR is 0.
//          + MODIFIED (VF/Pulseless ETCO2/RR Fix V12): Reverted ETCO2 updates in initiateParameterChange
//                                     to be immediate for value, RR, shape, and unit, similar to an older working version,
//                                     to ensure user changes are reflected even during pulseless rhythms.
//                                     Removed isEtco2UpdatePending and pendingEtco2Params.
//          + MODIFIED (VF/Pulseless ETCO2/RR Fix V13): Moved ETCO2 direct update to the beginning of
//                                     initiateParameterChange to ensure user ETCO2/RR changes take
//                                     precedence before any rhythm-specific overrides for other vitals.
//          + MODIFIED (ETCO2 Deferred Update Fix V14): Reinstated deferred ETCO2 updates (pendingEtco2Params)
//                                     to apply at the next breath cycle. Ensured correct breath timing reset
//                                     when RR changes from 0 to >0 during pulseless rhythms.
//          + MODIFIED (ETCO2 Deferred Update Fix V15): Refined ETCO2 update logic in initiateParameterChange
//                                     to ensure interpolationTargetParams.etco2 is updated immediately with targetParams,
//                                     while currentParams.etco2 update remains deferred to the next breath cycle.
//          + MODIFIED (ETCO2 Deferred Update Fix V16): Corrected ETCO2 update logic to ensure changes are
//                                     always deferred to the next breath cycle, and correctly handles
//                                     transitions from RR=0 to RR>0 during pulseless states.
//          + MODIFIED (ETCO2 Deferred Update Fix V17): Critical fix to ETCO2 update logic in initiateParameterChange
//                                     to correctly defer RR changes (when current RR > 0) to the next cycle,
//                                     preventing waveform cutoff. Only force immediate breath reset if RR goes from 0 to >0.
//          + BUGFIX (Visibility Toggle): Ensured visibility changes are robustly applied to currentParams
//                                     and interpolationTargetParams in initiateParameterChange.

// --- Module Imports ---
import {
  BUFFER_SECONDS,
  SAMPLE_RATE,
  BUFFER_SIZE,
  ETCO2_BUFFER_SECONDS,
  ETCO2_BUFFER_SIZE,
  DEFAULT_ETCO2_KPA,
  DEFAULT_RESP_RATE,
  DEFAULT_ETCO2_SHAPE,
  DEFAULT_ABP_SHAPE,
  DEFAULT_SPO2_SHAPE,
  DEFAULT_TEMP_C,
  DEFAULT_TEMP_UNIT,
  fahrenheitToCelsius,
  VITAL_INTERPOLATION_RATE,
  INTERPOLATION_SNAP_THRESHOLD,
  NUMERIC_DISPLAY_UPDATE_INTERVAL_MS,
  KPA_TO_MMHG,
  CPR_ETCO2_VALUE_KPA, // Varmistetaan, että tämä on tuotu
} from "./config.js";
import { RHYTHM_PARAMS } from "./rhythms.js";
import {
  generateNoise,
  ensureFinite,
  generatePlethPulseShape,
  generateAbpWaveformShape,
  generateEtco2WaveformShape,
} from "./waveformUtils.js";
import * as ecgGenerators from "./ecgGenerators/index.js";
import {
  updateMonitorVisibility,
  updateVitalsDisplay,
  updateSliderDisplays,
  resetVitalsDisplay,
  hideMonitorElements,
  updateMonitorColors,
} from "./uiUpdater.js";
import {
  bindControlEvents,
  updateControlsToReflectParams,
  showPendingChanges,
} from "./controlHandlers.js";
import { initializeCharts, updateCharts, clearCharts } from "./chartManager.js";
import {
  initializeAlarms,
  checkAlarms,
  updateAlarmVisuals,
  triggerAlarmSounds,
  resetAlarmsOnStop,
  setSoundState,
} from "./alarmManager.js";
import {
  initializeNetwork,
  getCurrentRole,
  sendShockCommand,
  sendNibpTrigger,
} from "./networkManager.js";

import { GAP_SAMPLES } from "./config.js";

// --- Constants and Registries ---
const SHOCK_ARTIFACT_AMPLITUDE = 4.0;
const SHOCK_ARTIFACT_SAMPLES = 15;
const ecgGeneratorRegistry = {
  pqrst: ecgGenerators.generatePQRST,
  avBlock: ecgGenerators.generateAVBlock,
  chaotic: ecgGenerators.generateChaotic,
  flatline: ecgGenerators.generateFlatline,
  artifact: ecgGenerators.generateArtifact,
  paced: ecgGenerators.generatePaced,
};
const DEFAULT_FALLBACK_BEAT_INTERVAL = 2.0;
const DEFAULT_FALLBACK_BREATH_INTERVAL = 4.0;
const DEFAULT_COLORS = {
  ecgColor: "#00ff00",
  spo2Color: "#00ffff",
  abpColor: "#ff0000",
  etco2Color: "#ffff00",
  nibpColor: "#ff0000",
  tempColor: "#ffc107",
};

document.addEventListener("DOMContentLoaded", () => {
  console.log("[DOM] DOM loaded, initializing MedicalMonitor");

  class WaveformGenerator {
    constructor() {
      console.log("[Constructor] Initializing...");
      this.rhythmTime = 0;
      this.respiratoryTime = 0;
      this.lastTimestamp = 0;
      this.simulationTimeAccumulator = 0;
      this.nextBeatTime = 0;
      this.lastBeatTime = -Infinity;
      this.nextBreathTime = 0;
      this.lastBreathTime = -Infinity;
      this.nextCompressionTime = 0;
      this.lastCompressionTime = -Infinity;
      this.ecgState = {};
      this.currentParams = {};
      this.targetParams = {};
      this.interpolationTargetParams = null;
      this.animationRunning = false;
      this.animationFrameId = null;
      this.sweepIndex = 0;
      this.etco2SweepIndex = 0;
      this.pendingChangesAlert = null;
      this.updateVitalsButton = null;
      this.monitorElements = {};
      this.charts = {};
      this.chartInitialized = false;
      this.shockRequested = false;
      this.buffers = {
        sweepBufferECG: new Array(BUFFER_SIZE).fill(null),
        sweepBufferSpO2: new Array(BUFFER_SIZE).fill(null),
        sweepBufferABP: new Array(BUFFER_SIZE).fill(null),
        sweepBufferETCO2: new Array(ETCO2_BUFFER_SIZE).fill(null),
      };
      this.updateTimeoutId = null;
      this.previousActiveAlarms = {};

      this.pendingEtco2Params = null;
      this.isEtco2UpdatePending = false;
      this.pendingSpo2Params = null;
      this.isSpo2UpdatePending = false;
      this.pendingAbpParams = null;
      this.isAbpUpdatePending = false;

      try {
        this._cacheMonitorElements();
        initializeAlarms(this.monitorElements);
        this._initializeTargetParams();
        this.currentParams = JSON.parse(JSON.stringify(this.targetParams));
        this.interpolationTargetParams = JSON.parse(
          JSON.stringify(this.targetParams)
        );
        if (this.currentParams.nibp) {
          this.currentParams.nibp.sys = null;
          this.currentParams.nibp.dia = null;
          this.currentParams.nibp.map = null;
          this.currentParams.nibp.timestamp = null;
        }
        this.currentParams.colors = JSON.parse(
          JSON.stringify(this.targetParams.colors)
        );
        this.interpolationTargetParams.colors = JSON.parse(
          JSON.stringify(this.targetParams.colors)
        );

        const chartInitResult = initializeCharts(this.buffers);
        this.charts = chartInitResult.charts;
        this.chartInitialized = chartInitResult.chartInitialized;

        if (this.chartInitialized) {
          bindControlEvents(this);
          this.updateControlsToReflectParams();
          this.updateMonitorVisibility();
          this.updateVitalsDisplay();
          this.updateSliderDisplays();
          updateMonitorColors(this.currentParams.colors, this.charts);

          initializeNetwork(
            { // Callbacks
              onParamUpdate: this.handleRemoteParamUpdate.bind(this),
              onActivate: this.startAnimation.bind(this),
              onDeactivate: this.stopAnimation.bind(this),
              onShock: this._executeShock.bind(this),
              onNibpTrigger: this.handleRemoteNibpTrigger.bind(this),
              onSoundState: setSoundState,
            },
            { // Monitor Interface
              isMonitorActive: this.isMonitorActive.bind(this),
              deactivateMonitor: this.stopAnimation.bind(this)
            }
          );

          console.log("[Constructor] Initialization finished successfully.");
        } else {
          throw new Error("Chartist chart initialization failed.");
        }
      } catch (error) {
        console.error("CRITICAL Error during constructor:", error);
        alert(
          `Initialization Error! Check console (F12). Error: ${error.message}`
        );
        this._disableActivation();
      }
    }

    isMonitorActive() {
      return this.animationRunning;
    }

    _cacheMonitorElements() {
      this.monitorElements = {
        ecg: document.getElementById("ecg-container-wrapper"),
        spo2: document.getElementById("spo2-container-wrapper"),
        abp: document.getElementById("abp-container-wrapper"),
        etco2: document.getElementById("etco2-container-wrapper"),
        nibp: document.getElementById("nibp-container-wrapper"),
        temp: document.getElementById("temp-container-wrapper"),
      };
    }

    _initializeTargetParams() {
      const rhythmSelect = document.getElementById("ecg-rhythm-select");
      const hrSlider = document.getElementById("hr-slider");
      const spo2Slider = document.getElementById("spo2-slider");
      const spo2ShapeSelect = document.getElementById("spo2-shape-select");
      const abpSysSlider = document.getElementById("abp-sys-slider");
      const abpDiaSlider = document.getElementById("abp-dia-slider");
      const abpShapeSelect = document.getElementById("abp-shape-select");
      const etco2Slider = document.getElementById("etco2-slider");
      const rrSlider = document.getElementById("rr-slider");
      const etco2UnitSwitch = document.getElementById("etco2-unit-switch");
      const etco2ShapeSelect = document.getElementById("etco2-shape-select");
      const tempSlider = document.getElementById("temp-slider");
      const tempUnitSwitch = document.getElementById("temp-unit-switch");
      const ecgVisSwitch = document.getElementById("ecg-visibility-switch");
      const spo2VisSwitch = document.getElementById("spo2-visibility-switch");
      const abpVisSwitch = document.getElementById("abp-visibility-switch");
      const etco2VisSwitch = document.getElementById("etco2-visibility-switch");
      const nibpVisSwitch = document.getElementById("nibp-visibility-switch");
      const tempVisSwitch = document.getElementById("temp-visibility-switch");

      const initialRhythmKey = rhythmSelect ? rhythmSelect.value : "normal";
      const initialEcgParamsFromRhythms =
        RHYTHM_PARAMS[initialRhythmKey] ?? RHYTHM_PARAMS["normal"];
      let currentEcgParams = JSON.parse(
        JSON.stringify(initialEcgParamsFromRhythms)
      );
      const initialSliderHR = hrSlider
        ? parseInt(hrSlider.value, 10)
        : initialEcgParamsFromRhythms.baseHR ?? 75;
      const { initialHR } = this._calculateInitialHR(
        currentEcgParams,
        initialSliderHR
      );
      const initialSpo2Value = spo2Slider ? parseInt(spo2Slider.value, 10) : 98;
      const initialSpo2Shape = spo2ShapeSelect
        ? spo2ShapeSelect.value
        : DEFAULT_SPO2_SHAPE;
      const initialAbpSys = abpSysSlider
        ? parseInt(abpSysSlider.value, 10)
        : 120;
      const initialAbpDia = abpDiaSlider
        ? parseInt(abpDiaSlider.value, 10)
        : 80;
      const initialAbpShape = abpShapeSelect
        ? abpShapeSelect.value
        : DEFAULT_ABP_SHAPE;
      const initialEtco2ValueSlider = etco2Slider
        ? parseFloat(etco2Slider.value)
        : DEFAULT_ETCO2_KPA;
      const initialEtco2Unit = etco2UnitSwitch?.checked ? "mmHg" : "kPa";
      const initialEtco2ValueKpa =
        initialEtco2Unit === "mmHg"
          ? initialEtco2ValueSlider / KPA_TO_MMHG
          : initialEtco2ValueSlider;
      const initialRR = rrSlider
        ? parseInt(rrSlider.value, 10)
        : DEFAULT_RESP_RATE;
      const initialEtco2Shape = etco2ShapeSelect
        ? etco2ShapeSelect.value
        : DEFAULT_ETCO2_SHAPE;
      const initialTempUnit = tempUnitSwitch?.checked ? "F" : DEFAULT_TEMP_UNIT;
      let initialTempC = DEFAULT_TEMP_C;
      if (tempSlider) {
        const sliderValue = parseFloat(tempSlider.value);
        initialTempC =
          initialTempUnit === "F"
            ? fahrenheitToCelsius(sliderValue)
            : sliderValue;
      }
      const initialNibp = { sys: null, dia: null, map: null, timestamp: null };

      this.targetParams = {
        ecg: {
          rhythm: initialRhythmKey,
          hr: initialHR,
          params: currentEcgParams,
          visible: ecgVisSwitch ? ecgVisSwitch.checked : true,
        },
        spo2: {
          value: initialSpo2Value,
          shape: initialSpo2Shape,
          visible: spo2VisSwitch ? spo2VisSwitch.checked : true,
        },
        abp: {
          sys: initialAbpSys,
          dia: initialAbpDia,
          shape: initialAbpShape,
          visible: abpVisSwitch ? abpVisSwitch.checked : true,
        },
        etco2: {
          valueKpa: initialEtco2ValueKpa,
          rr: initialRR,
          unitPref: initialEtco2Unit,
          etco2Shape: initialEtco2Shape,
          visible: etco2VisSwitch ? etco2VisSwitch.checked : true,
        },
        temp: {
          valueC: initialTempC,
          unitPref: initialTempUnit,
          visible: tempVisSwitch ? tempVisSwitch.checked : true,
        },
        nibp: {
          ...initialNibp,
          visible: nibpVisSwitch ? nibpVisSwitch.checked : true,
        },
        colors: JSON.parse(JSON.stringify(DEFAULT_COLORS)),
      };
      console.log("[_initializeTargetParams] Initial target params set.");
    }

    _calculateInitialHR(ecgParams, sliderValue) {
      let initialHR = 0;
      let canChangeHR = false;
      if (!ecgParams) return { initialHR: 0, canChangeHR: false };

      const generatorType = ecgParams.generatorType;
      const isPEA = ecgParams.isPEA ?? false;
      const isChaotic = ecgParams.isChaotic ?? false;
      const isFlat = ecgParams.isFlat ?? false;
      const isArtifact = ecgParams.isArtifact ?? false;
      const isCprArtifact = isArtifact && ecgParams.artifactType === "cpr";
      const isPulselessOrCPR = isPEA || isChaotic || isFlat || isCprArtifact;

      if (isPulselessOrCPR) {
        initialHR = 0;
        canChangeHR = false;
      } else if (generatorType === "avBlock") {
        initialHR = ecgParams.baseHR ?? 0;
        canChangeHR = false;
      } else if (generatorType === "paced") {
        initialHR =
          sliderValue !== undefined &&
          sliderValue !== null &&
          !isNaN(parseInt(sliderValue, 10))
            ? parseInt(sliderValue, 10)
            : ecgParams.baseHR ?? 70;
        canChangeHR = true;
      } else if (generatorType === "pqrst") {
        initialHR =
          sliderValue !== undefined &&
          sliderValue !== null &&
          !isNaN(parseInt(sliderValue, 10))
            ? parseInt(sliderValue, 10)
            : ecgParams.baseHR ?? 75;
        canChangeHR = true;
      } else {
        initialHR =
          sliderValue !== undefined &&
          sliderValue !== null &&
          !isNaN(parseInt(sliderValue, 10))
            ? parseInt(sliderValue, 10)
            : ecgParams.baseHR ?? 50;
        canChangeHR = true;
      }
      return { initialHR: Math.round(ensureFinite(initialHR, 0)), canChangeHR };
    }


    updateWaveforms(simulationStep) {
      this.rhythmTime += simulationStep;
      this.respiratoryTime += simulationStep;

      this._checkAndResetTimers();

      const ecgResult = this._generateECGWaveformInternal(
        this.rhythmTime,
        this.ecgState
      );
      this.ecgState = ecgResult.state;

      const spo2WaveValue = this._generateSpo2WaveformInternal();
      const abpWaveValue = this._generateAbpWaveformInternal();
      const etco2WaveValue = this._generateEtco2WaveformInternal();

      this._manageSweepBuffer(
        ecgResult.value,
        spo2WaveValue,
        abpWaveValue,
        etco2WaveValue
      );

      this.sweepIndex++;
      this.etco2SweepIndex++;
    }


    _checkAndResetTimers() {
      const currentTime = this.rhythmTime;

      // ETCO2 pending update application
      if (this.isEtco2UpdatePending && this.pendingEtco2Params) {
        if (this.respiratoryTime >= this.nextBreathTime) {
            console.log("[_checkAndResetTimers V16] Applying pending ETCO2 parameter update.");
            this.currentParams.etco2 = JSON.parse(JSON.stringify(this.pendingEtco2Params));

            const newRr = this.currentParams.etco2.rr;
            const newBreathInterval = newRr > 0 ? Math.max(0.5, 60.0 / newRr) : Infinity;

            this.lastBreathTime = this.respiratoryTime;
            this.nextBreathTime = this.respiratoryTime + newBreathInterval;

            this.isEtco2UpdatePending = false;
            this.pendingEtco2Params = null;
            this.updateVitalsDisplay();
        }
      } else if (this.currentParams.etco2 && this.respiratoryTime >= this.nextBreathTime) {
        const currentRr = ensureFinite(this.currentParams.etco2.rr, 0);
        const currentBreathInterval = currentRr > 0 ? Math.max(0.5, 60.0 / currentRr) : Infinity;
        if (currentBreathInterval < Infinity) {
            this._resetBreathTiming(currentBreathInterval);
        }
      }


      const ecgParams = this.currentParams.ecg?.params;
      if (ecgParams) {
        const generatorType = ecgParams.generatorType;
        if (
          generatorType === "pqrst" ||
          generatorType === "avBlock" ||
          generatorType === "paced"
        ) {
          if (currentTime >= this.nextBeatTime) {
            this.lastBeatTime = this.nextBeatTime;
            this._calculateNextBeatTime();

            if (this.isSpo2UpdatePending && this.pendingSpo2Params) {
                console.log("[_checkAndResetTimers V16] Applying pending SpO2 parameter update.");
                this.currentParams.spo2.shape = this.pendingSpo2Params.shape;
                this.isSpo2UpdatePending = false;
                this.pendingSpo2Params = null;
                this.updateVitalsDisplay();
            }
            if (this.isAbpUpdatePending && this.pendingAbpParams) {
                console.log("[_checkAndResetTimers V16] Applying pending ABP parameter update.");
                this.currentParams.abp.shape = this.pendingAbpParams.shape;
                this.isAbpUpdatePending = false;
                this.pendingAbpParams = null;
                this.updateVitalsDisplay();
            }
          }
        } else if (
          generatorType === "artifact" &&
          ecgParams.artifactType === "cpr"
        ) {
          if (currentTime >= this.nextCompressionTime) {
            this._resetCompressionTiming();
             if (this.isSpo2UpdatePending && this.pendingSpo2Params) {
                this.currentParams.spo2.shape = this.pendingSpo2Params.shape;
                this.isSpo2UpdatePending = false; this.pendingSpo2Params = null; this.updateVitalsDisplay();
            }
            if (this.isAbpUpdatePending && this.pendingAbpParams) {
                this.currentParams.abp.shape = this.pendingAbpParams.shape;
                this.isAbpUpdatePending = false; this.pendingAbpParams = null; this.updateVitalsDisplay();
            }
          }
        }
      }
    }


    _resetBreathTiming(interval) {
      this.lastBreathTime = this.respiratoryTime;
      this.nextBreathTime = this.respiratoryTime + interval;
    }

    _calculateNextBeatTime() {
      let rate = 0;
      let interval = Infinity;
      const ecgSourceForRate = this.interpolationTargetParams?.ecg || this.currentParams.ecg;
      const params = ecgSourceForRate?.params;

      if (params && ecgSourceForRate) {
        const generatorType = params.generatorType;
        const isPEA = params.isPEA ?? false;
        const isPulselessVT = ecgSourceForRate.rhythm === "vt_pulseless";

        if (generatorType === "pqrst") {
            if (isPEA || isPulselessVT) {
                rate = Math.max(ensureFinite(params.baseHR, 0), 0);
            } else {
                rate = Math.max(ensureFinite(ecgSourceForRate.hr, 0), 0);
            }
        } else if (generatorType === "avBlock" || generatorType === "paced") {
          rate = Math.max(ensureFinite(ecgSourceForRate.hr, 0), 0);
        }
      }

      if (rate > 0) {
        interval = 60.0 / rate;
        const irreg = params?.irregular ?? 0;
        if (irreg > 0 && irreg <= 1 && this.currentParams.ecg?.params) {
          interval *= 1.0 + (Math.random() - 0.5) * 2 * irreg;
        }
        interval = Math.max(0.1, interval);
      } else {
        interval = Infinity;
      }

      if (interval === Infinity) {
        this.nextBeatTime = Infinity;
      } else {
        const baseTime = (this.lastBeatTime === -Infinity) ? this.rhythmTime : this.lastBeatTime;
        this.nextBeatTime = baseTime + interval;

        if (this.nextBeatTime <= this.rhythmTime) {
             this.nextBeatTime = this.rhythmTime + (1.0 / SAMPLE_RATE);
        }
      }
    }


    _resetCompressionTiming() {
      this.lastCompressionTime = this.rhythmTime;
      const params = this.currentParams.ecg?.params;
      let interval = Infinity;
      if (
        params &&
        params.generatorType === "artifact" &&
        params.artifactType === "cpr"
      ) {
        const freq = params.artifact_freq ?? 110;
        if (freq > 0) {
          interval = Math.max(0.1, 60.0 / freq);
        }
      }
      this.nextCompressionTime = this.rhythmTime + interval;
      this.lastBeatTime = this.lastCompressionTime;
    }

    _manageSweepBuffer(ecgValue, spo2Value, abpValue, etco2Value) {
      if (this.sweepIndex >= BUFFER_SIZE) {
        this.sweepIndex = 0;
      }
      if (this.sweepIndex < 0) {
        this.sweepIndex = 0;
      }

      const gapSize = GAP_SAMPLES ?? 5;
      for (let i = 0; i < gapSize; i++) {
        const gapIndex = (this.sweepIndex + i) % BUFFER_SIZE;
        if (gapIndex >= 0 && gapIndex < BUFFER_SIZE) {
          this.buffers.sweepBufferECG[gapIndex] = null;
          this.buffers.sweepBufferSpO2[gapIndex] = null;
          this.buffers.sweepBufferABP[gapIndex] = null;
        }
      }

      if (this.sweepIndex >= 0 && this.sweepIndex < BUFFER_SIZE) {
        this.buffers.sweepBufferECG[this.sweepIndex] = ensureFinite(ecgValue, null);
        this.buffers.sweepBufferSpO2[this.sweepIndex] = ensureFinite(spo2Value, null);
        this.buffers.sweepBufferABP[this.sweepIndex] = ensureFinite(abpValue, null);
      }

      if (this.etco2SweepIndex >= ETCO2_BUFFER_SIZE) {
        this.etco2SweepIndex = 0;
      }
      if (this.etco2SweepIndex < 0) {
        this.etco2SweepIndex = 0;
      }

      for (let i = 0; i < gapSize; i++) {
        const etco2GapIndex = (this.etco2SweepIndex + i) % ETCO2_BUFFER_SIZE;
        if (etco2GapIndex >= 0 && etco2GapIndex < ETCO2_BUFFER_SIZE) {
          this.buffers.sweepBufferETCO2[etco2GapIndex] = null;
        }
      }

      if (this.etco2SweepIndex >= 0 && this.etco2SweepIndex < ETCO2_BUFFER_SIZE) {
        this.buffers.sweepBufferETCO2[this.etco2SweepIndex] = ensureFinite(etco2Value, null);
      }
    }

    _generateECGWaveformInternal(currentTime, previousEcgState) {
      const ecgCurrent = this.currentParams.ecg;
      let currentEcgState = (previousEcgState && Object.keys(previousEcgState).length > 0)
                           ? JSON.parse(JSON.stringify(previousEcgState))
                           : {};
      let ecgValue = 0;

      if (!ecgCurrent || !ecgCurrent.params) {
        return { value: 0, state: {} };
      }

      const params = ecgCurrent.params;
      const generatorType = params.generatorType;
      const noiseAmp = params.noise_amp ?? 0.015;
      let updatedState = currentEcgState;

      const generatorFunction = ecgGeneratorRegistry[generatorType];

      if (generatorFunction) {
        if (generatorType === "pqrst" || generatorType === "paced") {
          let timeForGenerator = -1;

          if (Number.isFinite(this.lastBeatTime) && this.lastBeatTime > -Infinity) {
            timeForGenerator = currentTime - this.lastBeatTime;
          } else if (this.lastBeatTime === 0 && currentTime >=0) {
            timeForGenerator = currentTime;
          }

          const isPEA = params.isPEA ?? false;
          const isPulselessVT = ecgCurrent.rhythm === "vt_pulseless";
          let rateForDuration = 0;

          const hrSourceForCycle = this.interpolationTargetParams?.ecg?.hr ?? ecgCurrent.hr;

          if (isPEA || isPulselessVT) {
            rateForDuration = Math.max(ensureFinite(params.baseHR, 0), 0);
          } else {
            rateForDuration = Math.max(ensureFinite(hrSourceForCycle, 0), 0);
          }

          const cycleDuration =
            rateForDuration > 0
              ? 60.0 / rateForDuration
              : DEFAULT_FALLBACK_BEAT_INTERVAL;

          if (timeForGenerator >= 0 && timeForGenerator < cycleDuration * 1.5) {
            ecgValue = generatorFunction(timeForGenerator, params);
          } else {
            ecgValue = 0;
          }
          ecgValue += generateNoise(noiseAmp);
          updatedState = {};
        } else if (generatorType === "avBlock") {
          const result = generatorFunction(
            currentTime,
            params,
            currentEcgState
          );
          ecgValue = result.value;
          updatedState = result.state;
        } else if (generatorType === "chaotic") {
          ecgValue = generatorFunction(params);
          updatedState = {};
          this.lastBeatTime = -Infinity;
        } else if (generatorType === "flatline") {
          ecgValue = generatorFunction(params);
          updatedState = {};
          this.lastBeatTime = -Infinity;
        } else if (
          generatorType === "artifact" &&
          params.artifactType === "cpr"
        ) {
          const timeSinceLastCompression =
            currentTime - this.lastCompressionTime;
          if (
            this.lastCompressionTime > -Infinity &&
            timeSinceLastCompression >= 0
          ) {
            ecgValue = generatorFunction(timeSinceLastCompression, params);
          } else {
            ecgValue = generateNoise(noiseAmp);
          }
          updatedState = {};
        }
      } else {
        console.warn(
          `[ECG Gen] Unknown or missing generatorType: '${generatorType}'`
        );
        ecgValue = generateNoise(noiseAmp);
        updatedState = {};
        this.lastBeatTime = -Infinity;
      }

      if (typeof updatedState !== "object" || updatedState === null) {
        updatedState = {};
      }
      return { value: ensureFinite(ecgValue), state: updatedState };
    }


    _generateSpo2WaveformInternal() {
      const spo2Params = this.currentParams.spo2;
      if (!spo2Params) return null;

      let timeSincePulse = -1;
      let pulseDuration = Infinity;

      const ecgParams = this.currentParams.ecg?.params;
      const ecgSourceForRate = this.interpolationTargetParams?.ecg || this.currentParams.ecg; // Use target HR for pulse duration
      const isCprArtifact =
        ecgParams?.isArtifact && ecgParams?.artifactType === "cpr";

      if (Number.isFinite(this.lastBeatTime) && this.lastBeatTime > -Infinity) {
        timeSincePulse = this.rhythmTime - this.lastBeatTime;
        const hrForPulse = Math.max(ensureFinite(ecgSourceForRate?.hr, 1), 1);
        let rateToUse = 0;

        if (isCprArtifact) {
          rateToUse = ecgParams.artifact_freq ?? 110;
        } else if (ecgParams?.generatorType === 'avBlock' && !(ecgParams.isPEA ?? false)) {
          rateToUse = Math.max(ensureFinite(ecgSourceForRate?.hr, 1),1);
        } else if (ecgParams?.generatorType === 'paced' && !(ecgParams.isPEA ?? false)) {
          rateToUse = Math.max(ensureFinite(ecgSourceForRate?.hr, 1),1);
        } else if (ecgParams?.generatorType === 'pqrst' && !(ecgParams.isPEA ?? false) && ecgSourceForRate.rhythm !== 'vt_pulseless') {
          rateToUse = hrForPulse;
        } else if (ecgParams?.generatorType === 'pqrst' && (ecgParams.isPEA || ecgSourceForRate.rhythm === 'vt_pulseless')) {
            rateToUse = Math.max(ensureFinite(ecgParams.baseHR, 1), 1);
        }
        pulseDuration = rateToUse > 0 ? 60.0 / rateToUse : Infinity;

      } else if (this.lastBeatTime === 0 && this.rhythmTime >=0) {
        timeSincePulse = this.rhythmTime;
        const hrForPulse = Math.max(ensureFinite(ecgSourceForRate?.hr, 1), 1);
         let rateToUse = 0;
        if (isCprArtifact) { rateToUse = ecgParams.artifact_freq ?? 110; }
        else if (hrForPulse > 0) { rateToUse = hrForPulse; }
        pulseDuration = rateToUse > 0 ? 60.0 / rateToUse : Infinity;
      } else {
        pulseDuration = Infinity;
      }

      if (
        timeSincePulse < 0 ||
        pulseDuration <= 0 ||
        !Number.isFinite(pulseDuration)
      ) {
        pulseDuration = DEFAULT_FALLBACK_BEAT_INTERVAL;
        timeSincePulse = this.rhythmTime % pulseDuration;
      }

      const validDuration = pulseDuration;
      const validTimeSincePulse = timeSincePulse;

      const currentSpo2Value = ensureFinite(spo2Params.value, 0);
      const originalShapeType = spo2Params.shape || DEFAULT_SPO2_SHAPE;
      let effectiveShapeType = originalShapeType;

      // If user has set SpO2 to 0 or shape to no_signal, respect that even during CPR.
      if (currentSpo2Value < 1 || originalShapeType === "no_signal") {
        effectiveShapeType = "no_signal";
      } else if (isCprArtifact && ecgParams) {
        // If CPR is active AND user has not set SpO2 to no_signal,
        // then use the CPR-defined SpO2 shape (e.g., low_perfusion).
        // If RHYTHM_PARAMS.cpr_artifact.spo2Shape is 'no_signal', it will use that.
        effectiveShapeType = ecgParams.spo2Shape || "low_perfusion";
      }


      return generatePlethPulseShape(
        validTimeSincePulse,
        validDuration,
        currentSpo2Value,
        effectiveShapeType
      );
    }

    _generateAbpWaveformInternal() {
      const abpParams = this.currentParams.abp;
      if (!abpParams) return null;

      let timeSincePulse = -1;
      let pulseDuration = Infinity;

      const ecgParams = this.currentParams.ecg?.params;
      const ecgSourceForRate = this.interpolationTargetParams?.ecg || this.currentParams.ecg; // Use target HR
      const isCprArtifact =
        ecgParams?.isArtifact && ecgParams?.artifactType === "cpr";

      if (Number.isFinite(this.lastBeatTime) && this.lastBeatTime > -Infinity) {
        timeSincePulse = this.rhythmTime - this.lastBeatTime;
        const hrForPulse = Math.max(ensureFinite(ecgSourceForRate?.hr, 1), 1);
        let rateToUse = 0;

        if (isCprArtifact) {
          rateToUse = ecgParams.artifact_freq ?? 110;
        } else if (ecgParams?.generatorType === 'avBlock' && !(ecgParams.isPEA ?? false)) {
          rateToUse = Math.max(ensureFinite(ecgSourceForRate?.hr, 1),1);
        } else if (ecgParams?.generatorType === 'paced' && !(ecgParams.isPEA ?? false)) {
          rateToUse = Math.max(ensureFinite(ecgSourceForRate?.hr, 1),1);
        } else if (ecgParams?.generatorType === 'pqrst' && !(ecgParams.isPEA ?? false) && ecgSourceForRate.rhythm !== 'vt_pulseless') {
          rateToUse = hrForPulse;
        } else if (ecgParams?.generatorType === 'pqrst' && (ecgParams.isPEA || ecgSourceForRate.rhythm === 'vt_pulseless')) {
            rateToUse = Math.max(ensureFinite(ecgParams.baseHR, 1), 1);
        }
        pulseDuration = rateToUse > 0 ? 60.0 / rateToUse : Infinity;
      } else if (this.lastBeatTime === 0 && this.rhythmTime >=0) {
        timeSincePulse = this.rhythmTime;
        const hrForPulse = Math.max(ensureFinite(ecgSourceForRate?.hr, 1), 1);
        let rateToUse = 0;
        if (isCprArtifact) { rateToUse = ecgParams.artifact_freq ?? 110; }
        else if (hrForPulse > 0) { rateToUse = hrForPulse; }
        pulseDuration = rateToUse > 0 ? 60.0 / rateToUse : Infinity;
      } else {
        pulseDuration = Infinity;
      }


      if (
        timeSincePulse < 0 ||
        pulseDuration <= 0 ||
        !Number.isFinite(pulseDuration)
      ) {
        pulseDuration = DEFAULT_FALLBACK_BEAT_INTERVAL;
        timeSincePulse = this.rhythmTime % pulseDuration;
      }

      const validDuration = pulseDuration;
      const validTimeSincePulse = timeSincePulse;

      let shapeType = abpParams.shape || DEFAULT_ABP_SHAPE;
      let targetSys = ensureFinite(abpParams.sys, 0);
      let targetDia = ensureFinite(abpParams.dia, 0);

      if (pulseDuration === Infinity && !isCprArtifact) { // If no pulse and not CPR, ABP is flat
        targetSys = 0;
        targetDia = 0;
        shapeType = "damped"; // Or some other flat representation
      } else if (isCprArtifact && ecgParams) {
        // During CPR, ABP waveform is driven by CPR compressions.
        // The target Sys/Dia values should reflect the user's settings if they've modified them,
        // otherwise, they fall back to CPR defaults from rhythms.js.
        shapeType = abpParams.shape || ecgParams.cpr_abp_shape || "damped"; // User's shape if set, else CPR default
        targetSys = ensureFinite(abpParams.sys, ensureFinite(ecgParams.cpr_abp_sys, 0));
        targetDia = ensureFinite(abpParams.dia, ensureFinite(ecgParams.cpr_abp_dia, 0));
      }
      // If user has explicitly set Sys/Dia to 0, reflect that.
      if (abpParams.sys === 0 && abpParams.dia === 0) {
          targetSys = 0;
          targetDia = 0;
          shapeType = "damped";
      }


      return generateAbpWaveformShape(
        validTimeSincePulse,
        validDuration,
        targetSys,
        targetDia,
        shapeType
      );
    }

    _generateEtco2WaveformInternal() {
      const etco2Params = this.currentParams.etco2;
      if (!etco2Params) return null;

      const currentShape = etco2Params.etco2Shape;
      const rr = ensureFinite(etco2Params.rr, 0); // User-modifiable RR
      const breathDuration = rr > 0 ? 60.0 / rr : Infinity;

      let validTimeSinceBreath = -1;
      let validDuration = DEFAULT_FALLBACK_BREATH_INTERVAL;

      if (breathDuration < Infinity && this.lastBreathTime > -Infinity) {
        validDuration = breathDuration;
        validTimeSinceBreath = this.respiratoryTime - this.lastBreathTime;
      } else if (breathDuration < Infinity) { // First breath or after a long pause
        validDuration = breathDuration;
        validTimeSinceBreath = this.respiratoryTime % validDuration;
      } else { // No respiration
        return 0; // Flat line if RR is 0
      }

      validTimeSinceBreath = Math.max(0, validTimeSinceBreath);

      // Use the user-set ETCO2 value and shape from currentParams
      const targetValueKpa = ensureFinite(etco2Params.valueKpa, 0);
      let valueForShape = targetValueKpa;
      let shapeForGenerator = currentShape;

      // If user sets RR to 0 or shape to 'disconnect', ETCO2 should be flat 0
      if (rr === 0 || currentShape === 'disconnect') {
          valueForShape = 0;
          shapeForGenerator = 'disconnect'; // Force disconnect shape for flatline
      } else if (currentShape === 'cpr_low_flow') {
          // If shape is 'cpr_low_flow', it uses the CPR_ETCO2_VALUE_KPA,
          // but RR is still user-controllable.
          // The targetValueKpa (user's slider value) is still stored in etco2Params.valueKpa
          // and will be used if the shape changes from cpr_low_flow.
          valueForShape = CPR_ETCO2_VALUE_KPA;
      }


      return generateEtco2WaveformShape(
        validTimeSinceBreath,
        validDuration,
        valueForShape,
        shapeForGenerator
      );
    }

    initiateParameterChange() {
        console.log("[initiateParameterChange V17 BUGFIX] Initiating parameter change.");
        const oldRhythmKey = this.currentParams.ecg?.rhythm;
        const oldCurrentHR = this.currentParams.ecg?.hr; // Tallenna vanha HR vertailua varten
        const oldCurrentEtco2RR = this.currentParams.etco2?.rr ?? 0;
        const oldSpo2Shape = this.currentParams.spo2?.shape;
        const oldAbpShape = this.currentParams.abp?.shape;

        // Update interpolation target to the latest user-set targetParams (from sliders)
        this.interpolationTargetParams = JSON.parse(JSON.stringify(this.targetParams));
        let ecgTimingResetNeeded = false;

        // --- KORJATTU OSA: Näkyvyys- ja värimuutosten käsittely ---
        // Sovella näkyvyysmuutokset suoraan ja välittömästi currentParamsiin ja interpolationTargetParamsiin
        for (const key of ["ecg", "spo2", "abp", "etco2", "temp", "nibp"]) {
            if (this.targetParams[key]) {
                if (this.currentParams[key]) {
                    // Varmista, että 'visible' on aina olemassa ennen kopiointia
                    if (typeof this.targetParams[key].visible === 'boolean') {
                        this.currentParams[key].visible = this.targetParams[key].visible;
                    }
                }
                if (this.interpolationTargetParams[key]) { // Päivitä myös interpolationTarget
                    if (typeof this.targetParams[key].visible === 'boolean') {
                        this.interpolationTargetParams[key].visible = this.targetParams[key].visible;
                    }
                }
            }
        }

        // Sovella värimuutokset välittömästi
        if (this.targetParams.colors) {
            let colorsChanged = false;
            if (this.currentParams.colors) {
                 if(JSON.stringify(this.currentParams.colors) !== JSON.stringify(this.targetParams.colors)) {
                    this.currentParams.colors = JSON.parse(JSON.stringify(this.targetParams.colors));
                    colorsChanged = true;
                 }
            }
            // Varmistetaan, että interpolationTargetParams.colors on olemassa ennen vertailua/päivitystä
            if (!this.interpolationTargetParams.colors && this.targetParams.colors) {
                this.interpolationTargetParams.colors = JSON.parse(JSON.stringify(this.targetParams.colors));
                // colorsChanged-lippua ei tarvitse asettaa uudelleen, currentParams-päivitys riittää UI-triggerille
            } else if (this.interpolationTargetParams.colors && this.targetParams.colors) {
                 if(JSON.stringify(this.interpolationTargetParams.colors) !== JSON.stringify(this.targetParams.colors)) {
                    this.interpolationTargetParams.colors = JSON.parse(JSON.stringify(this.targetParams.colors));
                 }
            }

            if (colorsChanged) {
                updateMonitorColors(this.currentParams.colors, this.charts);
            }
        }
        // --- KORJATUN OSAN LOPPU ---


        // --- ETCO2 Handling: Set as pending, apply at next breath cycle ---
        if (this.targetParams.etco2 && this.currentParams.etco2) {
            const targetEtco2CoreForCompare = {
                valueKpa: this.targetParams.etco2.valueKpa,
                rr: this.targetParams.etco2.rr,
                etco2Shape: this.targetParams.etco2.etco2Shape
            };
            const currentEtco2CoreForCompare = { // What is currently running
                valueKpa: this.currentParams.etco2.valueKpa,
                rr: this.currentParams.etco2.rr,
                etco2Shape: this.currentParams.etco2.etco2Shape
            };

            if (JSON.stringify(targetEtco2CoreForCompare) !== JSON.stringify(currentEtco2CoreForCompare) ||
                (this.isEtco2UpdatePending && JSON.stringify(this.pendingEtco2Params) !== JSON.stringify(this.targetParams.etco2))) {
                console.log("[IPC V17 BUGFIX] ETCO2 target differs from current or existing pending. Scheduling/Re-scheduling.");
                this.pendingEtco2Params = JSON.parse(JSON.stringify(this.targetParams.etco2));
                this.isEtco2UpdatePending = true;
                // interpolationTargetParams.etco2 on jo päivitetty yllä olevassa näkyvyys/väri-lohkossa,
                // mutta varmistetaan, että se on täysin synkassa targetParamsin kanssa numeeristen arvojen osalta.
                this.interpolationTargetParams.etco2 = JSON.parse(JSON.stringify(this.targetParams.etco2));


                const newPendingRR = this.pendingEtco2Params.rr;
                if (newPendingRR > 0 && oldCurrentEtco2RR === 0) {
                    console.log(`[IPC V17 BUGFIX] ETCO2 RR changing from 0 to ${newPendingRR}. Forcing breath timer reset.`);
                    this.nextBreathTime = this.respiratoryTime;
                }
            }

            if (this.currentParams.etco2.unitPref !== this.targetParams.etco2.unitPref) {
                this.currentParams.etco2.unitPref = this.targetParams.etco2.unitPref;
                if(this.interpolationTargetParams.etco2) { // Varmistetaan olemassaolo
                    this.interpolationTargetParams.etco2.unitPref = this.targetParams.etco2.unitPref;
                }
            }
        }


        // --- SpO2 Handling (Keep pending shape update for smoother visuals if not recovering) ---
        if (this.targetParams.spo2 && this.currentParams.spo2) {
            const targetSpo2String = JSON.stringify({value: this.targetParams.spo2.value, shape: this.targetParams.spo2.shape});
            const interpolationSpo2String = this.interpolationTargetParams.spo2 ? JSON.stringify({value: this.interpolationTargetParams.spo2.value, shape: this.interpolationTargetParams.spo2.shape}) : null;

            if (targetSpo2String !== interpolationSpo2String) {
                 console.log("[IPC V17 BUGFIX] SpO2 target differs from interpolation target. Scheduling shape update.");
                this.pendingSpo2Params = JSON.parse(JSON.stringify(this.targetParams.spo2));
                this.isSpo2UpdatePending = true;
                // interpolationTargetParams.spo2 on jo päivitetty yllä
                this.interpolationTargetParams.spo2 = JSON.parse(JSON.stringify(this.targetParams.spo2));


                const wasSpo2NoSignal = oldSpo2Shape === 'no_signal';
                const isNowSpo2Signal = this.targetParams.spo2.shape !== 'no_signal' && this.targetParams.spo2.value > 0;
                if (wasSpo2NoSignal && isNowSpo2Signal) {
                    this.currentParams.spo2.shape = this.targetParams.spo2.shape;
                    this.isSpo2UpdatePending = false;
                }
            }
        }

        // --- ABP Handling (Keep pending shape update for smoother visuals if not recovering) ---
        if (this.targetParams.abp && this.currentParams.abp) {
            const targetAbpString = JSON.stringify({sys: this.targetParams.abp.sys, dia: this.targetParams.abp.dia, shape: this.targetParams.abp.shape});
            const interpolationAbpString = this.interpolationTargetParams.abp ? JSON.stringify({sys: this.interpolationTargetParams.abp.sys, dia: this.interpolationTargetParams.abp.dia, shape: this.interpolationTargetParams.abp.shape}) : null;

            if (targetAbpString !== interpolationAbpString) {
                console.log("[IPC V17 BUGFIX] ABP target differs from interpolation target. Scheduling shape update.");
                this.pendingAbpParams = JSON.parse(JSON.stringify(this.targetParams.abp));
                this.isAbpUpdatePending = true;
                // interpolationTargetParams.abp on jo päivitetty yllä
                this.interpolationTargetParams.abp = JSON.parse(JSON.stringify(this.targetParams.abp));

                const wasAbpNoPressure = oldAbpShape === 'damped' && (this.currentParams.abp.sys === 0 || this.currentParams.abp.dia === 0);
                const isNowAbpPressure = this.targetParams.abp.sys > 0 || this.targetParams.abp.dia > 0;
                 if (wasAbpNoPressure && isNowAbpPressure) {
                    this.currentParams.abp.shape = this.targetParams.abp.shape;
                    this.isAbpUpdatePending = false;
                }
            }
        }

        // --- ECG Rhythm and HR Changes ---
        const targetRhythmKey = this.targetParams.ecg?.rhythm;
        if (targetRhythmKey && targetRhythmKey !== oldRhythmKey) { // Rhythm type changed
            ecgTimingResetNeeded = true;
            console.log(`[IPC V17 BUGFIX] Rhythm type CHANGED: ${oldRhythmKey} -> ${targetRhythmKey}`);
            this.currentParams.ecg.rhythm = targetRhythmKey;
            this.currentParams.ecg.params = RHYTHM_PARAMS[targetRhythmKey] ? JSON.parse(JSON.stringify(RHYTHM_PARAMS[targetRhythmKey])) : {};
            this.ecgState = {};

            const newEcgRuntimeParams = this.currentParams.ecg.params;
            const isNewRhythmPulselessOrCpr = newEcgRuntimeParams && (newEcgRuntimeParams.isPEA || newEcgRuntimeParams.isChaotic || newEcgRuntimeParams.isFlat || targetRhythmKey === "vt_pulseless" || (newEcgRuntimeParams.isArtifact && newEcgRuntimeParams.artifactType === 'cpr'));

            if (isNewRhythmPulselessOrCpr) {
                console.log("[IPC V17 BUGFIX] New rhythm is pulseless/CPR. Snapping current HR and dependent vitals to defaults.");
                this.currentParams.ecg.hr = 0;
                const rhythmDefaults = RHYTHM_PARAMS[targetRhythmKey];

                if (this.currentParams.spo2 && rhythmDefaults) {
                    this.currentParams.spo2.value = (targetRhythmKey === 'cpr_artifact' && rhythmDefaults.spo2Value !== undefined) ? rhythmDefaults.spo2Value : 0;
                    this.currentParams.spo2.shape = (targetRhythmKey === 'cpr_artifact' && rhythmDefaults.spo2Shape) ? rhythmDefaults.spo2Shape : "no_signal";
                }
                if (this.currentParams.abp && rhythmDefaults) {
                    this.currentParams.abp.sys = (targetRhythmKey === 'cpr_artifact' && rhythmDefaults.cpr_abp_sys !== undefined) ? rhythmDefaults.cpr_abp_sys : 0;
                    this.currentParams.abp.dia = (targetRhythmKey === 'cpr_artifact' && rhythmDefaults.cpr_abp_dia !== undefined) ? rhythmDefaults.cpr_abp_dia : 0;
                    this.currentParams.abp.shape = (targetRhythmKey === 'cpr_artifact' && rhythmDefaults.cpr_abp_shape) ? rhythmDefaults.cpr_abp_shape : "damped";
                }

                if (this.currentParams.etco2 && rhythmDefaults) {
                    this.currentParams.etco2.valueKpa = (targetRhythmKey === 'cpr_artifact' && rhythmDefaults.etco2ValueKpa !== undefined) ? rhythmDefaults.etco2ValueKpa : 0;
                    this.currentParams.etco2.rr = (targetRhythmKey === 'cpr_artifact' && rhythmDefaults.respiratoryRate !== undefined) ? rhythmDefaults.respiratoryRate : 0;
                    this.currentParams.etco2.etco2Shape = (targetRhythmKey === 'cpr_artifact' && rhythmDefaults.etco2Shape) ? rhythmDefaults.etco2Shape : "disconnect";

                    this.interpolationTargetParams.etco2 = JSON.parse(JSON.stringify(this.currentParams.etco2));
                    this.isEtco2UpdatePending = false;
                    this.pendingEtco2Params = null;

                    this.lastBreathTime = -Infinity;
                    this.nextBreathTime = this.respiratoryTime;
                    this._resetBreathTiming(this.currentParams.etco2.rr > 0 ? 60.0 / this.currentParams.etco2.rr : Infinity);
                }

                this.interpolationTargetParams.ecg.hr = this.currentParams.ecg.hr;
                if(this.interpolationTargetParams.spo2) this.interpolationTargetParams.spo2 = JSON.parse(JSON.stringify(this.currentParams.spo2));
                if(this.interpolationTargetParams.abp) this.interpolationTargetParams.abp = JSON.parse(JSON.stringify(this.currentParams.abp));

                this.isSpo2UpdatePending = false; this.pendingSpo2Params = null;
                this.isAbpUpdatePending = false; this.pendingAbpParams = null;
            } else {
                const wasPulselessOrCpr = oldRhythmKey && RHYTHM_PARAMS[oldRhythmKey] && (RHYTHM_PARAMS[oldRhythmKey].isPEA || RHYTHM_PARAMS[oldRhythmKey].isChaotic || RHYTHM_PARAMS[oldRhythmKey].isFlat || oldRhythmKey === "vt_pulseless" || (RHYTHM_PARAMS[oldRhythmKey].isArtifact && RHYTHM_PARAMS[oldRhythmKey].artifactType === 'cpr'));
                if(wasPulselessOrCpr){
                    if (this.currentParams.spo2) this.currentParams.spo2.shape = this.targetParams.spo2.shape || DEFAULT_SPO2_SHAPE;
                    if (this.currentParams.abp) this.currentParams.abp.shape = this.targetParams.abp.shape || DEFAULT_ABP_SHAPE;
                }
            }
        } else if (this.targetParams.ecg && this.targetParams.ecg.hr !== oldCurrentHR) {
            ecgTimingResetNeeded = true;
            console.log(`[IPC V17 BUGFIX] Target HR (${this.targetParams.ecg.hr}) differs from current HR (${oldCurrentHR}) for the same rhythm.`);
            const currentEcgRuntimeParams = this.currentParams.ecg.params;
            const isCurrentRhythmPulselessOrCpr = currentEcgRuntimeParams && (currentEcgRuntimeParams.isPEA || currentEcgRuntimeParams.isChaotic || currentEcgRuntimeParams.isFlat || this.currentParams.ecg.rhythm === "vt_pulseless" || (currentEcgRuntimeParams.isArtifact && currentEcgRuntimeParams.artifactType === 'cpr'));
            if (isCurrentRhythmPulselessOrCpr) {
                this.currentParams.ecg.hr = 0;
                this.interpolationTargetParams.ecg.hr = 0;
                this.targetParams.ecg.hr = 0; // Myös targetParams.hr nollataan jos yritetään muuttaa pulssittomalla
                ecgTimingResetNeeded = false;
                console.log("[IPC V17 BUGFIX] HR change attempted on pulseless/CPR rhythm. HR forced to 0.");
            }
        }


        if (ecgTimingResetNeeded) {
            this.lastBeatTime = -Infinity;
            this.nextBeatTime = this.rhythmTime;
            this._calculateNextBeatTime();

            this.lastCompressionTime = -Infinity;
            this.nextCompressionTime = this.rhythmTime;
            if (this.currentParams.ecg.params?.artifactType === 'cpr') {
                this._resetCompressionTiming();
            }
        }

        this.updateMonitorVisibility();
        this.updateControlsToReflectParams();
        this.updateSliderDisplays();
        this.updateVitalsDisplay();
        this.previousActiveAlarms = {};
        updateAlarmVisuals();
        this.showPendingChanges();
        console.log("[IPC V17 BUGFIX] End. interpolationTarget ETCO2 RR: ", this.interpolationTargetParams.etco2?.rr);
    }


    handleRemoteParamUpdate(receivedParams) {
      console.log("[Script] Handling remote parameter update:", receivedParams);
      for (const key in receivedParams) {
        if (this.targetParams.hasOwnProperty(key)) {
          this.targetParams[key] = JSON.parse(
            JSON.stringify(receivedParams[key])
          );
        }
      }
      if (
        this.targetParams.ecg &&
        this.targetParams.ecg.rhythm &&
        RHYTHM_PARAMS[this.targetParams.ecg.rhythm]
      ) {
        this.targetParams.ecg.params = JSON.parse(
          JSON.stringify(RHYTHM_PARAMS[this.targetParams.ecg.rhythm])
        );
        console.log(
          "[Script] Updated target ECG params based on received rhythm:",
          this.targetParams.ecg.rhythm
        );
      } else if (this.targetParams.ecg) {
        console.warn(
          "[Script] Remote params missing valid ECG rhythm, cannot populate ecg.params"
        );
        this.targetParams.ecg.params = {};
      } else {
        console.warn("[Script] Remote params missing ECG object entirely.");
      }

      if (!this.animationRunning) {
        console.log(
          "[Script] Simulation not running, applying remote params directly to target and updating controls/colors."
        );
        this.currentParams = JSON.parse(JSON.stringify(this.targetParams));
        if (this.currentParams.nibp) {
            this.currentParams.nibp.sys = null; this.currentParams.nibp.dia = null;
            this.currentParams.nibp.map = null; this.currentParams.nibp.timestamp = null;
        }
        this.interpolationTargetParams = JSON.parse(JSON.stringify(this.currentParams));

        this.updateControlsToReflectParams();
        this.updateSliderDisplays();
        this.updateVitalsDisplay();
        if (this.targetParams.colors) {
          updateMonitorColors(this.targetParams.colors, this.charts);
        }
        return;
      }

      console.log(
        "[Script] Simulation running, initiating parameter change towards received target."
      );
      this.initiateParameterChange();
      this.updateControlsToReflectParams();
      this.updateSliderDisplays();
    }

    handleRemoteNibpTrigger(nibpData) {
      console.log("[Script] Handling remote NIBP trigger:", nibpData);
      if (!this.currentParams.nibp) {
        console.warn("[handleRemoteNibpTrigger] NIBP params object missing.");
        return;
      }
      if (nibpData) {
        this.currentParams.nibp.sys = nibpData.sys;
        this.currentParams.nibp.dia = nibpData.dia;
        this.currentParams.nibp.map = nibpData.map;
        this.currentParams.nibp.timestamp = nibpData.timestamp
          ? new Date(nibpData.timestamp)
          : null;

        if (this.targetParams.nibp) {
          this.targetParams.nibp.sys = nibpData.sys;
          this.targetParams.nibp.dia = nibpData.dia;
          this.targetParams.nibp.map = nibpData.map;
          this.targetParams.nibp.timestamp = this.currentParams.nibp.timestamp;
        }
        console.log(
          "[handleRemoteNibpTrigger] NIBP updated:",
          this.currentParams.nibp
        );
        this.updateVitalsDisplay();
      } else {
        console.warn("[handleRemoteNibpTrigger] Received empty NIBP data.");
      }
    }

    startAnimation() {
      if (this.animationRunning) return;
      console.log("[startAnimation] Attempting to start animation...");

      if (!this.chartInitialized) {
        console.error("[startAnimation] Cannot start: Charts not initialized.");
        this._disableActivation();
        return;
      }

      try {
        this.currentParams = JSON.parse(JSON.stringify(this.targetParams));
        if (
          this.currentParams.ecg &&
          this.currentParams.ecg.rhythm &&
          RHYTHM_PARAMS[this.currentParams.ecg.rhythm]
        ) {
          this.currentParams.ecg.params = JSON.parse(
            JSON.stringify(RHYTHM_PARAMS[this.currentParams.ecg.rhythm])
          );
        } else if (this.currentParams.ecg) {
          console.warn(
            "Initial targetParams missing valid ECG rhythm, cannot populate ecg.params for currentParams"
          );
          this.currentParams.ecg.params = {};
        }
        if (this.currentParams.nibp) {
          this.currentParams.nibp.sys = null;
          this.currentParams.nibp.dia = null;
          this.currentParams.nibp.map = null;
          this.currentParams.nibp.timestamp = null;
        }
        this.interpolationTargetParams = JSON.parse(
          JSON.stringify(this.currentParams)
        );

        if (this.updateTimeoutId !== null) {
          clearTimeout(this.updateTimeoutId);
          this.updateTimeoutId = null;
        }

        console.log(
          "[startAnimation] Starting simulation with params:",
          JSON.parse(JSON.stringify(this.currentParams))
        );

        this.sweepIndex = 0;
        this.etco2SweepIndex = 0;
        Object.values(this.buffers).forEach((buf) => buf.fill(null));
        this.rhythmTime = 0;
        this.respiratoryTime = 0;
        this.lastTimestamp = 0;
        this.simulationTimeAccumulator = 0;
        this.ecgState = {};

        this.pendingEtco2Params = null;
        this.isEtco2UpdatePending = false;
        this.pendingSpo2Params = null;
        this.isSpo2UpdatePending = false;
        this.pendingAbpParams = null;
        this.isAbpUpdatePending = false;


        this.lastBeatTime = 0;
        this.nextBeatTime = 0;

        this.lastBreathTime = -Infinity;
        this.nextBreathTime = 0;

        this.lastCompressionTime = -Infinity;
        this.nextCompressionTime = 0;

        this._calculateNextBeatTime();
        this._resetBreathTiming(
          this.currentParams.etco2.rr > 0
            ? 60.0 / this.currentParams.etco2.rr
            : Infinity
        );
        if (this.currentParams.ecg?.params?.artifactType === 'cpr') {
            this._resetCompressionTiming();
        }


        this.shockRequested = false;
        this.previousActiveAlarms = {};

        this.updateControlsToReflectParams();
        this.updateMonitorVisibility();
        this.updateVitalsDisplay();
        this.updateSliderDisplays();
        updateMonitorColors(this.currentParams.colors, this.charts);
        this.showPendingChanges();
        updateAlarmVisuals();

        this.animationRunning = true;
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = requestAnimationFrame(
          this._animationLoop.bind(this)
        );
        console.log("[startAnimation] Animation loop started.");

        const activateButton = document.getElementById("activate-button");
        if (activateButton) {
          activateButton.textContent = "Deactivate Monitor";
          activateButton.classList.replace("btn-success", "btn-danger");
        }
      } catch (e) {
        console.error("[startAnimation] Error:", e);
        alert("Failed to start simulation. Check console for details.");
        this.animationRunning = false;
        this._disableActivation();
      }
    }

    stopAnimation() {
      if (!this.animationRunning) return;
      console.log("[stopAnimation] Stopping animation...");
      this.animationRunning = false;
      this.shockRequested = false;

      if (this.updateTimeoutId !== null) {
        clearTimeout(this.updateTimeoutId);
        this.updateTimeoutId = null;
        console.log("[stopAnimation] Cleared pending vital update timeout.");
      }
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }

      resetAlarmsOnStop();
      this.previousActiveAlarms = {};

      this.ecgState = {};
      this.sweepIndex = 0;
      this.etco2SweepIndex = 0;
      this.rhythmTime = 0;
      this.respiratoryTime = 0;
      this.simulationTimeAccumulator = 0;
      this.lastBeatTime = -Infinity;
      this.nextBeatTime = 0;
      this.lastBreathTime = -Infinity;
      this.nextBreathTime = 0;
      this.lastCompressionTime = -Infinity;
      this.nextCompressionTime = 0;

      this.pendingEtco2Params = null;
      this.isEtco2UpdatePending = false;
      this.pendingSpo2Params = null;
      this.isSpo2UpdatePending = false;
      this.pendingAbpParams = null;
      this.isAbpUpdatePending = false;


      clearCharts(this.charts, this.buffers);
      this.updateMonitorVisibility();
      resetVitalsDisplay(this.targetParams);
      this.updateControlsToReflectParams();
      this.updateSliderDisplays();
      updateMonitorColors(this.targetParams.colors, this.charts);
      this.showPendingChanges();
      updateAlarmVisuals();

      const activateButton = document.getElementById("activate-button");
      if (activateButton) {
        activateButton.textContent = "Activate Monitor";
        activateButton.classList.replace("btn-danger", "btn-success");
      }
      console.log("[stopAnimation] Animation stopped successfully.");
    }

    _disableActivation() {
      const btn = document.getElementById("activate-button");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Error/Disabled";
      }
      const controlsArea = document.querySelector(".controls-area");
      if (controlsArea) {
        controlsArea.style.opacity = "0.5";
        controlsArea.style.pointerEvents = "none";
      }
    }

    _animationLoop(timestamp) {
        if (!this.animationRunning) return;

        if (this.shockRequested) {
            this.shockRequested = false;
            try {
                if (this.updateTimeoutId !== null) {
                    clearTimeout(this.updateTimeoutId);
                    this.updateTimeoutId = null;
                    console.log("[Shock] Cancelled pending parameter update due to shock.");
                    if (this.pendingChangesAlert) this.pendingChangesAlert.classList.add("d-none");
                    if (this.updateVitalsButton) this.updateVitalsButton.disabled = true;
                }
                this._executeShock(null);
                this.previousActiveAlarms = {};
                updateAlarmVisuals();
            } catch (e) {
                console.error("Error during _executeShock call from loop:", e);
                this.stopAnimation();
                alert(`Shock Error! Simulation Stopped. Check console. ${e.message}`);
                return;
            }
        }

        if (this.lastTimestamp === 0) {
            this.lastTimestamp = timestamp;
            this.animationFrameId = requestAnimationFrame(this._animationLoop.bind(this));
            return;
        }
        const deltaTimeSeconds = (timestamp - this.lastTimestamp) / 1000.0;
        this.lastTimestamp = timestamp;

        this.simulationTimeAccumulator += deltaTimeSeconds;
        const simulationStep = 1.0 / SAMPLE_RATE;

        while (this.simulationTimeAccumulator >= simulationStep) {
            if (!this.animationRunning) break;

            this.updateWaveforms(simulationStep);

            this.simulationTimeAccumulator -= simulationStep;
        }

        const interpolationDelta = deltaTimeSeconds;

        if (this.interpolationTargetParams && interpolationDelta > 0) {
            const rate = VITAL_INTERPOLATION_RATE;
            const snap = INTERPOLATION_SNAP_THRESHOLD;

            if (this.currentParams.ecg && this.interpolationTargetParams.ecg) {
                const targetVal = this.interpolationTargetParams.ecg.hr;
                const currentVal = this.currentParams.ecg.hr;
                const diff = targetVal - currentVal;
                if (Math.abs(diff) > snap) {
                    const ecgP = this.currentParams.ecg.params;
                    if (
                        !(
                            ecgP &&
                            (ecgP.isFlat ||
                            ecgP.isChaotic ||
                            ecgP.isPEA ||
                            ecgP.isArtifact || // Includes CPR artifact
                            this.currentParams.ecg.rhythm === "vt_pulseless")
                        )
                    ) { // Only interpolate HR if it's a rhythm where HR can change
                        this.currentParams.ecg.hr += diff * rate * interpolationDelta;
                    } else { // For fixed HR rhythms (like pulseless), ensure it's 0
                        if (this.currentParams.ecg.hr !== 0) this.currentParams.ecg.hr = 0;
                    }
                } else if (currentVal !== targetVal) {
                    this.currentParams.ecg.hr = targetVal;
                }
            }
            if (this.currentParams.spo2 && this.interpolationTargetParams.spo2) {
                const targetVal = this.interpolationTargetParams.spo2.value;
                const currentVal = this.currentParams.spo2.value;
                const diff = targetVal - currentVal;
                if (Math.abs(diff) > snap) {
                    this.currentParams.spo2.value += diff * rate * interpolationDelta;
                } else if (currentVal !== targetVal) {
                    this.currentParams.spo2.value = targetVal;
                }
                 if (this.currentParams.spo2.shape !== this.interpolationTargetParams.spo2.shape && !this.isSpo2UpdatePending) { // Apply shape if not pending
                    this.currentParams.spo2.shape = this.interpolationTargetParams.spo2.shape;
                }
            }
            if (this.currentParams.abp && this.interpolationTargetParams.abp) {
                const targetSys = this.interpolationTargetParams.abp.sys;
                const currentSys = this.currentParams.abp.sys;
                const diffSys = targetSys - currentSys;
                if (Math.abs(diffSys) > snap) {
                    this.currentParams.abp.sys += diffSys * rate * interpolationDelta;
                } else if (currentSys !== targetSys) {
                    this.currentParams.abp.sys = targetSys;
                }

                const targetDia = this.interpolationTargetParams.abp.dia;
                const currentDia = this.currentParams.abp.dia;
                const diffDia = targetDia - currentDia;
                if (Math.abs(diffDia) > snap) {
                    this.currentParams.abp.dia += diffDia * rate * interpolationDelta;
                } else if (currentDia !== targetDia) {
                    this.currentParams.abp.dia = targetDia;
                }
                this.currentParams.abp.dia = Math.max(0, this.currentParams.abp.dia);
                this.currentParams.abp.sys = Math.max(this.currentParams.abp.dia + 1, this.currentParams.abp.sys);

                if (targetSys === 0 && targetDia === 0 &&
                    Math.abs(this.currentParams.abp.sys) < snap * 2 &&
                    Math.abs(this.currentParams.abp.dia) < snap * 2) {
                    this.currentParams.abp.sys = 0;
                    this.currentParams.abp.dia = 0;
                }
                if (this.currentParams.abp.shape !== this.interpolationTargetParams.abp.shape && !this.isAbpUpdatePending) { // Apply shape if not pending
                    this.currentParams.abp.shape = this.interpolationTargetParams.abp.shape;
                }
            }
             // ETCO2: Values and shape are now handled by the pending update mechanism.
             // Only unitPref needs to be synced here if it changes.
            if (this.currentParams.etco2 && this.interpolationTargetParams.etco2) {
                if (this.currentParams.etco2.unitPref !== this.interpolationTargetParams.etco2.unitPref) {
                    this.currentParams.etco2.unitPref = this.interpolationTargetParams.etco2.unitPref;
                }
                // RR and ValueKpa are NOT interpolated here; they are applied discretely via pending update.
            }

            if (this.currentParams.temp && this.interpolationTargetParams.temp) {
                const targetValC = this.interpolationTargetParams.temp.valueC;
                const currentValC = this.currentParams.temp.valueC;
                const diffC = targetValC - currentValC;
                if (Math.abs(diffC) > snap) {
                    this.currentParams.temp.valueC += diffC * (rate / 2) * interpolationDelta; // Slower temp interpolation
                } else if (currentValC !== targetValC) {
                    this.currentParams.temp.valueC = targetValC;
                }
                if (this.currentParams.temp.unitPref !== this.interpolationTargetParams.temp.unitPref) {
                    this.currentParams.temp.unitPref = this.interpolationTargetParams.temp.unitPref;
                }
            }
        }

        updateCharts(this.charts, this.buffers, this.currentParams, this.monitorElements);
        this.updateVitalsDisplay();

        try {
            const currentActiveAlarms = checkAlarms(this.currentParams);
            const newlyActiveAlarms = {};
            for (const key in currentActiveAlarms) {
                if (currentActiveAlarms[key] && !this.previousActiveAlarms[key]) {
                    newlyActiveAlarms[key] = true;
                }
            }
            updateAlarmVisuals();
            triggerAlarmSounds(newlyActiveAlarms);
            this.previousActiveAlarms = currentActiveAlarms;
        } catch (e) {
            console.error("Error during alarm processing:", e);
        }

        if (this.animationRunning) {
            this.animationFrameId = requestAnimationFrame(this._animationLoop.bind(this));
        }
    }


    requestShock() {
      if (this.animationRunning) {
        console.log("[requestShock] Shock requested.");
        this.shockRequested = true;
      } else {
        console.log("[requestShock] Shock ignored (simulation not active).");
      }
    }

    _executeShock(remoteRhythmKey = null) {
      const role = getCurrentRole();
      console.log(
        `[_executeShock V16] Executing shock. Role: ${role}. Remote rhythm received: ${remoteRhythmKey}`
      );

      const shockStartTime = this.rhythmTime;
      // Shock artifact injection
      const initialSpikeSamples = 2;
      for (let i = 0; i < SHOCK_ARTIFACT_SAMPLES; i++) {
        if (this.sweepIndex >= BUFFER_SIZE) this.sweepIndex = 0;
        let shockValue = 0;
        if (i < initialSpikeSamples) {
          shockValue = i % 2 === 0 ? SHOCK_ARTIFACT_AMPLITUDE * 1.5 : -SHOCK_ARTIFACT_AMPLITUDE * 0.5;
        } else {
          const decayFactor = 1.0 - Math.pow((i - initialSpikeSamples) / (SHOCK_ARTIFACT_SAMPLES - initialSpikeSamples), 2);
          shockValue = generateNoise(SHOCK_ARTIFACT_AMPLITUDE * 0.7 * decayFactor);
        }
        this.buffers.sweepBufferECG[this.sweepIndex] = ensureFinite(shockValue, 0);
        this.sweepIndex++;
      }
      updateCharts(this.charts, this.buffers, this.currentParams, this.monitorElements);
      console.log(`[_executeShock V16] ECG Shock artifact injected.`);

      let newRhythmKey;
      const rhythmSelectEl = document.getElementById("ecg-rhythm-select");
      if (role === "monitor" && remoteRhythmKey) {
        newRhythmKey = remoteRhythmKey;
        if (rhythmSelectEl) rhythmSelectEl.value = newRhythmKey;
      } else {
        newRhythmKey = rhythmSelectEl ? rhythmSelectEl.value : "normal";
      }
      console.log(`[_executeShock V16] Post-shock rhythm will be: ${newRhythmKey}`);

      const newEcgParamsFromDefinition = RHYTHM_PARAMS[newRhythmKey];
      if (!newEcgParamsFromDefinition) {
        console.error(`Shock: Could not find params for rhythm: ${newRhythmKey}. Aborting rhythm change.`);
        this.ecgState = {};
        this.lastBeatTime = -Infinity;
        this.nextBeatTime = shockStartTime + (SHOCK_ARTIFACT_SAMPLES / SAMPLE_RATE) + 0.05;
        this._calculateNextBeatTime();
        return;
      }

      const newEcgRuntimeParams = JSON.parse(JSON.stringify(newEcgParamsFromDefinition));
      const isNewRhythmPulseless = newEcgRuntimeParams.isPEA ||
                                 newEcgRuntimeParams.isChaotic ||
                                 newEcgRuntimeParams.isFlat ||
                                 newRhythmKey === "vt_pulseless";
      const isNewRhythmCpr = newRhythmKey === 'cpr_artifact';
      let newHr;

      // 1. Update currentParams.ecg (rhythm, params, hr) immediately
      if (isNewRhythmPulseless || isNewRhythmCpr) {
        newHr = 0;
      } else {
        const { initialHR } = this._calculateInitialHR(newEcgRuntimeParams, newEcgRuntimeParams.baseHR);
        newHr = initialHR;
      }
      this.currentParams.ecg.rhythm = newRhythmKey;
      this.currentParams.ecg.params = newEcgRuntimeParams;
      this.currentParams.ecg.hr = newHr;

      // 2. Update targetParams and interpolationTargetParams for ECG to match the new currentParams.ecg
      this.targetParams.ecg = JSON.parse(JSON.stringify(this.currentParams.ecg));
      this.interpolationTargetParams.ecg = JSON.parse(JSON.stringify(this.currentParams.ecg));

      // 3. Define new target states for SpO2, ABP, ETCO2 based on the new rhythm
      let newTargetSpo2 = { ...(this.targetParams.spo2 || {}) };
      let newTargetAbp = { ...(this.targetParams.abp || {}) };
      let newTargetEtco2 = { ...(this.targetParams.etco2 || {}) };

      if (isNewRhythmPulseless || isNewRhythmCpr) {
        console.log(`[_executeShock V16] New rhythm ${newRhythmKey} is non-perfusing/CPR. Setting TARGETS for other vitals to non-perfusing/CPR state.`);
        newTargetSpo2 = {
            value: isNewRhythmCpr ? (newEcgRuntimeParams.spo2Value ?? 0) : 0,
            shape: isNewRhythmCpr ? (newEcgRuntimeParams.spo2Shape ?? "no_signal") : "no_signal",
            visible: this.targetParams.spo2?.visible ?? true
        };
        newTargetAbp = {
            sys: isNewRhythmCpr ? (newEcgRuntimeParams.cpr_abp_sys ?? 0) : 0,
            dia: isNewRhythmCpr ? (newEcgRuntimeParams.cpr_abp_dia ?? 0) : 0,
            shape: isNewRhythmCpr ? (newEcgRuntimeParams.cpr_abp_shape ?? "damped") : "damped",
            visible: this.targetParams.abp?.visible ?? true
        };
        newTargetEtco2 = {
            valueKpa: isNewRhythmCpr ? (newEcgRuntimeParams.etco2ValueKpa ?? 0) : 0,
            rr: isNewRhythmCpr ? (newEcgRuntimeParams.respiratoryRate ?? 0) : 0,
            etco2Shape: isNewRhythmCpr ? (newEcgRuntimeParams.etco2Shape || "cpr_low_flow") : "disconnect",
            unitPref: this.targetParams.etco2?.unitPref || "kPa",
            visible: this.targetParams.etco2?.visible ?? true
        };
      } else { // New rhythm is perfusing
        console.log(`[_executeShock V16] New rhythm ${newRhythmKey} is perfusing. Setting TARGETS for other vitals to perfusing state.`);
        newTargetSpo2 = {
            value: newEcgRuntimeParams.spo2Value !== undefined ? newEcgRuntimeParams.spo2Value : 98,
            shape: newEcgRuntimeParams.spo2Shape || DEFAULT_SPO2_SHAPE,
            visible: this.targetParams.spo2?.visible ?? true
        };
        newTargetAbp = {
            sys: newEcgRuntimeParams.abpSys !== undefined ? newEcgRuntimeParams.abpSys : 120,
            dia: newEcgRuntimeParams.abpDia !== undefined ? newEcgRuntimeParams.abpDia : 80,
            shape: newEcgRuntimeParams.abpShape || DEFAULT_ABP_SHAPE,
            visible: this.targetParams.abp?.visible ?? true
        };
        newTargetAbp.dia = Math.max(0, Math.min(newTargetAbp.dia, newTargetAbp.sys -1));
        newTargetAbp.sys = Math.max(newTargetAbp.dia + 1, newTargetAbp.sys);

        newTargetEtco2 = {
            valueKpa: newEcgRuntimeParams.etco2ValueKpa !== undefined ? newEcgRuntimeParams.etco2ValueKpa : DEFAULT_ETCO2_KPA,
            rr: newEcgRuntimeParams.respiratoryRate !== undefined ? newEcgRuntimeParams.respiratoryRate : DEFAULT_RESP_RATE,
            etco2Shape: newEcgRuntimeParams.etco2Shape || DEFAULT_ETCO2_SHAPE,
            unitPref: this.targetParams.etco2?.unitPref || "kPa",
            visible: this.targetParams.etco2?.visible ?? true
        };
      }

      // 4. Update targetParams and interpolationTargetParams for SpO2 & ABP
      if (this.targetParams.spo2) this.targetParams.spo2 = JSON.parse(JSON.stringify(newTargetSpo2));
      if (this.interpolationTargetParams.spo2) this.interpolationTargetParams.spo2 = JSON.parse(JSON.stringify(newTargetSpo2));
      if (isNewRhythmPulseless || isNewRhythmCpr) {
            this.currentParams.spo2.value = newTargetSpo2.value;
            this.currentParams.spo2.shape = newTargetSpo2.shape;
      }

      if (this.targetParams.abp) this.targetParams.abp = JSON.parse(JSON.stringify(newTargetAbp));
      if (this.interpolationTargetParams.abp) this.interpolationTargetParams.abp = JSON.parse(JSON.stringify(newTargetAbp));
      if (isNewRhythmPulseless || isNewRhythmCpr) {
            this.currentParams.abp.sys = newTargetAbp.sys;
            this.currentParams.abp.dia = newTargetAbp.dia;
            this.currentParams.abp.shape = newTargetAbp.shape;
      }

      // 5. For ETCO2: Update targetParams, interpolationTargetParams, AND currentParams immediately.
      //    Also, clear pending ETCO2 update and reset breath timing.
      if (this.targetParams.etco2) this.targetParams.etco2 = JSON.parse(JSON.stringify(newTargetEtco2));
      if (this.interpolationTargetParams.etco2) this.interpolationTargetParams.etco2 = JSON.parse(JSON.stringify(newTargetEtco2));
      if (this.currentParams.etco2) this.currentParams.etco2 = JSON.parse(JSON.stringify(newTargetEtco2));

      this.isEtco2UpdatePending = false;
      this.pendingEtco2Params = null;
      this.lastBreathTime = -Infinity;
      this.nextBreathTime = this.respiratoryTime;
      this._resetBreathTiming(this.currentParams.etco2.rr > 0 ? 60.0 / this.currentParams.etco2.rr : Infinity);
      console.log(`[_executeShock V16] ETCO2 updated immediately post-shock. Next breath time: ${this.nextBreathTime.toFixed(3)}`);


      // Reset ECG timing
      this.ecgState = {};
      this.lastBeatTime = -Infinity;
      this.nextBeatTime = shockStartTime + (SHOCK_ARTIFACT_SAMPLES / SAMPLE_RATE) + 0.05;
      this._calculateNextBeatTime();

      this.isSpo2UpdatePending = false; this.pendingSpo2Params = null;
      this.isAbpUpdatePending = false; this.pendingAbpParams = null;

      this.updateVitalsDisplay();
      this.updateControlsToReflectParams();
      this.updateSliderDisplays();
      this.showPendingChanges();

      if (role === "controller") {
        console.log(`[_executeShock V16] [Controller] Sending shock command via network with target rhythm: ${newRhythmKey}...`);
        sendShockCommand(newRhythmKey);
      }
      console.log("[_executeShock V16] Shock execution finished locally.");
    }

    updateVitalsDisplay() {
      updateVitalsDisplay(this.currentParams);
    }
    updateSliderDisplays() {
      updateSliderDisplays(this.targetParams, this._calculateInitialHR);
    }
    updateControlsToReflectParams() {
      updateControlsToReflectParams(this);
    }
    updateMonitorVisibility() {
      updateMonitorVisibility(this.monitorElements, this.currentParams);
    }
    showPendingChanges() {
      showPendingChanges(this);
    }
  } // ================= End Waveform Generator Class =================

  console.log("Setting up main application logic...");
  let monitor = null;
  try {
    monitor = new WaveformGenerator();
    if (!monitor || !monitor.chartInitialized) {
      throw new Error(
        "Monitor instance or chart init failed post-constructor."
      );
    }
    console.log("WaveformGenerator instance created successfully.");
  } catch (e) {
    console.error("CRITICAL FAILURE during monitor setup:", e);
    alert(`Monitor app failed init! Check console (F12). ${e.message}`);
    const activateButton = document.getElementById("activate-button");
    if (activateButton) {
      activateButton.textContent = "Setup Failed";
      activateButton.disabled = true;
    }
    const controlsArea = document.querySelector(".controls-area");
    if (controlsArea) {
      controlsArea.style.opacity = "0.5";
      controlsArea.style.pointerEvents = "none";
    }
    return;
  }
  console.log("Initial script execution finished successfully.");
});
