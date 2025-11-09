# Production Scripts

Scripts diseñados para operar en ambientes de producción.

## ⚠️ ADVERTENCIA DE SEGURIDAD

Estos scripts están diseñados para **PRODUCCIÓN** y requieren:
- Confirmación manual obligatoria
- Variables de entorno configuradas correctamente
- Backup de base de datos antes de ejecutar
- Comprensión completa de lo que hacen

## 📋 Scripts Disponibles

### `nginx-amexing.conf`

Archivo de configuración de Nginx para producción con soporte para archivos grandes (hasta 250MB).

**Características:**
- ✅ Soporte para archivos de hasta 250MB
- ✅ Configuración SSL/TLS moderna
- ✅ Headers de seguridad
- ✅ Timeouts optimizados para cargas grandes
- ✅ Compresión y cache configurados
- ✅ Logs configurados

**Instalación:**

```bash
# 1. Copiar el archivo a sites-available
sudo cp scripts/production/nginx-amexing.conf /etc/nginx/sites-available/amexing

# 2. Editar y actualizar los valores
sudo nano /etc/nginx/sites-available/amexing
# - Reemplazar 'yourdomain.com' con tu dominio
# - Actualizar rutas de certificados SSL
# - Verificar el puerto de la aplicación (por defecto 1338)

# 3. Crear enlace simbólico
sudo ln -s /etc/nginx/sites-available/amexing /etc/nginx/sites-enabled/

# 4. Probar la configuración
sudo nginx -t

# 5. Recargar nginx
sudo systemctl reload nginx
```

**Verificación:**

```bash
# Verificar que nginx está corriendo
sudo systemctl status nginx

# Verificar los logs
sudo tail -f /var/log/nginx/amexing-error.log
sudo tail -f /var/log/nginx/amexing-access.log

# Probar la carga de archivos
curl -F "file=@test-file.jpg" https://tudominio.com/api/upload
```

### `init-production-database.js`

Inicializa una base de datos de producción **VACÍA** con los datos esenciales:

**Crea:**
- ✅ Sistema RBAC completo (7 roles: SuperAdmin, Admin, Manager, Employee, Client, Driver, Guest)
- ✅ Usuario SuperAdmin inicial
- ✅ Configuraciones básicas del sistema

**Características de Seguridad:**
- Solo funciona en bases de datos vacías (previene sobrescritura accidental)
- Requiere confirmación manual: `INITIALIZE PRODUCTION`
- Valida credenciales PCI DSS compliant
- Logs completos de auditoría
- Valida conexión antes de iniciar

## 🚀 Uso

### Paso 1: Configurar Variables de Entorno

Edita `environments/.env.production` y configura:

```bash
# PRODUCTION SUPERADMIN CONFIGURATION
PROD_SUPERADMIN_EMAIL=admin@tuempresa.com
PROD_SUPERADMIN_PASSWORD=TuPasswordSegura123!@#
PROD_SUPERADMIN_FIRSTNAME=Juan
PROD_SUPERADMIN_LASTNAME=Pérez
```

**Requisitos de Password (PCI DSS):**
- Mínimo 12 caracteres
- Al menos 1 mayúscula
- Al menos 1 minúscula
- Al menos 1 número
- Al menos 1 carácter especial

### Paso 2: Ejecutar Inicialización

```bash
# Asegúrate de estar en modo producción
NODE_ENV=production yarn db:init:prod
```

O directamente:

```bash
NODE_ENV=production node scripts/production/init-production-database.js
```

### Paso 3: Confirmar

Cuando se te solicite, escribe exactamente:

```
INITIALIZE PRODUCTION
```

### Paso 4: Verificar

El script mostrará un resumen de lo creado. Verifica que:

1. ✅ 7 roles del sistema fueron creados
2. ✅ SuperAdmin fue creado correctamente
3. ✅ Email del SuperAdmin es correcto

## 📊 Salida Esperada

