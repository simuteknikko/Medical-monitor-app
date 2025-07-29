// chartManager.js - Chartist Chart Management Helper Functions (ETCO2 axis high=9)

export function initializeCharts(buffers) {
    console.log("[initializeCharts] Initializing Chartist charts...");
    let chartInitialized = false;
    let ecgSuccess = false, spo2Success = false, abpSuccess = false, etco2Success = false;
    // Poistettu yläreunan täyte
    const commonOpts = {
      showPoint: false, showLine: true, showArea: false, fullWidth: true,
      axisX: { showGrid: false, showLabel: false, offset: 0 },
      axisY: { showGrid: false, showLabel: false, offset: 0 },
      chartPadding: { top: 0, right: 0, bottom: 0, left: 0 }, // top = 0
      lineSmooth: Chartist.Interpolation.none()
    };

    const initSingleChart = (containerId, buffer, options) => {
        try {
            const container = document.getElementById(containerId);
            if (!container) throw new Error(`${containerId} missing`);
            const chart = new Chartist.Line(container, { series: [buffer] }, options);
            if (!chart) throw new Error(`${containerId} object creation failed`);
            return chart;
        } catch (e) {
            console.error(`Chart Init Error (${containerId}):`, e);
            return null;
        }
    };

    const charts = {};
    charts.ecgChart = initSingleChart("ecg-chart-container", buffers.sweepBufferECG, {...commonOpts, axisY: {...commonOpts.axisY, low: -2.5, high: 2.5}});
    charts.spo2Chart = initSingleChart("spo2-chart-container", buffers.sweepBufferSpO2, {...commonOpts, axisY: {...commonOpts.axisY, low: -0.1, high: 1.1}});
    charts.abpChart = initSingleChart("abp-chart-container", buffers.sweepBufferABP, {...commonOpts, axisY: {...commonOpts.axisY, low: 0, high: 200}});
    // === MUUTETTU TÄMÄ RIVI ===
    charts.etco2Chart = initSingleChart("etco2-chart-container", buffers.sweepBufferETCO2, {...commonOpts, axisY: {...commonOpts.axisY, low: -1, high: 9}}); // high asetettu 9
    // === MUUTOS LOPPUU ===

    ecgSuccess = !!charts.ecgChart;
    spo2Success = !!charts.spo2Chart;
    abpSuccess = !!charts.abpChart;
    etco2Success = !!charts.etco2Chart;

    chartInitialized = ecgSuccess && spo2Success && abpSuccess && etco2Success;
    if (!chartInitialized) {
      alert("CRITICAL: One or more charts failed to initialize! Check console (F12).");
      console.error("Chart init status:", { ecgSuccess, spo2Success, abpSuccess, etco2Success });
    } else {
      console.log("[initializeCharts] All charts initialized successfully.");
    }

    return { charts, chartInitialized };
}

export function updateCharts(charts, buffers, currentParams, monitorElements) {
   if (!charts) return;
   try {
      if (currentParams.ecg?.visible && charts.ecgChart && !monitorElements.ecg.classList.contains('d-none')) {
          charts.ecgChart.update({ series: [buffers.sweepBufferECG] }, null, false);
      }
      if (currentParams.spo2?.visible && charts.spo2Chart && !monitorElements.spo2.classList.contains('d-none')) {
          charts.spo2Chart.update({ series: [buffers.sweepBufferSpO2] }, null, false);
      }
      if (currentParams.abp?.visible && charts.abpChart && !monitorElements.abp.classList.contains('d-none')) {
          charts.abpChart.update({ series: [buffers.sweepBufferABP] }, null, false);
      }
      if (currentParams.etco2?.visible && charts.etco2Chart && !monitorElements.etco2.classList.contains('d-none')) {
          charts.etco2Chart.update({ series: [buffers.sweepBufferETCO2] }, null, false);
      }
   } catch (chartError) {
      console.error("Error updating Chartist chart:", chartError);
   }
}

export function clearCharts(charts, buffers) {
    if(!charts) return;
    try{
        buffers.sweepBufferECG.fill(null);
        buffers.sweepBufferSpO2.fill(null);
        buffers.sweepBufferABP.fill(null);
        buffers.sweepBufferETCO2.fill(null);
        if(charts.ecgChart) charts.ecgChart.update({ series:[buffers.sweepBufferECG] }, null, false);
        if(charts.spo2Chart) charts.spo2Chart.update({ series:[buffers.sweepBufferSpO2] }, null, false);
        if(charts.abpChart) charts.abpChart.update({ series:[buffers.sweepBufferABP] }, null, false);
        if(charts.etco2Chart) charts.etco2Chart.update({ series:[buffers.sweepBufferETCO2] }, null, false);
        console.log("[clearCharts] Charts cleared.");
    }catch(e){ console.error("[clearCharts] Error clearing charts:",e); }
}