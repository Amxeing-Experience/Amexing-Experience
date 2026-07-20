#!/usr/bin/env node
/**
 * Smoke tests de la estandarización de `duration` a MINUTOS (experiencias regulares,
 * de proveedor/establecimiento y tours) + el picker amigable de tiempo.
 *
 * Sin servidor ni base de datos: (a) renderiza/compila las vistas EJS tocadas para detectar
 * errores de plantilla, (b) verifica el contrato de UI (picker en minutos, sin etiquetas "(hrs)"
 * en los inputs migrados), (c) prueba la lógica pura de formateo/conversión de duración y la
 * heurística del backfill (≤24 = horas → ×60).
 *
 * Uso: `node scripts/testing/smoke-duration.js`  (o `yarn test:smoke:duration`).
 * Sale con código 1 si algún check falla (apto para CI / pre-push).
 *
 * Created by Denisse Maldonado
 */
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const V = (p) => path.join(ROOT, 'src/presentation/views', p);
const P = (p) => path.join(ROOT, 'public', p);

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name); }
}
const read = (f) => fs.readFileSync(f, 'utf8');

// ------------------------------------------------------------------ A) Molécula del picker
console.log('\nA) advance-time-picker molecule (minutos)');
const MOL = V('molecules/forms/advance-time-picker.ejs');
const molSrc = read(MOL);
const pickerConfigs = [
  { name: 'experiencia duración', opts: { hiddenId: 'experienceDuration', hiddenName: 'duration', showDays: false, presets: [{ label: '1 h', minutes: 60 }, { label: '2 h', minutes: 120 }] } },
  { name: 'tour duración', opts: { hiddenId: 'tourDuration', showDays: false, presets: [{ label: '2 h', minutes: 120 }, { label: '4 h', minutes: 240 }] } },
  { name: 'tour anticipación (default presets)', opts: { hiddenId: 'tourAdvanceTime' } },
  { name: 'walking duración', opts: { hiddenId: 'walkingDuration', showDays: false, presets: [{ label: '1 h', minutes: 60 }] } },
];
for (const cfg of pickerConfigs) {
  let html = '';
  let ok = true;
  try { html = ejs.render(molSrc, cfg.opts, { filename: MOL }); } catch (e) { ok = false; html = 'ERR:' + e.message; }
  check(`${cfg.name}: renderiza sin error`, ok);
  check(`${cfg.name}: hidden #${cfg.opts.hiddenId} presente`, html.includes(`id="${cfg.opts.hiddenId}"`));
  check(`${cfg.name}: unidad = minutos`, html.includes('data-atp-unit="minutes"'));
}

// ------------------------------------------------------------------ B) EJS tocados compilan
console.log('\nB) Vistas tocadas compilan (sin error de plantilla)');
const views = [
  ['experience-detail', V('dashboards/admin/experience-detail.ejs')],
  ['experience-information', V('dashboards/admin/sections/experience-information.ejs')],
  ['experiences-table', V('organisms/datatable/experiences-table.ejs')],
  ['combined-experiences-cards', V('organisms/experiences/combined-experiences-cards.ejs')],
  ['tours-table', V('organisms/datatable/tours-table.ejs')],
  ['walking-tours-section', V('organisms/tours/walking-tours-section.ejs')],
];
for (const [name, file] of views) {
  let ok = true;
  try { ejs.compile(read(file), { filename: file }); } catch (e) { ok = false; console.log('     ' + e.message); }
  check(`${name}: ejs.compile OK`, ok);
}

// ------------------------------------------------------------------ C) Contrato de UI (fuente)
console.log('\nC) Contrato de fuente: inputs migrados a picker/minutos');
const detailSrc = read(V('dashboards/admin/experience-detail.ejs'));
check('experience-detail incluye el picker para duración', detailSrc.includes("hiddenId: 'experienceDuration'"));
check('experience-detail ya no tiene el input number de duración', !detailSrc.includes('id="experienceDuration" name="duration" min="0" step="0.5"'));
const toursSrc = read(V('organisms/datatable/tours-table.ejs'));
check('tours-table: duración con picker', toursSrc.includes("hiddenId: 'tourDuration'"));
check('tours-table: trayecto con picker', toursSrc.includes("hiddenId: 'tourTravelDuration'"));
check('tours-table: anticipación con picker', toursSrc.includes("hiddenId: 'tourAdvanceTime'"));
check('tours-table: carga el util del picker', toursSrc.includes('/dashboard/js/utils/advance-time-picker.js'));
check('tours-table: save ya no multiplica por 60 (vehicle)', !toursSrc.includes('Math.round(duration * 60)'));

