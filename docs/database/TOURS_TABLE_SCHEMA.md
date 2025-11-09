# Tours Table Schema

## Parse Server Table: Tours

Esta tabla gestiona la información de tours disponibles en el sistema.

### Campos de la Tabla

| Campo | Tipo | Descripción | Requerido | Relación |
|-------|------|-------------|-----------|-----------|
| `destinationPOI` | Pointer | Punto de interés de destino | ✅ | POI table |
| `time` | Number | Duración del tour en minutos | ✅ | - |
| `vehicleType` | Pointer | Tipo de vehículo para el tour | ✅ | VehicleType table |
| `price` | Number | Precio del tour | ✅ | - |
| `rate` | Pointer | Tarifa aplicable al tour | ✅ | Rate table |
| `active` | Boolean | Estado activo/inactivo | ✅ | - |
| `exists` | Boolean | Existe/eliminado lógicamente | ✅ | - |

### Campos Automáticos de Parse Server
- `objectId` - ID único del registro
- `createdAt` - Fecha de creación
- `updatedAt` - Fecha de última actualización

### Vista en DataTable

Los headers en la tabla de gestión serán:

1. **Destino** - Obtenido de `destinationPOI.name`
2. **Tiempo (Hrs min)** - Obtenido de `time` (convertido de minutos a formato Hrs min)
3. **Tipo de Vehículo** - Obtenido de `vehicleType.name`
4. **Costo** - Obtenido de `price` (formato monetario)
5. **Tarifa** - Obtenido de `rate.name`

### Reglas de Negocio

- `active: true` - El tour está disponible para reservas
- `active: false` - El tour está deshabilitado temporalmente
- `exists: true` - El tour existe en el sistema
- `exists: false` - El tour ha sido eliminado lógicamente

### Relaciones

- **POI**: Cada tour debe tener un destino válido
- **VehicleType**: Cada tour debe especificar el tipo de vehículo
- **Rate**: Cada tour debe tener una tarifa asociada

### Ejemplo de Datos

```json
{
  "destinationPOI": {
    "__type": "Pointer",
    "className": "POI",
    "objectId": "poi123",
    "name": "Centro Histórico"
  },
  "time": 120,
  "vehicleType": {
    "__type": "Pointer", 
    "className": "VehicleType",
    "objectId": "vt456",
    "name": "Van"
  },
  "price": 1500.00,
  "rate": {
    "__type": "Pointer",
    "className": "Rate", 
    "objectId": "rate789",
    "name": "Tarifa Estándar"
  },
  "active": true,
  "exists": true
}
```