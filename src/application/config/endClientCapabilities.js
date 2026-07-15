/**
 * Capacidades por tipo de cliente directo (rol end_client), según su clientCategory.
 * Todos los tipos comparten el mismo acceso (rol/rutas/vistas); esto define las variaciones:
 * - viewQuotes: ve el menú/lista de Cotizaciones.
 * - createQuotes: puede crear/editar/guardar/solicitar cotizaciones (si no, es solo lectura).
 * - viewTarifario: ve la sección Tarifario (catálogo + exportar). Todos menos cliente directo.
 * - dashboardQuotes: el dashboard de inicio incluye lo de Cotizaciones (segmentos Cotizado).
 * - catalogScope: alcance del catálogo de Traslados (destinos) y Experiencias. 'full' = todo;
 * 'popular' = solo destinos/experiencias populares; null = no aplica (no ve tarifario). NOTA: el
 * filtro de "populares" aún NO existe; se construirá más adelante y consumirá este flag
 * (wedding_planner y home_owner = 'popular'; concierge = 'full'; cliente directo = null).
 * Reservaciones y dashboard base los ven todos.
 * Created by Denisse Maldonado.
 */

const END_CLIENT_CAPABILITIES = {
  direct_client: {
    viewQuotes: true, createQuotes: true, viewTarifario: false, dashboardQuotes: true, catalogScope: null,
  },
  wedding_planner: {
    viewQuotes: true, createQuotes: true, viewTarifario: true, dashboardQuotes: true, catalogScope: 'popular',
  },
  concierge: {
    viewQuotes: true, createQuotes: true, viewTarifario: true, dashboardQuotes: true, catalogScope: 'full',
  },
  home_owner: {
    viewQuotes: false, createQuotes: false, viewTarifario: true, dashboardQuotes: false, catalogScope: 'popular',
  },
};

// Default seguro (categoría desconocida/nula): el más restrictivo que aún ve lo básico = cliente directo.
const DEFAULT_CAPABILITIES = END_CLIENT_CAPABILITIES.direct_client;

/**
 * Devuelve las capacidades para una clientCategory dada. Cae al default (cliente directo) si la
 * categoría no se reconoce.
 * @param {string} clientCategory - Direct_client | wedding_planner | concierge | home_owner.
 * @returns {object} Capacidades: viewQuotes, createQuotes, viewTarifario, dashboardQuotes (booleans)
 * y catalogScope ('full' | 'popular').
 * @example
 * const caps = getEndClientCapabilities('wedding_planner'); // caps.viewTarifario === true
 */
function getEndClientCapabilities(clientCategory) {
  if (clientCategory && Object.prototype.hasOwnProperty.call(END_CLIENT_CAPABILITIES, clientCategory)) {
    // eslint-disable-next-line security/detect-object-injection
    return END_CLIENT_CAPABILITIES[clientCategory];
  }
  return DEFAULT_CAPABILITIES;
}

module.exports = { getEndClientCapabilities, END_CLIENT_CAPABILITIES };
