// ecgGenerators/avBlockGenerator.js
import { ensureFinite, gaussian, generateNoise } from '../waveformUtils.js';

// Apufunktio P-aallon generointiin (yksinkertaistettu PQRST:stä)
function generatePWave(t_relative_p, p_amp, p_duration) {
    if (p_amp === 0 || p_duration <= 1e-3 || t_relative_p < 0 || t_relative_p >= p_duration) {
        return 0;
    }
    const Bp = Math.PI / p_duration;
    let p_value = p_amp * Math.sin(Bp * t_relative_p);
    return p_value < 0 ? 0 : p_value; // Vain positiivinen osa
}

// Apufunktio QRS-T kompleksin generointiin (yksinkertaistettu PQRST:stä)
// pr_offset kertoo, milloin QRS alkaa suhteessa P-aallon *alkuun* tässä kutsussa
function generateQRST(t_relative_p, params, pr_offset) {
    let qrs_value = 0;
    let t_value = 0;

    const qrs_amp = params?.qrs_amp ?? 1.0;
    const t_amp = params?.t_amp ?? 0.25;
    const q_amp_factor = params?.q_amp_factor ?? 0.1;
    const s_amp_factor = params?.s_amp_factor ?? 0.15;
    const qrs_width = params?.qrs_width ?? 0.08;
    const t_width = params?.t_width ?? 0.07;
    // T-aallon offset lasketaan suhteessa QRS:n alkuun (pr_offset)
    const t_mean_offset_from_qrs_start = (params?.t_mean_offset ?? 0.25) - (params?.pr_interval ?? pr_offset);
    const hasT = params?.hasT ?? true;
    const st_elevation_amp = params?.st_elevation_amp ?? 0; // ST-muutoksia ei tässä yksinkertaisessa versiossa

    // QRS-kompleksi (aika suhteessa P-aallon alkuun)
    if (qrs_amp !== 0 && qrs_width > 0) {
        const Aq = qrs_amp * q_amp_factor;
        const Ar = qrs_amp;
        const As = qrs_amp * s_amp_factor;
        // QRS-osien ajoitus suhteessa P-aallon alkuun
        const tq = pr_offset + qrs_width * 0.1;
        const tr = pr_offset + qrs_width * 0.5;
        const ts = pr_offset + qrs_width * 0.9;
        const sigma_q = qrs_width / 6;
        const sigma_r = qrs_width / 5;
        const sigma_s = qrs_width / 5;

        qrs_value = gaussian(t_relative_p, tr, sigma_r, Ar) -
                    gaussian(t_relative_p, tq, sigma_q, Aq) -
                    gaussian(t_relative_p, ts, sigma_s, As);
    }

    // T-aalto (aika suhteessa P-aallon alkuun)
    let t_wave_start_time = Infinity;
    let t_wave_end_time = -Infinity;
    if (hasT && t_amp !== 0 && t_width > 0) {
        const t_duration = Math.max(0.1, 3.0 * t_width);
        const t_mean = pr_offset + t_mean_offset_from_qrs_start; // T-aallon keskikohta
        t_wave_start_time = t_mean - t_duration / 2;
        t_wave_end_time = t_wave_start_time + t_duration;

        if (t_relative_p >= t_wave_start_time && t_relative_p < t_wave_end_time) {
            const Bt = Math.PI / t_duration;
            const t_phase = Bt * (t_relative_p - t_wave_start_time);
            t_value = t_amp * Math.pow(Math.sin(t_phase), 2);
            if (t_amp > 0 && t_value < 0) t_value = 0;
            if (t_amp < 0 && t_value > 0) t_value = 0;
        }
    }

    // Tässä ei huomioida ST-segmenttiä erikseen
    return qrs_value + t_value;
}


/**
 * Generates a single point for AV Block ECG waveforms.
 * Requires state management from the caller (script.js).
 * @param {number} currentTime Absolute simulation time.
 * @param {object} params ECG rhythm parameters including blockType etc.
 * @param {object} state Current state { lastPTime, nextPTime, lastQRSTime, nextQRSTime, ... }
 * @returns {{value: number, state: object}} Calculated ECG value and the updated state object.
 */
