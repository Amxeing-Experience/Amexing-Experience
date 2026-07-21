/**
 * Entrada API Controller - CRUD de "Entradas" (boletos de acceso) por destino.
 *
 * Una Entrada es un producto simple ligado a un Destino (POI): nombre + precio.
 * El destino se toma del contexto (la ruta lleva :destinoId), por lo que el
 * formulario del front solo captura nombre y precio.
 *
 * Clase Parse: `Entrada` { destino (Pointer->POI), name, price, active, exists }.
 * Se crea automáticamente en el primer save (no requiere migración).
 *
 * Created by Denisse Maldonado.
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');

/**
 * Controlador de API para "Entradas" (boletos de acceso) ligadas a un destino (POI).
 * Expone el CRUD y el índice de búsqueda usados por la bandeja de Entradas del admin.
 */
class EntradaController {
  /**
   * GET /api/destinos/:destinoId/entradas
   * Lista las entradas activas (exists=true) de un destino, ordenadas por nombre.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async listByDestino(req, res) {
    try {
      const { destinoId } = req.params;
      if (!destinoId) {
        return res.status(400).json({ success: false, error: 'destinoId requerido' });
      }

      const destino = new Parse.Object('POI');
      destino.id = destinoId;

      const query = new Parse.Query('Entrada');
      query.equalTo('destino', destino);
      query.notEqualTo('exists', false);
      query.ascending('name');
      query.limit(1000);

      const entradas = await query.find({ useMasterKey: true });
      const data = entradas.map((e) => ({
        id: e.id,
        name: e.get('name') || '',
        price: typeof e.get('price') === 'number' ? e.get('price') : Number(e.get('price')) || 0,
        active: e.get('active') !== false,
      }));

      return res.json({ success: true, data });
    } catch (error) {
      logger.error('Error in EntradaController.listByDestino', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al obtener las entradas' });
    }
  }

  /**
   * GET /api/destinos/all-entradas
   * Índice ligero de todas las entradas activas con su destino, para búsqueda
   * global (permite que el buscador de destinos también encuentre por entrada).
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async listAll(req, res) {
    try {
      const query = new Parse.Query('Entrada');
      query.notEqualTo('exists', false);
      query.include('destino');
      query.ascending('name');
      query.limit(5000);

      const items = await query.find({ useMasterKey: true });
      const data = items
        .map((e) => {
          const destino = e.get('destino');
          return {
            id: e.id,
            name: e.get('name') || '',
            price: typeof e.get('price') === 'number' ? e.get('price') : Number(e.get('price')) || 0,
            destinoId: destino ? destino.id : null,
            destinoName: destino ? destino.get('name') || '' : '',
          };
        })
        .filter((x) => x.destinoId);

      return res.json({ success: true, data });
    } catch (error) {
      logger.error('Error in EntradaController.listAll', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al obtener el índice de entradas' });
    }
  }

  /**
   * POST /api/destinos/:destinoId/entradas
   * Crea una entrada para el destino. Body: { name, price }.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async create(req, res) {
    try {
      const { destinoId } = req.params;
      const { name, price } = req.body || {};

      const parsed = this.validateInput(name, price);
      if (parsed.error) {
        return res.status(400).json({ success: false, error: parsed.error });
      }

      // Verificar que el destino exista
      const destinoQuery = new Parse.Query('POI');
      const destino = await destinoQuery.get(destinoId, { useMasterKey: true }).catch(() => null);
      if (!destino) {
        return res.status(404).json({ success: false, error: 'Destino no encontrado' });
      }

      const entrada = new Parse.Object('Entrada');
      entrada.set('destino', destino);
      entrada.set('name', parsed.name);
      entrada.set('price', parsed.price);
      entrada.set('active', true);
      entrada.set('exists', true);

      await entrada.save(null, { useMasterKey: true });

      return res.status(201).json({
        success: true,
        data: {
          id: entrada.id, name: parsed.name, price: parsed.price, active: true,
        },
      });
    } catch (error) {
      logger.error('Error in EntradaController.create', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al crear la entrada' });
    }
  }

  /**
   * PUT /api/destinos/:destinoId/entradas/:id
   * Actualiza nombre y/o precio de una entrada. Body: { name, price }.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, price } = req.body || {};

      const parsed = this.validateInput(name, price);
      if (parsed.error) {
        return res.status(400).json({ success: false, error: parsed.error });
      }

      const query = new Parse.Query('Entrada');
      const entrada = await query.get(id, { useMasterKey: true }).catch(() => null);
      if (!entrada || entrada.get('exists') === false) {
        return res.status(404).json({ success: false, error: 'Entrada no encontrada' });
      }

      entrada.set('name', parsed.name);
      entrada.set('price', parsed.price);
      await entrada.save(null, { useMasterKey: true });

      return res.json({
        success: true,
        data: {
          id: entrada.id, name: parsed.name, price: parsed.price, active: entrada.get('active') !== false,
        },
      });
    } catch (error) {
      logger.error('Error in EntradaController.update', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al actualizar la entrada' });
    }
  }

  /**
   * DELETE /api/destinos/:destinoId/entradas/:id
   * Borrado lógico (exists=false).
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async remove(req, res) {
    try {
      const { id } = req.params;

      const query = new Parse.Query('Entrada');
      const entrada = await query.get(id, { useMasterKey: true }).catch(() => null);
      if (!entrada) {
        return res.status(404).json({ success: false, error: 'Entrada no encontrada' });
      }

      entrada.set('exists', false);
      entrada.set('active', false);
      await entrada.save(null, { useMasterKey: true });

      return res.json({ success: true });
    } catch (error) {
      logger.error('Error in EntradaController.remove', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al eliminar la entrada' });
    }
  }

  /**
   * Valida y normaliza nombre + precio.
   * @param {string} name - Nombre de la entrada.
   * @param {number|string} price - Precio.
   * @returns {{name?: string, price?: number, error?: string}}
   * @example
   */
  validateInput(name, price) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) return { error: 'El nombre es obligatorio' };
    if (cleanName.length > 280) return { error: 'El nombre es demasiado largo' };

    const numPrice = Number(price);
    if (!Number.isFinite(numPrice) || numPrice < 0) {
      return { error: 'El precio debe ser un número mayor o igual a 0' };
    }

    return { name: cleanName, price: Math.round(numPrice * 100) / 100 };
  }
}

module.exports = new EntradaController();
