/**
 * ItineraryExport — los dos botones del itinerario en el panel de servicios.
 *
 * Lo que se prueba es lo que se rompió alguna vez: que las dos rutas sean distintas (ver ≠ descargar),
 * que el segmento no se descubra sin folio, y que recargar el detalle no acumule listeners.
 */

const ItineraryExport = require('../../../../../../src/presentation/views/dashboards/shared/itineraryExport');

/** Crea un elemento mínimo con lo que el módulo toca. */
const el = () => ({
  href: '',
  innerHTML: '',
  dataset: {},
  clicks: [],
  classList: {
    quitadas: [],
    remove(c) { this.quitadas.push(c); },
    add() {},
  },
  addEventListener(ev, fn) { this.clicks.push(fn); },
});

const montar = (conSegmento = true) => {
  const nodos = {
    exportItinerarySeg: conSegmento ? el() : null,
    previewItineraryBtn: el(),
    downloadItineraryBtn: el(),
  };
  global.document = { getElementById: (id) => nodos[id] || null };
  return nodos;
};

describe('wire', () => {
  it('apunta cada botón a SU ruta: ver y descargar no son la misma', () => {
    const n = montar();
    ItineraryExport.wire({ folio: 'MAY-2605-001' });
    expect(n.previewItineraryBtn.href).toBe('/reservations/MAY-2605-001/itinerary');
    expect(n.downloadItineraryBtn.href).toBe('/reservations/MAY-2605-001/pdf');
  });

  it('descubre el segmento, que nace oculto', () => {
    const n = montar();
    ItineraryExport.wire({ folio: 'MAY-2605-001' });
    expect(n.exportItinerarySeg.classList.quitadas).toContain('d-none');
  });

  it('sin folio no descubre nada: no hay documento al que apuntar', () => {
    const n = montar();
    expect(ItineraryExport.wire({ folio: '' })).toBe(false);
    expect(n.exportItinerarySeg.classList.quitadas).toEqual([]);
  });

  it('sin segmento en la página no falla: hay vistas que no lo tienen', () => {
    montar(false);
    expect(ItineraryExport.wire({ folio: 'MAY-2605-001' })).toBe(false);
  });

  it('recablear no acumula listeners: el detalle se recarga tras cada asignación', () => {
    const n = montar();
    ItineraryExport.wire({ folio: 'MAY-2605-001' });
    ItineraryExport.wire({ folio: 'MAY-2605-001' });
    ItineraryExport.wire({ folio: 'MAY-2605-001' });
    expect(n.downloadItineraryBtn.clicks).toHaveLength(1);
  });
});
