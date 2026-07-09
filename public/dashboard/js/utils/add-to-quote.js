/*
 * Add to Quote — módulo genérico compartido (a-disposición, traslados, tours, experiencias…).
 *
 * Requiere en la página el partial del modal: organisms/quotes/add-to-quote-modal.ejs
 * (provee los ids atqModal / atqItemName / atqCreateNew / atqSearchInput / atqPickerLoading /
 *  atqPickerList / atqDaySelector / atqActionLoading).
 *
 * Uso desde cada superficie (solo aporta el payload y la etiqueta del ítem):
 *   AddToQuote.open({
 *     userRole: 'department_manager',
 *     serviceLabel: 'Servicio a disposición',   // para el mensaje de éxito
 *     itemLabel: '<strong>...</strong><br><span class="small">...</span>',
 *     buildSubconcept: () => ({ type: 'a-disposicion', ..., total: 9280 })  // debe incluir .total
 *   });
 *
 * No toca el quote-builder: solo consume /api/quotes (list/create) y /api/quotes/:id/service-items.
 * Created by Denisse Maldonado.
 */
(function () {
  'use strict';

  let opts = null; // opciones del open() actual
  let selectedQuote = null; // cotización seleccionada (para el selector de día)

  const el = (id) => document.getElementById(id);

  function getToken() {
    if (typeof window.getAccessToken === 'function') return window.getAccessToken();
    const sources = [
      () => localStorage.getItem('accessToken'),
      () => sessionStorage.getItem('accessToken'),
      () => document.querySelector('meta[name="access-token"]')?.content,
      () => { const m = document.cookie.match(/accessToken=([^;]+)/); return m ? m[1] : null; },
    ];
    for (const s of sources) { try { const t = s(); if (t) return t; } catch (e) { /* noop */ } }
    return '';
  }
  function headers(json) {
    const h = { Authorization: 'Bearer ' + getToken() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'hace un momento';
    if (mins < 60) return 'hace ' + mins + ' min';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return 'hace ' + hrs + (hrs === 1 ? ' hora' : ' horas');
    const days = Math.floor(hrs / 24);
    if (days < 30) return 'hace ' + days + (days === 1 ? ' día' : ' días');
    const months = Math.floor(days / 30);
    return 'hace ' + months + (months === 1 ? ' mes' : ' meses');
  }

  // Recalcula subtotal / IVA (16%) / total de un serviceItems.
  function recalc(si) {
    let subtotal = 0;
    si.days.forEach((day) => {
      let dt = 0;
      (day.subconcepts || []).forEach((sc) => { dt += (sc.total || 0); });
      day.dayTotal = Math.round(dt * 100) / 100;
      subtotal += dt;
    });
    si.subtotal = Math.round(subtotal * 100) / 100;
    si.iva = Math.round(subtotal * 0.16 * 100) / 100;
    si.total = Math.round((si.subtotal + si.iva) * 100) / 100;
    return si;
  }

  function alertMsg(type, msg) {
    document.querySelectorAll('.atq-alert').forEach((n) => n.remove());
    const wrapper = document.createElement('div');
    wrapper.className = 'atq-alert';
    wrapper.innerHTML = '<div class="alert alert-' + type + ' alert-dismissible fade show shadow-sm" role="alert">'
      + msg + '<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>';
    document.body.appendChild(wrapper);
    setTimeout(() => wrapper.remove(), 6000);
  }

  function successMsg(quoteId, folio) {
    const label = opts.serviceLabel || 'Servicio';
    return label + ' agregado a <strong>' + (folio || quoteId) + '</strong> '
      + '<a href="/dashboard/' + opts.userRole + '/quotes/' + quoteId + '?section=services" class="alert-link ms-2">Ver cotización</a>';
  }

  function hideModal() { bootstrap.Modal.getInstance(el('atqModal'))?.hide(); }

  // ── Abrir el modal para una superficie ──
  function open(options) {
    opts = options || {};
    selectedQuote = null;
    el('atqItemName').innerHTML = opts.itemLabel || '';

    el('atqPickerList').style.display = 'none';
    el('atqDaySelector').style.display = 'none';
    el('atqActionLoading').style.display = 'none';
    el('atqPickerLoading').style.display = 'block';
    el('atqSearchInput').style.display = '';
    el('atqSearchInput').value = '';
    el('atqCreateNew').style.display = '';

    new bootstrap.Modal(el('atqModal')).show();
    fetchQuotes();
  }

  function fetchQuotes() {
    // /api/quotes usa dateFilter='future' por default → el picker solo muestra
    // cotizaciones actuales o futuras (se avisa con un label en el modal).
    fetch('/api/quotes?start=0&length=100&order[0][column]=7&order[0][dir]=desc', { headers: headers() })
      .then((r) => r.json())
      .then((res) => {
        const quotes = (res.data || [])
          .filter((q) => q.status !== 'cancelled')
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        el('atqPickerLoading').style.display = 'none';
        el('atqPickerList').style.display = 'block';
        renderList(quotes);
      })
      .catch(() => {
        el('atqPickerLoading').style.display = 'none';
        el('atqPickerList').style.display = 'block';
        el('atqPickerList').innerHTML = '<div class="quote-picker-empty"><i class="ti ti-file-off me-2"></i>Error al cargar cotizaciones</div>';
      });
  }

  function renderList(quotes) {
    const container = el('atqPickerList');
    if (!quotes.length) {
      container.innerHTML = '<div class="quote-picker-empty"><i class="ti ti-file-off me-2"></i>No hay cotizaciones editables</div>';
      return;
    }
    container.innerHTML = quotes.map((q) => {
      const creatorName = q.createdByName || (q.createdBy ? q.createdBy.fullName : 'Sin asignar');
      const serviceCount = q.serviceCount || 0;
      const updated = timeAgo(q.updatedAt);
      return '<div class="quote-list-item" data-quote-id="' + (q.objectId || q.id) + '">'
        + '<div class="flex-grow-1">'
        + '<div class="quote-folio">' + (q.folio || q.objectId) + '</div>'
        + '<div class="quote-meta">' + serviceCount + ' servicios · ' + creatorName + (updated ? ' · ' + updated : '') + '</div>'
        + '</div>'
        + '<span class="quote-status status-' + q.status + '">' + q.status + '</span>'
        + '</div>';
    }).join('');
  }

  // ── Selector de día ──
  async function showDaySelector(quoteId) {
    el('atqPickerList').style.display = 'none';
    el('atqCreateNew').style.display = 'none';
    el('atqSearchInput').style.display = 'none';
    el('atqPickerLoading').style.display = 'block';
    const daySelector = el('atqDaySelector');
    daySelector.style.display = 'none';

    try {
      const quoteRes = await fetch('/api/quotes/' + quoteId, { headers: headers() });
      if (!quoteRes.ok) throw new Error('Error al obtener cotización');
      const quoteData = await quoteRes.json();
      const quote = quoteData.data || quoteData;
      selectedQuote = quote;
      const days = (quote.serviceItems && quote.serviceItems.days) || [];

      // 0 o 1 día → agregar directo
      if (days.length <= 1) {
        el('atqPickerLoading').style.display = 'none';
        if (days.length === 0) {
          if (!quote.serviceItems) quote.serviceItems = { days: [], subtotal: 0, iva: 0, total: 0 };
          quote.serviceItems.days = [{ dayNumber: 1, dayTitle: '', subconcepts: [], dayTotal: 0 }];
        }
        await addToDay(quoteId, 0);
        return;
      }

      // 2+ días → selector
      let html = '<div class="day-selector-back mb-3"><i class="ti ti-arrow-left me-1"></i>Volver a cotizaciones</div>';
      html += '<div class="quote-folio mb-3">' + quote.folio + ' — Seleccionar día</div>';
      html += days.map((day, idx) => {
        const scCount = (day.subconcepts || []).length;
        return '<div class="day-list-item" data-quote-id="' + quoteId + '" data-day-index="' + idx + '">'
          + '<div class="flex-grow-1">'
          + '<div class="day-title">Día ' + day.dayNumber + (day.dayTitle ? ' — ' + day.dayTitle : '') + '</div>'
          + '<div class="quote-meta">' + scCount + ' servicios</div>'
          + '</div>'
          + '</div>';
      }).join('');
      html += '<div class="new-day-date-row mt-2" data-quote-id="' + quoteId + '">'
        + '<label class="form-label small text-muted mb-1">Agregar nuevo día:</label>'
        + '<input type="date" class="form-control form-control-sm new-day-date-input" data-quote-id="' + quoteId + '">'
        + '</div>';
      daySelector.innerHTML = html;
      daySelector.style.display = 'block';
    } catch (error) {
      console.error('Error loading quote days:', error);
      alertMsg('danger', error.message);
      el('atqPickerList').style.display = 'block';
      el('atqCreateNew').style.display = '';
      el('atqSearchInput').style.display = '';
    } finally {
      el('atqPickerLoading').style.display = 'none';
    }
  }

  async function addToDay(quoteId, dayIndex) {
    const ds = el('atqDaySelector');
    if (ds) ds.style.display = 'none';
    el('atqActionLoading').style.display = 'block';
    try {
      const quote = selectedQuote;
      const si = quote.serviceItems || { days: [], subtotal: 0, iva: 0, total: 0 };
      si.days[dayIndex].subconcepts.push(opts.buildSubconcept());
      recalc(si);
      const r = await fetch('/api/quotes/' + quoteId + '/service-items', { method: 'PUT', headers: headers(true), body: JSON.stringify(si) });
      if (!r.ok) throw new Error((await r.json()).error || 'Error');
      hideModal();
      alertMsg('success', successMsg(quoteId, quote.folio));
    } catch (err) {
      alertMsg('danger', err.message);
      if (ds) ds.style.display = 'block';
      el('atqActionLoading').style.display = 'none';
    }
  }

  async function addToNewDay(quoteId, dayTitle) {
    const ds = el('atqDaySelector');
    if (ds) ds.style.display = 'none';
    el('atqActionLoading').style.display = 'block';
    try {
      const quote = selectedQuote;
      const si = quote.serviceItems || { days: [], subtotal: 0, iva: 0, total: 0 };
      if (!si.days) si.days = [];
      const sc = opts.buildSubconcept();
      si.days.push({ dayNumber: si.days.length + 1, dayTitle: dayTitle || '', subconcepts: [sc], dayTotal: sc.total });
      recalc(si);
      const r = await fetch('/api/quotes/' + quoteId + '/service-items', { method: 'PUT', headers: headers(true), body: JSON.stringify(si) });
      if (!r.ok) throw new Error((await r.json()).error || 'Error');
      hideModal();
      alertMsg('success', successMsg(quoteId, quote.folio));
    } catch (err) {
      alertMsg('danger', err.message);
      if (ds) ds.style.display = 'block';
      el('atqActionLoading').style.display = 'none';
    }
  }

  async function createNew() {
    el('atqPickerList').style.display = 'none';
    el('atqActionLoading').style.display = 'block';
    el('atqCreateNew').style.display = 'none';
    el('atqSearchInput').style.display = 'none';
    try {
      const createRes = await fetch('/api/quotes', { method: 'POST', headers: headers(true), body: JSON.stringify({ status: 'draft' }) });
      if (!createRes.ok) throw new Error((await createRes.json()).error || 'Error al crear cotización');
      const createData = await createRes.json();
      const quoteId = createData.data?.objectId || createData.data?.id || createData.objectId;
      const sc = opts.buildSubconcept();
      const si = {
        days: [{ dayNumber: 1, dayTitle: '', subconcepts: [sc], dayTotal: sc.total }],
        subtotal: Math.round(sc.total * 100) / 100,
        iva: Math.round(sc.total * 0.16 * 100) / 100,
        total: Math.round(sc.total * 1.16 * 100) / 100,
      };
      const r = await fetch('/api/quotes/' + quoteId + '/service-items', { method: 'PUT', headers: headers(true), body: JSON.stringify(si) });
      if (!r.ok) throw new Error((await r.json()).error || 'Error');
      hideModal();
      window.location.href = '/dashboard/' + opts.userRole + '/quotes/' + quoteId + '?section=services';
    } catch (err) {
      alertMsg('danger', err.message);
      el('atqPickerList').style.display = 'block';
      el('atqActionLoading').style.display = 'none';
      el('atqCreateNew').style.display = '';
      el('atqSearchInput').style.display = '';
    }
  }

  // ── Wiring de eventos (una sola vez) ──
  function init() {
    const modalEl = el('atqModal');
    if (!modalEl) return; // el partial no está en la página
    if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);

    el('atqSearchInput').addEventListener('input', function () {
      const q = this.value.toLowerCase();
      document.querySelectorAll('#atqPickerList .quote-list-item').forEach((item) => {
        item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });

    el('atqPickerList').addEventListener('click', function (e) {
      const item = e.target.closest('.quote-list-item');
      if (item) showDaySelector(item.dataset.quoteId);
    });

    el('atqDaySelector').addEventListener('click', function (e) {
      const dayItem = e.target.closest('.day-list-item');
      if (dayItem) { addToDay(dayItem.dataset.quoteId, parseInt(dayItem.dataset.dayIndex, 10)); return; }
      if (e.target.closest('.day-selector-back')) {
        el('atqDaySelector').style.display = 'none';
        el('atqPickerList').style.display = 'block';
        el('atqCreateNew').style.display = '';
        el('atqSearchInput').style.display = '';
      }
    });

    el('atqDaySelector').addEventListener('change', function (e) {
      if (e.target.classList.contains('new-day-date-input') && e.target.value) {
        const quoteId = e.target.dataset.quoteId;
        const d = new Date(e.target.value + 'T12:00:00');
        let dayTitle = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
        dayTitle = dayTitle.charAt(0).toUpperCase() + dayTitle.slice(1);
        addToNewDay(quoteId, dayTitle);
      }
    });

    el('atqCreateNew').addEventListener('click', createNew);

    modalEl.addEventListener('hidden.bs.modal', function () {
      el('atqDaySelector').style.display = 'none';
      el('atqActionLoading').style.display = 'none';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AddToQuote = { open };
})();