// ------------------------------------------------------------------ D) Display en minutos
console.log('\nD) formatDuration ahora en MINUTOS');
const cardsSrc = read(V('organisms/experiences/combined-experiences-cards.ejs'));
check('combined-experiences-cards: formatDuration(minutes)', cardsSrc.includes('function formatDuration(minutes)'));
check('combined-experiences-cards: sin h*60', !/const totalMinutes = Math\.round\(h \* 60\)/.test(cardsSrc));

// PublicExperiencesService.formatDuration (no usa `this`, invocable sobre prototype)
try {
  const Svc = require(path.join(ROOT, 'src/application/services/PublicExperiencesService.js'));
  const fn = (Svc.prototype && Svc.prototype.formatDuration) || (Svc.default && Svc.default.prototype.formatDuration);
  check('PublicExperiencesService.formatDuration existe', typeof fn === 'function');
  if (typeof fn === 'function') {
    check('formatDuration(90) => "1 hr. 30 min."', fn.call({}, 90) === '1 hr. 30 min.');
    check('formatDuration(360) => "6 hrs."', fn.call({}, 360) === '6 hrs.');
    check('formatDuration(30) => "30 min."', fn.call({}, 30) === '30 min.');
    check('formatDuration(0) => "Por definir"', fn.call({}, 0) === 'Por definir');
  }
} catch (e) {
  check('PublicExperiencesService require OK', false);
  console.log('     ' + e.message);
}

// ------------------------------------------------------------------ E) Quote builder: bordes en horas
console.log('\nE) Quote builder: convierte catálogo (min) -> horas solo en los bordes');
const qb = read(P('dashboards/admin/sections/quote-services-v2.js'));
check('populate catálogo divide /60', qb.includes('experience.duration ? (experience.duration / 60)'));
check('_experienceCatalogDuration en horas (/60)', qb.includes('experience.duration ? (experience.duration / 60) : experience.duration'));
check('detalles usa formatMinutesToHoursAndMinutes', qb.includes('this.formatMinutesToHoursAndMinutes(experience.duration)'));
check('composer H/M sigue en horas (h + m/60)', qb.includes('const decimal = h + (m / 60)'));
const expSvc = read(P('dashboards/admin/sections/experience-services.js'));
check('experience-services: guía usa /60', expSvc.includes("document.getElementById('experienceDuration')?.value) / 60)"));
check('experience-services: listener en change', expSvc.includes("getElementById('experienceDuration')?.addEventListener('change'"));

// ------------------------------------------------------------------ F) Heurística del backfill
console.log('\nF) Heurística del backfill: ≤24 = horas (×60), >24 = ya minutos');
// Regla que usará el script de migración (idempotente por magnitud).
function backfillDuration(v) {
  if (v === null || v === undefined) return v;
  const n = Number(v);
  if (Number.isNaN(n) || n === 0) return v;
  return n <= 24 ? Math.round(n * 60) : n; // ≤24 horas -> minutos; el resto ya en minutos
}
const cases = [
  [1, 60], [1.5, 90], [2, 120], [2.5, 150], [3, 180], [5, 300], [6, 360], [8, 480], [0.5, 30],
  [60, 60], [120, 120], [122, 122], [183, 183], [300, 300], [1444, 1444],
];
for (const [input, expected] of cases) {
  check(`backfill(${input}) => ${expected}`, backfillDuration(input) === expected);
}
check('backfill(null) => null (idempotente sin valor)', backfillDuration(null) === null);
check('backfill(120) idempotente (ya minutos)', backfillDuration(backfillDuration(120)) === 120);

// ------------------------------------------------------------------ Resultado
console.log(`\n${fail === 0 ? '✅' : '❌'} smoke-duration: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
