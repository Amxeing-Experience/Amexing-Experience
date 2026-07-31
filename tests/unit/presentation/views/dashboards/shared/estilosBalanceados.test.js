/**
 * Comentarios CSS sin cerrar en las plantillas y las hojas compartidas.
 *
 * Un `/*` sin su `*​/` se traga TODO el CSS que sigue hasta el próximo cierre. No rompe el render, no
 * rompe el parseo y ningún linter de JS lo ve: la página simplemente aparece sin estilos y parece un
 * problema de layout. Pasó de verdad — al extraer unas reglas de admin, el corte se llevó el cierre
 * del comentario y dejó su apertura, y con eso se apagaron el fondo, las versalitas y el tamaño de
 * letra del encabezado.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '../../../../../../src/presentation/views/dashboards');

const VISTAS = ['admin', 'client', 'department_manager', 'end_client'];
const HOJAS = ['serviceList.css', 'reservationHeader.css', 'reservationFinance.css'];

/**
 * Cuenta aperturas y cierres de comentario en un texto CSS.
 * @param {string} css - Contenido CSS.
 * @returns {object} `{ abre, cierra }`.
 * @example
 * contarComentarios('/* x *​/') // { abre: 1, cierra: 1 }
 */
const contarComentarios = (css) => ({
  abre: (css.match(/\/\*/g) || []).length,
  cierra: (css.match(/\*\//g) || []).length,
});

describe.each(VISTAS)('%s — bloques <style> de la plantilla', (vista) => {
  const html = fs.readFileSync(path.join(RAIZ, vista, 'booking-detail.ejs'), 'utf8');
  const bloques = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);

  it('tiene al menos un bloque de estilos', () => {
    expect(bloques.length).toBeGreaterThan(0);
  });

  it('ningún comentario queda sin cerrar', () => {
    bloques.forEach((b) => {
      const { abre, cierra } = contarComentarios(b);
      expect(abre).toBe(cierra);
    });
  });

  it('las llaves cierran todas', () => {
    bloques.forEach((b) => {
      expect((b.match(/\{/g) || []).length).toBe((b.match(/\}/g) || []).length);
    });
  });
});

describe.each(HOJAS)('%s — hoja compartida', (hoja) => {
  const css = fs.readFileSync(path.join(RAIZ, 'shared', hoja), 'utf8');

  it('ningún comentario queda sin cerrar', () => {
    const { abre, cierra } = contarComentarios(css);
    expect(abre).toBe(cierra);
  });

  it('las llaves cierran todas', () => {
    expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length);
  });
});
