/**
 * Botones del itinerario en el panel de servicios: verlo en pantalla y descargarlo en PDF.
 *
 * Los usan los cuatro detalles de reservación (admin, client, department_manager, end_client). Vivía
 * suelto en la plantilla de admin, y son ~50 líneas de las que casi todas existen por un solo motivo:
 * el PDF lo arma puppeteer y tarda varios segundos, así que hay que dar señal de progreso.
 * Created by Denisse Maldonado.
 */

const ItineraryExport = (() => {
  /**
   * Descarga el PDF por fetch en vez de dejar que el <a> navegue.
   *
   * Como navegación, la descarga no avisa cuándo empieza ni cuándo termina: el botón parecía muerto
   * los segundos que tarda puppeteer. Bajándolo por fetch se puede mostrar el progreso en el propio
   * botón. El archivo pesa alrededor de 1 MB, así que tenerlo un momento en memoria no es problema, y
   * el href se conserva para que el clic con el botón central o "abrir en pestaña nueva" siga sirviendo.
   * @param {HTMLElement} boton - El botón de descarga.
   * @param {string} folio - Folio de la reservación, que da nombre al archivo.
   * @param {Function} alFallar - Aviso al usuario cuando el PDF no se pudo generar.
   * @returns {Promise<void>}
   * @example
   * await descargar(btn, 'MAY-2605-001', (m) => alert(m));
   */
  async function descargar(boton, folio, alFallar) {
    if (boton.dataset.busy === '1') return;
    boton.dataset.busy = '1';
    const original = boton.innerHTML;
    boton.classList.add('is-busy');
    boton.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:.8rem;height:.8rem;border-width:.14em;"></span>Generando…';
    let blobUrl = '';
    try {
      const resp = await fetch(boton.href);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${folio}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      // El aviso al usuario dice qué hacer; la consola conserva el porqué, que es lo que sirve
      // cuando puppeteer falla en el servidor y el usuario solo reporta "no baja".
      console.error('PDF download failed:', err);
      alFallar('No se pudo generar el PDF. Intenta de nuevo.');
    } finally {
      boton.innerHTML = original;
      boton.classList.remove('is-busy');
      boton.dataset.busy = '';
      // Revocar de inmediato cancelaría la descarga en algunos navegadores, que leen el blob
      // después del click.
      if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    }
  }

  /**
   * Apunta los dos botones al folio y descubre el segmento.
   *
   * Las dos rutas son distintas y ambas hacen falta: /itinerary es la vista HTML, para revisarlo en
   * pantalla antes de mandarlo, y /itinerary/pdf es puppeteer sobre esa misma plantilla. Cada ruta de
   * PDF refleja la vista de su misma ruta base; /reservations/:folio/pdf es OTRO documento, la
   * confirmación. La de descarga NO
   * lleva target="_blank": al ser un adjunto, abriría una pestaña que se cierra sola y en algunos
   * navegadores parpadea. Sin folio no se descubre nada: no hay documento al que apuntar.
   * @param {object} opciones - Configuración.
   * @param {string} opciones.folio - Folio de la reservación, ya codificado para URL.
   * @param {Function} [opciones.alFallar] - Aviso al usuario si el PDF falla.
   * @param {string} [opciones.segId] - Id del contenedor del segmento.
   * @param {string} [opciones.previewId] - Id del botón de ver en pantalla.
   * @param {string} [opciones.downloadId] - Id del botón de descarga.
   * @returns {boolean} true si quedó cableado.
   * @example
   * ItineraryExport.wire({ folio: 'MAY-2605-001', alFallar: (m) => pmToast(m, 'warning') });
   */
  function wire(opciones) {
    const o = opciones || {};
    const seg = document.getElementById(o.segId || 'exportItinerarySeg');
    if (!seg || !o.folio) return false;

    const preview = document.getElementById(o.previewId || 'previewItineraryBtn');
    const dl = document.getElementById(o.downloadId || 'downloadItineraryBtn');
    if (preview) preview.href = `/reservations/${o.folio}/itinerary`;
    if (!dl) { seg.classList.remove('d-none'); return true; }

    dl.href = `/reservations/${o.folio}/itinerary/pdf`;
    seg.classList.remove('d-none');

    // El detalle se recarga tras cada asignación, y este cableo corre en cada recarga: sin la marca,
    // el mismo botón acumularía un listener por recarga y una descarga dispararía varias.
    if (!dl.dataset.bound) {
      dl.dataset.bound = '1';
      const alFallar = o.alFallar || (() => {});
      dl.addEventListener('click', (ev) => {
        ev.preventDefault();
        descargar(dl, o.folio, alFallar);
      });
    }
    return true;
  }

  /**
   * Cablea el botón flotante de descarga de las vistas públicas.
   *
   * Se descarga por fetch y no dejando navegar el <a> por lo mismo que el botón del detalle: armar el
   * PDF toma varios segundos y una descarga por navegación no avisa cuándo empieza ni cuándo termina,
   * así que el botón parecería muerto todo ese rato. El href se conserva para que "abrir en pestaña
   * nueva" siga funcionando.
   *
   * El ícono y el texto van en dos <span> separados para poder sustituir SOLO el ícono por el girito
   * y dejar la etiqueta contando qué pasa.
   * @param {object} opciones - `{ fabId, icoId, txtId, nombreArchivo, alFallar }`.
   * @returns {boolean} true si quedó cableado.
   * @example
   * ItineraryExport.wireFab({ fabId: 'pdfFab', nombreArchivo: 'MAY-2605-001.pdf' });
   */
  function wireFab(opciones) {
    const o = opciones || {};
    const fab = document.getElementById(o.fabId || 'pdfFab');
    if (!fab || fab.dataset.bound) return false;
    fab.dataset.bound = '1';

    const ico = document.getElementById(o.icoId || 'pdfFabIco');
    const txt = document.getElementById(o.txtId || 'pdfFabTxt');
    const alFallar = o.alFallar || ((msg) => { alert(msg); });

    fab.addEventListener('click', async (ev) => {
      if (fab.classList.contains('is-busy')) return;
      ev.preventDefault();
      const icoHtml = ico ? ico.innerHTML : '';
      const txtHtml = txt ? txt.innerHTML : '';
      fab.classList.add('is-busy');
      if (ico) ico.innerHTML = '<span class="pdf-fab-spin"></span>';
      if (txt) txt.textContent = 'Generando…';
      let blobUrl = '';
      try {
        const resp = await fetch(fab.href);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = o.nombreArchivo || 'documento.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) {
        console.error('PDF download failed:', err);
        alFallar('No se pudo generar el PDF. Intenta de nuevo.');
      } finally {
        fab.classList.remove('is-busy');
        if (ico) ico.innerHTML = icoHtml;
        if (txt) txt.innerHTML = txtHtml;
        // Revocar de inmediato cancela la descarga en navegadores que leen el blob tras el click.
        if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      }
    });
    return true;
  }

  return { wire, wireFab };
})();

// Node (Jest). En el navegador el IIFE de arriba ya dejó window.ItineraryExport.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ItineraryExport;
}
