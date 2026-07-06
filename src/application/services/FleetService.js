/**
 * FleetService - Datos de la flota pública agrupados por categoría (VehicleType).
 *
 * Pensado para el render server-side de la página pública /nuestra-flota. Obtiene los
 * vehículos ACTIVOS (misma fuente que el admin: Vehicle + VehicleType + VehicleImage con
 * variantes optimizadas) y los agrupa por su tipo de vehículo, resolviendo la presigned
 * URL de sus imágenes en el formato óptimo/compatible.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * const fleet = await new FleetService().getActiveFleetByCategory();
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');
const Rate = require('../../domain/models/Rate');
const VehicleImage = require('../../domain/models/VehicleImage');
const ImageOptimizationService = require('./ImageOptimizationService');

/**
 * FleetService class — lógica de lectura pública de la flota.
 */
class FleetService {
  constructor() {
    // Presigned URLs de imágenes de vehículos (carpeta S3 `vehicles/…`).
    this.imageService = new ImageOptimizationService({
      baseFolder: 'vehicles',
      isPublic: false,
      deletionStrategy: process.env.S3_DELETION_STRATEGY || 'move',
      presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
    });
  }

  /**
   * Resuelve la presigned URL de un registro VehicleImage, prefiriendo una variante
   * optimizada y ampliamente compatible (webp → jpeg → avif), luego el original, y por
   * último el archivo legacy. Devuelve null si no se puede resolver.
   * @param {Parse.Object} image - Registro VehicleImage.
   * @returns {Promise<string|null>} URL servible o null.
   * @example
   * const url = await service.resolveVehicleImageUrl(imageRecord);
   */
  async resolveVehicleImageUrl(image) {
    if (!image) {
      return null;
    }

    try {
      const keyFrom = (v) => (v && (v.s3Key || (typeof v === 'string' ? v : null))) || null;

      // 1) Variantes optimizadas (campo directo del registro)
      const variants = image.get('optimizedVariants');
      let s3Key = null;
      if (variants && typeof variants === 'object') {
        s3Key = ['webp', 'jpeg', 'avif'].map((fmt) => keyFrom(variants[fmt])).find(Boolean) || null;
      }

      // 2) Variantes en optimizationMetadata.formats (uploads antiguos)
      if (!s3Key) {
        const formats = image.get('optimizationMetadata')?.formats;
        if (formats && typeof formats === 'object') {
          s3Key = ['webp', 'jpeg', 'avif'].map((fmt) => keyFrom(formats[fmt])).find(Boolean) || null;
        }
      }

      // 3) Original
      if (!s3Key) {
        s3Key = image.get('s3Key') || null;
      }

      if (s3Key) {
        return await this.imageService.getPresignedUrl(s3Key);
      }

      // 4) Legacy Parse.File
      const imageFile = image.get('imageFile');
      if (imageFile && typeof imageFile.url === 'function') {
        return imageFile.url();
      }
    } catch (error) {
      logger.warn('Error resolving vehicle image url', { error: error.message });
    }

    return null;
  }

  /**
   * Arma los datos de UN vehículo para la vista pública (nombre, specs, imagen y galería).
   * @param {Parse.Object} vehicle - Registro Vehicle.
   * @returns {Promise<object>} Datos del vehículo.
   * @example
   * const v = await service.buildVehicleData(vehicleRecord);
   */
  async buildVehicleData(vehicle) {
    const brand = vehicle.get('brand') || '';
    const model = vehicle.get('model') || '';
    const name = `${brand} ${model}`.trim() || vehicle.get('vehicleId') || 'Vehículo';
    const year = vehicle.get('year');

    let gallery = [];
    try {
      const images = await VehicleImage.findByVehicle(vehicle.id);
      // Imagen primaria primero (si existe), luego el resto por displayOrder.
      const ordered = images.slice().sort((a, b) => (b.get('isPrimary') ? 1 : 0) - (a.get('isPrimary') ? 1 : 0));
      const urls = await Promise.all(ordered.map((img) => this.resolveVehicleImageUrl(img)));
      gallery = urls.filter(Boolean);
    } catch (error) {
      logger.warn('Error loading vehicle images for fleet', { vehicleId: vehicle.id, error: error.message });
    }

    // Las amenidades viven en el campo `amenities` (fallback a `features` por compatibilidad).
    const amenities = vehicle.get('amenities') || vehicle.get('features');
    // Tipo de vehículo (VehicleType) para mostrar en el pill del hero.
    const vehicleType = vehicle.get('vehicleTypeId');
    const type = vehicleType && typeof vehicleType.get === 'function' ? (vehicleType.get('name') || '') : '';

    return {
      id: vehicle.id,
      name,
      type,
      models: year ? String(year) : '',
      pax: vehicle.get('capacity') || null,
      carryOns: vehicle.get('luggageCapacity') || null,
      amenities: Array.isArray(amenities) ? amenities : [],
      image: gallery[0] || '',
      gallery,
    };
  }

  /**
   * Devuelve la flota ACTIVA agrupada por RATE (tarifa) — igual que el filtro por tarifa
   * del admin —, en el orden de las tarifas (por nombre). Solo incluye tarifas que tengan
   * al menos un vehículo activo.
   * @returns {Promise<Array<{code:string,label:string,color:string,vehicles:object[]}>>} Flota por tarifa.
   * @example
   * const fleet = await service.getActiveFleetByCategory();
   */
  async getActiveFleetByCategory() {
    try {
      const rates = await Rate.getActiveRates();
      if (!rates.length) {
        return [];
      }

      // Vehículos activos, con su tarifa incluida.
      const query = new Parse.Query('Vehicle');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.include('rateId');
      query.include('vehicleTypeId');
      query.ascending('brand');
      query.limit(1000);
      const vehicles = await query.find({ useMasterKey: true });
      if (!vehicles.length) {
        return [];
      }

      // Agrupa por id de tarifa.
      const byRate = new Map();
      await Promise.all(vehicles.map(async (vehicle) => {
        const rate = vehicle.get('rateId');
        if (!rate) {
          return;
        }
        const built = await this.buildVehicleData(vehicle);
        if (!byRate.has(rate.id)) {
          byRate.set(rate.id, []);
        }
        byRate.get(rate.id).push(built);
      }));

      // Construye las categorías en el orden de las tarifas; omite las vacías.
      return rates
        .filter((rate) => byRate.has(rate.id) && byRate.get(rate.id).length > 0)
        .map((rate) => ({
          code: rate.id,
          label: rate.get('name') || 'Tarifa',
          color: rate.get('color') || '#6366F1',
          vehicles: byRate.get(rate.id),
        }));
    } catch (error) {
      logger.error('Error building active fleet by rate', { error: error.message });
      return [];
    }
  }
}

module.exports = FleetService;
