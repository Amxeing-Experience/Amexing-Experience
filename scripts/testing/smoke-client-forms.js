#!/usr/bin/env node
/**
 * Smoke render tests de los formularios de alta/edición de cliente y agencia.
 *
 * Renderiza `dashboards/admin/client-detail.ejs` (server-side, sin servidor ni base de datos) para
 * agencia y las 4 categorías de cliente directo, más el modo alta, y verifica el contrato de UI:
 * formulario editable inline, prefill, perfiles de facturación, contraseña inline, ausencia de los
 * modales viejos, endpoints de submit por tipo y las secciones/acordeones esperados.
 *
 * Uso: `node scripts/testing/smoke-client-forms.js`  (o `yarn test:smoke:clients`).
 * Sale con código 1 si algún check falla (apto para CI / pre-push).
 *
 * Created by Denisse Maldonado
 */
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const DETAIL = path.join(__dirname, '../../src/presentation/views/dashboards/admin/client-detail.ejs');
const src = fs.readFileSync(DETAIL, 'utf8');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name); }
}

function renderDetail(client) {
  return ejs.render(src, {
    isNewClient: false, client, activeSection: 'information', subsection: null,
    userRole: 'admin', accessToken: 't', userId: 'admin1', userName: 'Admin',
  }, { filename: DETAIL });
}

const baseAddr = {
  streetType: 'Calle', streetName: 'Reforma', exteriorNumber: '10',
  colonia: 'Centro', city: 'CDMX', state: 'CDMX', postalCode: '06000',
};

const scenarios = [
  { key: 'AGENCIA (department_manager)', isAgency: true, client: {
    id: 'ag1', objectId: 'ag1', firstName: 'Dept', lastName: 'Manager', email: 'dm@abc.com',
    phone: '4431865241', active: true, roleName: 'department_manager', companyName: 'Abercrombie',
    website: 'https://abc.com', notes: 'nota agencia', birthDate: '1985-03-03', address: {},
    createdAt: '2026-01-01', updatedAt: '2026-02-01' } },
  { key: 'CLIENTE DIRECTO (direct_client)', category: 'direct_client', client: {
    id: 'c1', objectId: 'c1', firstName: 'Ana', lastName: 'López', email: 'ana@x.com', phone: '9991112233',
    active: true, roleName: 'end_client', isAmexingUser: true, clientCategory: 'direct_client',
    contactFirstName: 'Mar', contactLastName: 'Gómez', emergencyContactName: 'Luis', emergencyContactPhone: '9994445566',
    preferredLanguage: 'es', accessibilityRequirements: 'Silla de ruedas', allergies: ['Mariscos', 'Nueces'],
    dietaryRestrictions: ['Vegetariano'], birthDate: '1990-05-10', address: baseAddr,
    createdAt: '2026-01-01', updatedAt: '2026-02-01' } },
  { key: 'WEDDING PLANNER', category: 'wedding_planner', client: {
    id: 'c2', objectId: 'c2', firstName: 'Bea', lastName: 'Ruiz', email: 'bea@wp.com', phone: '9992223344',
    active: true, roleName: 'end_client', isAmexingUser: true, clientCategory: 'wedding_planner',
    allergies: [], dietaryRestrictions: [], birthDate: '', address: {}, createdAt: '2026-01-01' } },
  { key: 'CONCIERGE', category: 'concierge', client: {
    id: 'c3', objectId: 'c3', firstName: 'Caro', lastName: 'Díaz', email: 'caro@cc.com', phone: '',
    active: false, roleName: 'end_client', isAmexingUser: true, clientCategory: 'concierge',
    allergies: [], dietaryRestrictions: [], address: {}, createdAt: '2026-01-01' } },
  { key: 'HOME OWNER', category: 'home_owner', client: {
    id: 'c4', objectId: 'c4', firstName: 'Dan', lastName: 'Mora', email: 'dan@ho.com', phone: '9993334455',
    active: true, roleName: 'end_client', isAmexingUser: true, clientCategory: 'home_owner',
    allergies: [], dietaryRestrictions: [], address: {}, createdAt: '2026-01-01' } },
];

for (const sc of scenarios) {
  console.log('\n=== ' + sc.key + ' ===');
  let h;
  try { h = renderDetail(sc.client); check('render sin errores', true); } catch (e) {
    check('render sin errores', false); console.log('    ' + e.message.split('\n')[0]); continue;
  }

  check('form editable inline (#editClientForm)', h.includes('id="editClientForm"'));
  check('boton "Guardar cambios"', h.includes('Guardar cambios'));
  check('seccion Registro (solo lectura)', h.includes('Registro'));
  check('Perfiles de Facturacion (agregar)', h.includes('Nuevo Perfil de Facturación'));
  check('password inline (Acceso)', sc.isAgency ? h.includes('agencyPassword') : h.includes('directClientPassword'));
  check('nota "conservar la contraseña"', h.includes('conservar la contraseña actual'));
  check('SIN modal editar', !h.includes('id="editClientModal"'));
  check('SIN modal/boton Restablecer Contraseña', !h.includes('id="resetPasswordModal"') && !h.includes('Restablecer Contraseña'));
  check('barra de accion fija + cffForms', h.includes('edit-sticky') && h.includes('window.cffForms'));
  check('nombre prefilled', h.includes(sc.client.firstName));

  if (sc.isAgency) {
    check('form de AGENCIA (agencyCompanyName)', h.includes('agencyCompanyName'));
    check('empresa prefilled', h.includes(sc.client.companyName));
    check('NO renderiza radios del form cliente', !h.includes('id="directClientCatDirect"'));
    check('endpoint submit agencia (/api/clients/)', h.includes('/api/clients/${clientId}'));
  } else {
    check('form de CLIENTE (directClientFirstName)', h.includes('directClientFirstName'));
    check('segmented Tipo de Cliente (4 radios renderizados)', (h.match(/id="directClientCat(Direct|Wedding|Concierge|Home)"/g) || []).length === 4);
    check('categoria reflejada en prefill JSON', h.includes('"clientCategory":"' + sc.category + '"'));
    check('acordeon Empresa/direccion REMOVIDO', !h.includes('directClientStreetType') && !h.includes('Empresa y dirección'));
    check('acordeon Datos de contacto', h.includes('Datos de contacto'));
    check('acordeon Requerimientos', h.includes('Requerimientos'));
    check('endpoint submit cliente (/api/owned-clients/)', h.includes('/api/owned-clients/${clientId}'));
    check('email prefilled', h.includes(sc.client.email));
  }
}

console.log('\n=== ALTA (crear cliente/agencia) ===');
try {
  const nw = ejs.render(src, { isNewClient: true, client: {} }, { filename: DETAIL });
  check('render alta sin errores', true);
  check('tarjetas Agencia/Cliente', nw.includes('pageTypeAgency') && nw.includes('pageTypeClient'));
  check('form agencia (password requerido al crear)', nw.includes('agencyPassword'));
  check('form cliente (segmented)', nw.includes('directClientCategorySeg'));
  check('barra fija + submit dual + gather compartido', nw.includes('cff-sticky')
    && nw.includes('/api/clients') && nw.includes('/api/owned-clients')
    && nw.includes('cffForms.gatherAgency()') && nw.includes('cffForms.gatherClient()'));
} catch (e) { check('render alta sin errores', false); console.log('    ' + e.message.split('\n')[0]); }

console.log('\n========================================');
console.log('RESULTADO: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
