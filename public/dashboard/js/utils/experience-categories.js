/**
 * ExperienceCategories - util cliente para consumir las categorías de experiencias
 * dinámicas (desde /api/experience-categories/active) y poblar selects/labels.
 *
 * Uso:
 *   await ExperienceCategories.fetch();
 *   ExperienceCategories.populateSelect(document.getElementById('experienceCategory'), valorActual);
 *   ExperienceCategories.labelFor('catas'); // → 'Catas'
 *
 * Created by Denisse Maldonado
 */
window.ExperienceCategories = (function () {
  let cache = null;
  let inflight = null;

  function getToken() {
    try {
      return (
        localStorage.getItem('accessToken') ||
        localStorage.getItem('authToken') ||
        localStorage.getItem('token') ||
        ''
      );
    } catch (e) {
      return '';
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * Trae (una sola vez, cacheado) las categorías activas.
   * @returns {Promise<Array>} Array de { code, name, name_en }.
   */
  function fetchActive() {
    if (cache) return Promise.resolve(cache);
    if (inflight) return inflight;

    const token = getToken();
    inflight = fetch('/api/experience-categories/active', {
      method: 'GET',
      credentials: 'include',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        cache = json && json.success && Array.isArray(json.data) ? json.data : [];
        return cache;
      })
      .catch(function (err) {
        console.error('ExperienceCategories: error cargando categorías', err);
        cache = [];
        return cache;
      })
      .finally(function () { inflight = null; });

    return inflight;
  }

  /**
   * Label (nombre) de una categoría por su code, desde la cache.
   * @param {string} code - Código de la categoría.
   * @returns {string} Nombre, o '' si no está.
   */
  function labelFor(code) {
    if (!code || !cache) return '';
    const found = cache.find(function (c) { return c.code === code; });
    return found ? found.name : '';
  }

  /**
   * Rellena un <select> con las categorías activas.
   * @param {HTMLSelectElement} selectEl - El select a poblar.
   * @param {string} [selectedValue] - Code a preseleccionar (se conserva aunque ya no esté activo).
   * @param {object} [opts] - { placeholder: string|null } (default 'Seleccionar'; null = sin placeholder).
   */
  function populateSelect(selectEl, selectedValue, opts) {
    if (!selectEl) return;
    opts = opts || {};
    const placeholder = opts.placeholder !== undefined ? opts.placeholder : 'Seleccionar';
    const list = cache || [];

    let html = '';
    if (placeholder !== null) {
      html += '<option value="">' + esc(placeholder) + '</option>';
    }

    let hasSelected = false;
    list.forEach(function (c) {
      const isSel = selectedValue && c.code === selectedValue;
      if (isSel) hasSelected = true;
      html += '<option value="' + esc(c.code) + '"' + (isSel ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    });

    // Conserva un valor guardado aunque su categoría ya no esté activa/exista.
    if (selectedValue && !hasSelected) {
      html += '<option value="' + esc(selectedValue) + '" selected>' + esc(labelFor(selectedValue) || selectedValue) + '</option>';
    }

    selectEl.innerHTML = html;
  }

  // Precarga en cuanto se carga el script (no bloquea; los consumidores igual hacen await fetch()).
  fetchActive();

  return {
    fetch: fetchActive,
    labelFor: labelFor,
    populateSelect: populateSelect,
    get data() { return cache || []; },
  };
})();
