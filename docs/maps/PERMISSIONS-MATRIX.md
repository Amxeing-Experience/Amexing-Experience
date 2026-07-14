# Permissions Matrix - Role-Based Access Control (RBAC)

## Overview

This document provides a comprehensive matrix of all permissions across all roles in the Amexing Experience platform. This is part of the Phase 3 Advanced Mapping strategy for regression prevention.

## Table of Contents

- [1. Role Hierarchy](#1-role-hierarchy)
- [2. Permission Categories](#2-permission-categories) 
- [3. Complete Permissions Matrix](#3-complete-permissions-matrix)
- [4. Role-Specific Conditions](#4-role-specific-conditions)
- [5. Permission Scope Levels](#5-permission-scope-levels)
- [6. System Analysis](#6-system-analysis)

---

## 1. Role Hierarchy

```
SuperAdmin (Level 7) - System scope    [Red, shield-check]
    ↓
Admin (Level 6) - System scope         [Red, shield]  
    ↓
Client (Level 5) - Organization scope  [Green, building-office]
    ↓
Dept Manager (Level 4) - Department scope [Blue, user-group]
    ↓
Employee (Level 3) - Department scope  [Purple, user]
Employee Amexing (Level 3) - Operations [Orange, briefcase]
    ↓
Driver (Level 2) - Operations scope    [Yellow, truck]
    ↓
Guest (Level 1) - Public scope         [Gray, user-circle]
```

**Organization Types:**
- **Amexing**: Internal organization (SuperAdmin, Admin, Employee_Amexing, Driver)
- **Client**: Customer organizations (Client, Department_Manager, Employee)
- **External**: Public/guest access (Guest)

---

## 2. Permission Categories

| Category | Description | Resource Count |
|----------|-------------|----------------|
| **User Management** | User CRUD operations | 4 permissions |
| **Client Management** | Client organization management | 3 permissions |
| **Department Management** | Department operations | 3 permissions |
| **Booking Management** | Booking lifecycle | 5 permissions |
| **Service Management** | Service catalog | 3 permissions |
| **Pricing Management** | Pricing configuration | 2 permissions |
| **Reporting** | Report generation/viewing | 2 permissions |
| **Vehicle Management** | Vehicle operations (Amexing only) | 2 permissions |
| **Schedule Management** | Schedule operations | 2 permissions |
| **Route Management** | Route operations | 1 permission |
| **Request Management** | Service requests (Guest) | 1 permission |
| **Quote Management** | Quote viewing | 1 permission |
| **System Management** | System administration | 1 permission |

**Total System Permissions: 30**

---

## 3. Complete Permissions Matrix

### Legend
- ✅ **Granted**: Role has this permission
- 🔒 **Scope Limited**: Permission granted with scope/condition restrictions
- ❌ **Denied**: Role does not have this permission
- ⭐ **Wildcard**: SuperAdmin has ALL permissions (including future ones)

| Permission | SuperAdmin | Admin | Client | Dept Mgr | Employee | Emp Amexing | Driver | Guest |
|------------|------------|-------|---------|----------|----------|-------------|--------|-------|
| **User Management** |||||||||
| users.create | ⭐ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| users.read | ⭐ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| users.update | ⭐ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| users.delete | ⭐ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Client Management** |||||||||
| clients.create | ⭐ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| clients.read | ⭐ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| clients.update | ⭐ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Department Management** |||||||||
| departments.create | ⭐ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| departments.read | ⭐ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| departments.update | ⭐ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Booking Management** |||||||||
| bookings.create | ⭐ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| bookings.read | ⭐ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| bookings.update | ⭐ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| bookings.approve | ⭐ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| bookings.cancel | ⭐ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Service Management** |||||||||
| services.read | ⭐ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| services.create | ⭐ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| services.update | ⭐ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Pricing Management** |||||||||
| pricing.read | ⭐ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| pricing.update | ⭐ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Reporting** |||||||||
| reports.read | ⭐ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| reports.generate | ⭐ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Vehicle Management** |||||||||
| vehicles.read | ⭐ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| vehicles.update | ⭐ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Schedule Management** |||||||||
| schedules.read | ⭐ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| schedules.update | ⭐ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Route Management** |||||||||
| routes.read | ⭐ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Request Management** |||||||||
| requests.create | ⭐ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Quote Management** |||||||||
| quotes.read | ⭐ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **System Management** |||||||||
| system.admin | ⭐ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Permission Count by Role

| Role | Permission Count | Percentage |
|------|------------------|------------|
| SuperAdmin | ALL (30+) | 100% |
| Admin | 17 | 57% |
| Client | 16 | 53% |
| Department Manager | 10 | 33% |
| Employee | 6 | 20% |
| Employee Amexing | 9 | 30% |
| Driver | 0* | 0% |
| Guest | 3 | 10% |

*Driver role has permissions defined in role configuration but not in system permissions list.

---

## 4. Role-Specific Conditions

### SuperAdmin (Level 7)
```javascript
basePermissions: ['*'] // Wildcard - ALL permissions
delegatable: true
maxDelegationLevel: 6
```

### Admin (Level 6)
```javascript
basePermissions: [
  'profile.read', 'profile.update', 
  'users.read', 'users.create', 'users.update',
  'clients.read', 'clients.create', 'clients.update',
  'events.read', 'events.create', 'events.update', // Not in system perms
  'bookings.read', 'bookings.create', 'bookings.update', 'bookings.approve',
  'reports.read', 'reports.generate'
]
delegatable: true
maxDelegationLevel: 5
```

### Client (Level 5) 
```javascript
conditions: { organizationScope: 'own' } // Only within their organization
basePermissions: [
  'profile.read', 'profile.update',
  'users.read', 'users.create', 'users.update',
  'departments.read', 'departments.create', 'departments.update',
  'events.read', 'events.create', 'events.update', // Not in system perms
  'bookings.read', 'bookings.create', 'bookings.approve',
  'services.read', 'pricing.read'
]
delegatable: true
maxDelegationLevel: 4
```

### End Client / Cliente Directo (`end_client`)
Cliente final (no agencia). **Mismo acceso** (rol/rutas/vistas `dashboards/end_client/`), variando por su **tipo** (`clientCategory`) según el mapa de capacidades en `src/application/config/endClientCapabilities.js`.

| `clientCategory` | Cotizaciones | Crear/editar | Reservaciones | Tarifario (catálogo) | `catalogScope` |
|------------------|:--:|:--:|:--:|:--:|:--:|
| `direct_client` (Cliente directo) | ✓ | ✓ | ✓ | ✗ | `null` |
| `wedding_planner` | ✓ | ✓ | ✓ | ✓ | `popular` \* |
| `concierge` | ✓ | ✓ | ✓ | ✓ | `full` |
| `home_owner` | ✗ | ✗ | ✓ | ✓ | `popular` \* |

- Capacidades por tipo: `viewQuotes`, `createQuotes`, `viewTarifario`, `dashboardQuotes`, `catalogScope`.
- `catalogScope` (alcance de **Traslados**/destinos y **Experiencias**): `full` = todo · `popular` = solo populares · `null` = no aplica (no ve tarifario). **\*** El filtro de "populares" **aún no existe** (pendiente de construir); el flag ya está wireado.
- `clientCategory` viaja en el **JWT** y se expone a las vistas en `renderDashboard`. Gates en cliente (menú/botones) y **servidor** (`QuoteService.assertEndClientCanWrite`, `QuoteController.createQuote`, rutas con `requireEndClientCap`).

### Department Manager (Level 4)
```javascript
conditions: { 
  maxAmount: 10000, // Can approve up to $10,000 MXN
  departmentScope: 'own' // Only within their department
}
basePermissions: [
  'profile.read', 'profile.update',
  'users.read', 'users.update',
  'bookings.read', 'bookings.create', 'bookings.approve',
  'services.read', 'pricing.read', 'reports.read'
]
delegatable: true
maxDelegationLevel: 3
```

### Employee (Level 3)
```javascript
conditions: { 
  maxAmount: 2000, // Can self-approve up to $2,000 MXN
  businessHoursOnly: true,
  departmentScope: 'own'
}
basePermissions: [
  'profile.read', 'profile.update',
  'bookings.read', 'bookings.create',
  'services.read', 'pricing.read'
]
delegatable: false
```

### Employee Amexing (Level 3)
```javascript
conditions: { 
  operationsOnly: true, // No access to financial data
  scheduleScope: 'assigned' // Only assigned bookings/vehicles
}
basePermissions: [
  'profile.read', 'profile.update',
  'bookings.read', 'bookings.update',
  'vehicles.read', 'vehicles.update',
  'schedules.read', 'schedules.update',
  'routes.read'
]
delegatable: false
```

### Driver (Level 2)
```javascript
conditions: { 
  assignedOnly: true, // Only assigned trips and vehicles
  mobileAccess: true // Primarily mobile app access
}
basePermissions: [
  'profile.read', 'profile.update',
  'trips.read', 'trips.accept', 'trips.complete', 'trips.cancel', // Not in system perms
  'vehicles.read', 'routes.read',
  'location.update', 'earnings.read' // Not in system perms
]
delegatable: false
```

### Guest (Level 1)
```javascript
basePermissions: ['services.read', 'requests.create', 'quotes.read']
delegatable: false
```

---

## 5. Permission Scope Levels

### Scope Hierarchy
1. **own** - Only own records
2. **department** - Within user's department
3. **organization** - Within user's organization  
4. **system** - System-wide access

### Permission Scopes by Category

| Permission | Scope | Description |
|------------|--------|-------------|
| **User Management** |||
| users.create | organization | Create users within organization |
| users.read | department | View users in department |
| users.update | department | Update users in department |
| users.delete | organization | Deactivate users in organization |
| **Client Management** |||
| clients.create | system | Create any client organization |
| clients.read | organization | View client info within org |
| clients.update | organization | Update client info within org |
| **Department Management** |||
| departments.create | organization | Create depts within organization |
| departments.read | organization | View depts within organization |
| departments.update | department | Update own department |
| **Booking Management** |||
| bookings.create | department | Create bookings for department |
| bookings.read | department | View department bookings |
| bookings.update | department | Update department bookings |
| bookings.approve | department | Approve department bookings |
| bookings.cancel | department | Cancel department bookings |
| **Service Management** |||
| services.read | department | View available services |
| services.create | system | Create new services |
| services.update | system | Update service definitions |
| **Pricing Management** |||
| pricing.read | department | View pricing (with dept conditions) |
| pricing.update | organization | Update organizational pricing |
| **Reporting** |||
| reports.read | department | View department reports |
| reports.generate | organization | Generate organization reports |
| **Vehicle Management** |||
| vehicles.read | system | View vehicles (Amexing scope) |
| vehicles.update | own | Update own assigned vehicle |
| **Schedule Management** |||
| schedules.read | own | View own schedules |
| schedules.update | own | Update own schedules |
| **Route Management** |||
| routes.read | system | View route information |
| **Request/Quote Management** |||
| requests.create | own | Create own service requests |
| quotes.read | own | View own quotes |
| **System Management** |||
| system.admin | system | Full system administration |

---

## 6. System Analysis

### Key Findings

#### ✅ **Strengths**
- **Hierarchical Design**: Clear 7-level hierarchy with proper inheritance
- **Scope-Based Security**: Multi-level scoping (own → department → organization → system)
- **Contextual Conditions**: Amount limits, time restrictions, department scoping
- **Role Separation**: Clear separation between Amexing and Client organizations
- **Delegation Support**: Proper delegation capabilities with level limits

#### ⚠️ **Inconsistencies Detected**
1. **Missing System Permissions**: Some role permissions not defined in system permissions:
   - `profile.read`, `profile.update` (used by all authenticated roles)
   - `events.create`, `events.update`, `events.read` (Admin, Client roles)
   - `trips.*`, `location.*`, `earnings.*` (Driver role)

2. **Role-Permission Gaps**: 
   - Driver role has 0 system permissions despite complex base permissions
   - Some Admin permissions reference non-existent system permissions

#### 🔧 **Security Considerations**
- **Privilege Escalation Protection**: Proper level-based delegation limits
- **Data Isolation**: Organization and department scoping enforced
- **Financial Controls**: Amount-based approval limits
- **Time-Based Controls**: Business hours restrictions for certain operations
- **Audit Trail**: All permissions tracked with conditions

#### 📊 **Performance Impact**
- **Cache-Friendly**: Permission resolution designed for caching
- **Query Efficiency**: Scope-based filtering reduces data exposure
- **Role Hierarchy**: Efficient inheritance model

### Recommendations

1. **Sync Permission Definitions**: Align role base permissions with system permissions
2. **Complete Missing Permissions**: Define missing permissions in system permissions
3. **Test Coverage**: Ensure all permission combinations tested
4. **Documentation**: Keep this matrix updated as permissions evolve

---

## Implementation Notes

### Key Files to Review Before Permission Changes
- **Permission Model**: `/src/domain/models/Permission.js`
- **Role Model**: `/src/domain/models/Role.js`  
- **Permission Service**: `/src/services/PermissionService.js`
- **RBAC Seeds**: `/scripts/seeds/000-seed-rbac-*.js`
- **Integration Tests**: `/tests/integration/rbac/permission-system.integration.test.js`

### Testing Strategy
Before modifying permissions:
1. Run RBAC integration tests: `yarn test tests/integration/rbac/`
2. Verify role-permission assignments in seeds
3. Test permission resolution with PermissionService
4. Validate scope-based filtering
5. Check delegation capabilities

### Monitoring Points
**Critical Metrics to Watch:**
- Permission resolution performance
- Authorization success/failure rates  
- Role assignment distribution
- Delegation usage patterns
- Security violation attempts

---

*This document should be updated whenever permission definitions change. Last updated: May 2026*