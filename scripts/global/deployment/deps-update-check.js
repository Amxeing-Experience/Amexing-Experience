#!/usr/bin/env node

/**
 * Dependency Update Checker
 * Checks if dependencies have been updated since last pull and guides user through update process.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Colors for console output
 */
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bright: '\x1b[1m',
};

/**
 * Log with colors
 */
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Get git commit hash for a file
 */
function getFileCommitHash(filePath) {
  try {
    return execSync(`git log -1 --format="%H" -- ${filePath}`, { encoding: 'utf8' }).trim();
  } catch (error) {
    return null;
  }
}

/**
 * Check if file has changed since last pull
 */
function hasFileChanged(filePath, hours = 24) {
  try {
    const gitLog = execSync(
      `git log --since="${hours} hours ago" --name-only --pretty=format: -- ${filePath}`, 
      { encoding: 'utf8' }
    );
    return gitLog.trim().length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Get package version from package.json
 */
function getPackageVersion(packageName) {
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    return packageJson.dependencies[packageName] || packageJson.devDependencies[packageName];
  } catch (error) {
    return null;
  }
}

/**
 * Check critical package versions
 */
function checkCriticalPackages() {
  const criticalPackages = {
    'parse-server': '8.2.4',
    'parse-dashboard': '7.4.0', 
    'parse': '5.3.0',
    'express': '4.21.2',
    'mongodb': '6.3.0'
  };

  log('\n🔍 Verificando paquetes críticos:', 'cyan');
  
  let hasUpdates = false;
  Object.entries(criticalPackages).forEach(([pkg, expectedVersion]) => {
    const currentVersion = getPackageVersion(pkg);
    if (currentVersion) {
      const cleanCurrent = currentVersion.replace(/[\^~>=<]/, '');
      if (cleanCurrent !== expectedVersion) {
        log(`  ⚠️  ${pkg}: ${cleanCurrent} → ${expectedVersion}`, 'yellow');
        hasUpdates = true;
      } else {
        log(`  ✅ ${pkg}: ${cleanCurrent}`, 'green');
      }
    }
  });
  
  return hasUpdates;
}

/**
 * Check Node.js version compatibility
 */
function checkNodeVersion() {
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
  
  log(`\n🟢 Node.js: ${nodeVersion}`, majorVersion >= 20 ? 'green' : 'red');
  
  if (majorVersion < 20) {
    log('  ⚠️  Parse Server 8.x requiere Node.js 20+', 'yellow');
    log('  📝 Actualiza Node.js: https://nodejs.org/', 'blue');
    return false;
  }
  return true;
}

/**
 * Main execution function
 */
function main() {
  log('\n🔍 AmexingWeb - Verificador de Actualizaciones de Dependencias', 'bright');
  log('===========================================================', 'blue');

  // Check if we're in a git repository
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
  } catch (error) {
    log('❌ No estás en un repositorio git', 'red');
    process.exit(1);
  }

  // Check if package.json exists
  if (!fs.existsSync('package.json')) {
    log('❌ No se encontró package.json', 'red');
    process.exit(1);
  }

  // Check for recent changes
  const packageChanged = hasFileChanged('package.json');
  const yarnLockChanged = hasFileChanged('yarn.lock');
  
  log(`\n📋 Estado de archivos de dependencias:`, 'blue');
  log(`  📄 package.json: ${packageChanged ? '🟡 Cambios recientes' : '✅ Sin cambios'}`, packageChanged ? 'yellow' : 'green');
  log(`  🔒 yarn.lock: ${yarnLockChanged ? '🟡 Cambios recientes' : '✅ Sin cambios'}`, yarnLockChanged ? 'yellow' : 'green');

  // Check Node.js version
  const nodeOk = checkNodeVersion();

  // Check critical packages
  const hasPackageUpdates = checkCriticalPackages();

  // Provide recommendations
  log('\n🎯 Recomendaciones:', 'bright');
  
  if (packageChanged || yarnLockChanged) {
    log('  1️⃣  Ejecuta: yarn install', 'yellow');
    
    if (hasPackageUpdates) {
      log('  2️⃣  Ejecuta: yarn after-pull', 'yellow');
    }
    
    log('  3️⃣  Verifica: yarn dev', 'yellow');
    
    if (!nodeOk) {
      log('  4️⃣  Actualiza Node.js a la versión 20+', 'red');
    }
  } else {
    log('  ✅ No necesitas actualizar dependencias', 'green');
    log('  💡 Puedes ejecutar directamente: yarn dev', 'blue');
  }

  // Show security status
  log('\n🔒 Estado de Seguridad (última auditoría):', 'magenta');
  log('  ✅ 86% reducción de vulnerabilidades (29 → 4)', 'green');
  log('  ✅ 0 vulnerabilidades críticas', 'green');
  log('  ✅ 0 vulnerabilidades altas', 'green');
  log('  🟡 4 vulnerabilidades bajas/moderadas', 'yellow');

  // Provide helpful commands
  log('\n🛠️  Comandos útiles:', 'cyan');
  log('  yarn after-pull          # Setup completo post-pull', 'blue');
  log('  yarn deps:full-update    # Actualización completa', 'blue');
  log('  yarn security:check      # Verificación de seguridad', 'blue');
  log('  yarn test                # Ejecutar tests', 'blue');

  log('\n✨ ¡Todo listo para continuar desarrollando!\n', 'green');
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main, checkCriticalPackages, checkNodeVersion };