export function generateAVBlock(currentTime, params, state) {
    const blockType = params.blockType;
    let currentValue = 0;
    const noise = generateNoise(params.noise_amp ?? 0.02);

    // --- Alusta tila, jos se on tyhjä (ensimmäinen kutsu tälle rytmille) ---
    if (!state || Object.keys(state).length === 0) {
        console.log("[AVB Gen] Initializing state for", blockType);
        state = {
            lastPTime: -Infinity,
            nextPTime: currentTime, // Ensimmäinen P-aalto heti
            lastQRSTime: -Infinity,
            nextQRSTime: currentTime, // Oletuksena QRS heti (säädetään alla)
            // Mobitz I (Wenckebach) specific state
            wenckebachCycleBeat: 0,
            currentPR: params.prIntervalStart ?? 0.16,
            // Mobitz II specific state
            pWaveCount: 0,
            conductedBeatCount: 0,
            nextEscapeBeatTime: Infinity, // Korvausrytmin aika
        };
        // 3. asteen blokille asetetaan seuraava QRS heti korvausrytmin tahtiin
        if (blockType === 'avb3') {
             const escapeRate = params.baseHR; // Kolmannessa asteessa baseHR on kammiotaajuus
             const escapeInterval = escapeRate > 0 ? 60.0 / escapeRate : Infinity;
             state.nextQRSTime = currentTime + escapeInterval * Math.random(); // Hieman satunnaisuutta alkuun
        }
         if (blockType === 'mobitz2' && params.escapeEnabled) {
             const escapeRate = params.escapeRate;
             const escapeInterval = escapeRate > 0 ? 60.0 / escapeRate : Infinity;
             state.nextEscapeBeatTime = currentTime + escapeInterval; // Ensimmäinen mahdollinen escape
         }
    }

    // --- Eteisaikataulu (P-aallot) ---
    const atrialRate = params.atrialRate ?? 70;
    const pInterval = atrialRate > 0 ? 60.0 / atrialRate : Infinity;
    const pDuration = (params.prIntervalStart ?? params.prIntervalFixed ?? 0.16) * 0.7; // Arvio P-aallon kestosta

    // Tarkista, onko aika generoida uusi P-aalto
    if (currentTime >= state.nextPTime && pInterval < Infinity) {
        state.lastPTime = state.nextPTime; // Päivitä viimeisin P-aallon *alkuaika*
        state.nextPTime += pInterval;      // Laske seuraavan P-aallon aika

        // Tilapäivitykset blokin tyypin mukaan *kun P-aalto tapahtuu*
        if (blockType === 'mobitz1') {
            state.wenckebachCycleBeat++;
            // Nollaa PR ja sykli, jos edellinen lyönti pudotettiin
             if (state.droppedLast) {
                 state.currentPR = params.prIntervalStart ?? 0.16;
                 state.wenckebachCycleBeat = 1; // Tämä P on uuden jakson ensimmäinen
                 state.droppedLast = false;
             }
        } else if (blockType === 'mobitz2') {
            state.pWaveCount++;
        }
        // Kolmannen asteen blokissa P-aalto ei vaikuta QRS-aikatauluun

        // Päätä, johtuuko TÄMÄ P-aalto (Mobitz I & II)
        let conductThisP = false;
        let currentPRForConduction = 0;

        if (blockType === 'mobitz1') {
             // Wenckebach: Pudotetaan jos sykli täynnä
             if (state.wenckebachCycleBeat >= (params.wenckebachRatioBeats ?? 4)) {
                 conductThisP = false;
                 state.droppedLast = true; // Merkitään että tämä P pudotettiin
                 console.log("Wenckebach drop at beat:", state.wenckebachCycleBeat);
             } else {
                 conductThisP = true;
                 currentPRForConduction = state.currentPR;
                 // Kasvata PR seuraavaa *johtunutta* lyöntiä varten
                 state.currentPR += params.prIncrement ?? 0.06;
             }
        } else if (blockType === 'mobitz2') {
            // Mobitz II: Johtuminen todennäköisyyden tai suhteen mukaan
            const probability = params.conductionProbability ?? 0.5;
            if (Math.random() < probability) {
                conductThisP = true;
                currentPRForConduction = params.prIntervalFixed ?? 0.18;
                state.conductedBeatCount++;
            } else {
                conductThisP = false;
            }
             console.log(`Mobitz II PWave: ${state.pWaveCount}, Conduct: ${conductThisP}`);
        }
        // Kolmannessa asteessa ei johdu koskaan
        // Ensimmäisen asteen blokin hoitaa pqrstGenerator

        // Jos P-aalto johtui, aseta seuraava QRS-aika
        if (conductThisP) {
            state.nextQRSTime = state.lastPTime + currentPRForConduction;
            // Nollaa mahdollinen escape-ajastin Mobitz II:ssa
            if (blockType === 'mobitz2' && params.escapeEnabled) {
                  const escapeRate = params.escapeRate;
                  const escapeInterval = escapeRate > 0 ? 60.0 / escapeRate : Infinity;
                  state.nextEscapeBeatTime = currentTime + escapeInterval * (1.5 + Math.random()); // Siirrä seuraavaa escapea kauemmas
            }
        }
    }

    // --- Kammi Aikataulu (QRS-aallot) ---
    let generateQRSNow = false;
    let qrsIsEscape = false;
    let prForThisQRS = 0; // PR-aika joka liittyy tähän QRS:ään (jos on)

    // 1. Tarkista johtuuko aikataulutettu QRS (Mobitz I & II)
    if ((blockType === 'mobitz1' || blockType === 'mobitz2') && currentTime >= state.nextQRSTime && state.nextQRSTime > state.lastQRSTime) {
         // Varmista että QRS ei tapahdu liian aikaisin P:n jälkeen (vältä duplikaatteja)
         if (state.nextQRSTime > state.lastPTime) {
             generateQRSNow = true;
             qrsIsEscape = false;
             // PR-aika on aika P:n alusta QRS:n alkuun
             prForThisQRS = state.nextQRSTime - state.lastPTime;
             state.lastQRSTime = state.nextQRSTime; // Päivitä viimeisin QRS-aika
             // Aseta nextQRSTime tulevaisuuteen estääksesi välittömän uudelleengeneroinnin
             state.nextQRSTime = Infinity;
             console.log("Conducted QRS generated at:", state.lastQRSTime.toFixed(3), "PR:", prForThisQRS.toFixed(3));

         } else {
              // QRS ajoittuisi P:n päälle tai ennen, siirretään sitä tai skipataan?
              // Yksinkertaisin on vain estää generointi tällä kierroksella
              state.nextQRSTime = Infinity; // Estä generointi tällä kertaa
         }
    }
    // 2. Tarkista 3. asteen blokin korvausrytmi
    else if (blockType === 'avb3' && currentTime >= state.nextQRSTime) {
        generateQRSNow = true;
        qrsIsEscape = true;
        prForThisQRS = 0; // Ei PR-aikaa
        state.lastQRSTime = state.nextQRSTime;
        // Laske seuraava escape-lyönti
        const escapeRate = params.baseHR;
        const escapeInterval = escapeRate > 0 ? 60.0 / escapeRate : Infinity;
        // Lisää hieman epäsäännöllisyyttä
        const irregularityFactor = 1.0 + ((params.irregular ?? 0.02) * (Math.random() - 0.5) * 2);
        state.nextQRSTime += escapeInterval * irregularityFactor;
         console.log("AVB3 Escape QRS generated at:", state.lastQRSTime.toFixed(3));

    }
    // 3. Tarkista Mobitz II korvausrytmi
     else if (blockType === 'mobitz2' && params.escapeEnabled && currentTime >= state.nextEscapeBeatTime) {
         // Generoidaan vain jos edellinen QRS oli riittävän kaukana
         if (currentTime > state.lastQRSTime + (60.0 / (params.atrialRate * 1.5))) { // Estää liian aikaiset escapet
             generateQRSNow = true;
             qrsIsEscape = true;
             prForThisQRS = 0;
             state.lastQRSTime = state.nextEscapeBeatTime;
             // Laske seuraava escape
             const escapeRate = params.escapeRate;
             const escapeInterval = escapeRate > 0 ? 60.0 / escapeRate : Infinity;
              const irregularityFactor = 1.0 + ((params.irregular ?? 0.02) * (Math.random() - 0.5) * 2);
             state.nextEscapeBeatTime += escapeInterval * irregularityFactor;
             console.log("Mobitz II Escape QRS generated at:", state.lastQRSTime.toFixed(3));
         } else {
             // Siirretään escapea hieman eteenpäin jos se olisi liian aikaisin
             state.nextEscapeBeatTime += 0.1;
         }
    }


    // --- Generoi aaltomuodot ajassa `currentTime` ---
    // Aika viimeisimmän P-aallon alusta
    const timeSinceLastP = currentTime - state.lastPTime;
    // Aika viimeisimmän QRS-aallon alusta
    const timeSinceLastQRS = currentTime - state.lastQRSTime;

    // 1. Generoi P-aalto, jos se on käynnissä
    if (timeSinceLastP >= 0 && timeSinceLastP < pDuration) {
        currentValue += generatePWave(timeSinceLastP, params.p_amp ?? 0.15, pDuration);
    }

    // 2. Generoi QRS-T, jos se on juuri nyt generoitava TAI se on vielä käynnissä
    let qrsDurationEstimate = (params.qrs_width ?? 0.08) + (params.t_width ?? 0.07) * 3; // Karkea arvio QRS+T kestosta

     if (generateQRSNow) {
         // Jos QRS generoidaan *juuri nyt*, käytä timeSinceLastP = 0 QRS-T:lle
         // ja välitä oikea PR-offset (jos johto), muuten 0 (jos escape)
         currentValue += generateQRST(0, params, qrsIsEscape ? 0 : prForThisQRS);
     } else if (state.lastQRSTime > -Infinity && timeSinceLastQRS >= 0 && timeSinceLastQRS < qrsDurationEstimate) {
          // Jos QRS on vielä käynnissä edelliseltä kerralta
         // Tarvitaan PR-aika, joka liittyi tähän VIIMEISIMPÄÄN QRS:ään. Tallennetaan se stateen?
         // Yksinkertaistus: Oletetaan että escapeilla ei ole PR:ää.
         const associatedPR = state.lastQRSwasEscape ? 0 : state.lastConductedPR;
         currentValue += generateQRST(timeSinceLastQRS, params, 0); // Aika suhteessa QRS:n alkuun, PR offset 0
     }

     // Tallenna tietoja stateen seuraavaa kutsua varten, jos QRS generoitiin nyt
      if(generateQRSNow) {
          state.lastQRSwasEscape = qrsIsEscape;
          state.lastConductedPR = qrsIsEscape ? 0 : prForThisQRS;
      }


    return { value: ensureFinite(currentValue + noise), state: state };
}