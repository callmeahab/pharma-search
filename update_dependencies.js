#!/usr/bin/env node

/**
 * Script to update package.json files to remove Prisma and add PostgreSQL dependencies
 */

const fs = require('fs');
const path = require('path');

function updatePackageJson(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`⏭️  Skipping ${filePath} (doesn't exist)`);
    return false;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const pkg = JSON.parse(content);
    let changed = false;

    // Remove Prisma dependencies
    const prismaPackages = ['@prisma/client', 'prisma'];
    
    for (const section of ['dependencies', 'devDependencies']) {
      if (pkg[section]) {
        for (const prismaPackage of prismaPackages) {
          if (pkg[section][prismaPackage]) {
            delete pkg[section][prismaPackage];
            console.log(`  ❌ Removed ${prismaPackage} from ${section}`);
            changed = true;
          }
        }
      }
    }

    // Add PostgreSQL dependencies
    if (!pkg.dependencies) pkg.dependencies = {};
    
    const newDeps = {
      'pg': '^8.11.0',
    };

    const newDevDeps = {
      '@types/pg': '^8.10.0',
    };

    for (const [dep, version] of Object.entries(newDeps)) {
      if (!pkg.dependencies[dep] && !pkg.devDependencies?.[dep]) {
        pkg.dependencies[dep] = version;
        console.log(`  ✅ Added ${dep}@${version} to dependencies`);
        changed = true;
      }
    }

    if (!pkg.devDependencies) pkg.devDependencies = {};
    
    for (const [dep, version] of Object.entries(newDevDeps)) {
      if (!pkg.dependencies?.[dep] && !pkg.devDependencies[dep]) {
        pkg.devDependencies[dep] = version;
        console.log(`  ✅ Added ${dep}@${version} to devDependencies`);
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
      return true;
    }

    return false;
  } catch (error) {
    console.error(`❌ Error updating ${filePath}:`, error.message);
    return false;
  }
}

function main() {
  console.log('🔄 Updating package.json files to remove Prisma and add PostgreSQL...');
  console.log('=' * 60);

  const packagePaths = [
    'package.json',
    'frontend/package.json',
    'backend/package.json'
  ];

  let totalUpdated = 0;

  for (const packagePath of packagePaths) {
    console.log(`\n📝 Processing: ${packagePath}`);
    
    if (updatePackageJson(packagePath)) {
      console.log(`  ✅ Updated: ${packagePath}`);
      totalUpdated++;
    } else {
      console.log(`  ⏭️  No changes needed: ${packagePath}`);
    }
  }

  console.log('\n' + '=' * 60);
  console.log('📊 Summary:');
  console.log(`  Files updated: ${totalUpdated}`);
  console.log(`  Total files processed: ${packagePaths.length}`);
  
  if (totalUpdated > 0) {
    console.log('\n🚀 Next steps:');
    console.log('  1. Run: npm install (in each directory with updated package.json)');
    console.log('  2. Test scrapers: bun scrapers/apothecary.ts');
    console.log('  3. Run migration: ./migrate_from_prisma.bat');
  }
}

if (require.main === module) {
  main();
}