# E2E (Playwright) — smoke tests

Pruebas de humo end-to-end con Playwright, **separadas de Jest** (Jest corre
`tests/integration` y `tests/unit`; Playwright corre `tests/e2e`).

Corren contra un servidor **ya levantado** (no lanzan el server) e inician sesión
con una cuenta **de prueba, NO productiva**.

## Requisitos
- Servidor corriendo (p. ej. `npm run dev`, normalmente en `http://localhost:1337`).
- Navegador de Playwright instalado: `npx playwright install chromium`.

## Variables de entorno
| Var | Default | Descripción |
|-----|---------|-------------|
| `E2E_BASE_URL` | `http://localhost:1337` | URL del server |
| `E2E_EMAIL` | — | Email de la cuenta de prueba |
| `E2E_PASSWORD` | — | Password de la cuenta de prueba |
| `E2E_QUOTE_ID` | — | Id de una cotización existente para abrir Servicios |
| `E2E_ROLE` | `admin` | `admin` \| `department_manager` \| `client` |

Si faltan `E2E_EMAIL`/`E2E_PASSWORD`/`E2E_QUOTE_ID`, el smoke se **salta** (skip).

## Correr
```bash
E2E_EMAIL="..." E2E_PASSWORD="..." E2E_QUOTE_ID="..." npm run test:e2e
```

## Qué valida `quote-services.smoke.spec.js`
El refactor que dividió `quote-services-v2.js` en dos archivos
(`quote-services-v2.js` + `quote-services-v2-module.js`). Al abrir la sección
Servicios de una cotización comprueba:
1. **Sin errores** de consola ni `pageerror` (un fallo de orden de carga saldría aquí).
2. `window.itineraryBuilder` existe (la clase se instancia bien).
3. Las funciones extraídas al archivo de módulo están disponibles
   (`window.checkRoundTripSpecificLocationFields`).