```
============================================================
🚀 AmexingWeb Production Database Initialization
============================================================

============================================================
Validating Environment Configuration
============================================================
✅ Environment variables validated
ℹ️  Database: AmexingPROD
ℹ️  SuperAdmin: admin@tuempresa.com

============================================================
Initializing Parse Server Connection
============================================================
✅ Parse Server connection established

============================================================
Checking Database Status
============================================================
✅ Database appears to be empty

============================================================
Production Database Initialization
============================================================
⚠️  This will initialize the production database with:
ℹ️    - RBAC System (7 roles)
ℹ️    - SuperAdmin: admin@tuempresa.com
ℹ️    - Database: AmexingPROD
⚠️
This operation cannot be undone!

Type "INITIALIZE PRODUCTION" to confirm: INITIALIZE PRODUCTION

============================================================
Starting Initialization Process
============================================================

============================================================
Creating RBAC System
============================================================
ℹ️  Creating system roles...
✅ Created role: Super Administrator
✅ Created role: Administrator
✅ Created role: Department Manager
✅ Created role: Employee
✅ Created role: Client
✅ Created role: Driver
✅ Created role: Guest
✅ Created 7 system roles

============================================================
Creating SuperAdmin User
============================================================
✅ SuperAdmin created: admin@tuempresa.com
ℹ️  User ID: xxxxxxxxxxxxxx
ℹ️  Role: superadmin

============================================================
✅ Initialization Complete
============================================================
✅ Production database initialized successfully!

ℹ️  Next steps:
ℹ️    1. Test login with SuperAdmin credentials
ℹ️    2. Create additional users as needed
ℹ️    3. Configure OAuth providers
ℹ️    4. Review security settings
```

## ❌ Posibles Errores

### "Database is not empty!"

**Causa:** La base de datos ya contiene usuarios o roles.

**Solución:**
- Este script solo funciona en bases de datos completamente vacías
- Si necesitas re-inicializar, haz backup y limpia la base de datos primero
- NO ejecutes este script en producción con datos existentes

### "Missing required environment variables"

**Causa:** Variables de entorno no configuradas.

**Solución:**
- Verifica que `.env.production` esté configurado correctamente
- Asegúrate de que `NODE_ENV=production` esté establecido
- Revisa que todas las variables requeridas estén presentes

### "Password must be at least 12 characters"

**Causa:** Password no cumple con requisitos PCI DSS.

**Solución:**
- Usa un password de al menos 12 caracteres
- Incluye mayúsculas, minúsculas, números y caracteres especiales
- Ejemplo: `MySecure@Pass123!`

### "Failed to connect to Parse Server"

**Causa:** Problemas de conexión a Parse Server o MongoDB.

**Solución:**
- Verifica que el servidor esté corriendo
- Verifica `DATABASE_URI` en `.env.production`
- Verifica `PARSE_SERVER_URL` en `.env.production`
- Verifica credenciales de MongoDB

## 🔒 Seguridad

**IMPORTANTE:**

1. **NUNCA** compartas las credenciales del SuperAdmin
2. **CAMBIA** el password del SuperAdmin inmediatamente después de la primera autenticación
3. **DOCUMENTA** quién tiene acceso a las credenciales de SuperAdmin
4. **USA** autenticación de dos factores cuando esté disponible
5. **REVISA** los logs de auditoría regularmente

## 📝 Logs

Los logs de la inicialización se guardan en:
- Console output (stdout)
- Parse Server logs
- Audit trail en la base de datos

## 🆘 Soporte

Si encuentras problemas:

1. Revisa los logs completos
2. Verifica la configuración de ambiente
3. Consulta la documentación de Parse Server
4. Contacta al equipo de desarrollo

## ✅ Checklist Post-Inicialización

- [ ] Verificar que puedes hacer login con SuperAdmin
- [ ] Cambiar password de SuperAdmin
- [ ] Crear usuarios adicionales necesarios
- [ ] Configurar OAuth providers (si aplica)
- [ ] Configurar backup automatizado
- [ ] Documentar credenciales de forma segura
- [ ] Revisar configuraciones de seguridad
- [ ] Configurar monitoreo y alertas
- [ ] Revisar políticas de acceso
- [ ] Documentar procedimientos de emergencia
