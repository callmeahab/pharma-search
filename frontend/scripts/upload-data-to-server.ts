#!/usr/bin/env bun

import { readdir, stat } from 'node:fs/promises';
import { spawn } from 'child_process';
import path from 'path';

interface ServerConfig {
  host: string;
  user: string;
  port?: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

// Configuration - update these with your server details
const SERVER_CONFIG: ServerConfig = {
  host: '138.197.180.107',
  user: 'root',
  port: 22,
  dbName: 'pharma_search',
  dbUser: 'root',
  dbPassword: 'pharma_secure_password_2025'
};

async function findLatestSQLExport(): Promise<string | null> {
  const exportDir = '../exports';
  
  try {
    const files = await readdir(exportDir);
    const sqlFiles = files.filter(f => f.endsWith('.sql') && f.startsWith('scraped-data-'));
    
    if (sqlFiles.length === 0) {
      return null;
    }
    
    // Get file stats and sort by modification time
    const fileStats = await Promise.all(
      sqlFiles.map(async (file) => {
        const filePath = path.join(exportDir, file);
        const stats = await stat(filePath);
        return { file: filePath, mtime: stats.mtime };
      })
    );
    
    // Sort by modification time, newest first
    fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    
    return fileStats[0].file;
  } catch (error) {
    console.error('Error finding SQL exports:', error);
    return null;
  }
}

async function uploadSQLToServer(sqlFile: string): Promise<void> {
  console.log(`📤 Uploading ${sqlFile} to server...`);
  
  return new Promise((resolve, reject) => {
    const scpCommand = `scp -P ${SERVER_CONFIG.port} "${sqlFile}" ${SERVER_CONFIG.user}@${SERVER_CONFIG.host}:/tmp/scraped-data.sql`;
    
    console.log(`Running: ${scpCommand}`);
    
    const proc = spawn('scp', [
      '-P', SERVER_CONFIG.port?.toString() || '22',
      sqlFile,
      `${SERVER_CONFIG.user}@${SERVER_CONFIG.host}:/tmp/scraped-data.sql`
    ], {
      stdio: 'inherit'
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log('✅ File uploaded successfully');
        resolve();
      } else {
        reject(new Error(`SCP failed with code ${code}`));
      }
    });
    
    proc.on('error', reject);
  });
}

async function executeSQLOnServer(): Promise<void> {
  console.log('💾 Executing SQL on remote database...');
  
  return new Promise((resolve, reject) => {
    const sshCommand = [
      'ssh',
      '-p', SERVER_CONFIG.port?.toString() || '22',
      `${SERVER_CONFIG.user}@${SERVER_CONFIG.host}`,
      `PGPASSWORD="${SERVER_CONFIG.dbPassword}" psql -h localhost -U ${SERVER_CONFIG.dbUser} -d ${SERVER_CONFIG.dbName} -f /tmp/scraped-data.sql && rm /tmp/scraped-data.sql`
    ];
    
    console.log(`Running SSH command to execute SQL...`);
    
    const proc = spawn(sshCommand[0], sshCommand.slice(1), {
      stdio: 'inherit'
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log('✅ SQL executed successfully on server');
        resolve();
      } else {
        reject(new Error(`SSH command failed with code ${code}`));
      }
    });
    
    proc.on('error', reject);
  });
}

async function createBackupOnServer(): Promise<void> {
  console.log('💿 Creating backup on server before import...');
  
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, '');
    const backupCommand = `PGPASSWORD="${SERVER_CONFIG.dbPassword}" pg_dump -h localhost -U ${SERVER_CONFIG.dbUser} -d ${SERVER_CONFIG.dbName} > /root/backups/pre-import-${timestamp}.sql`;
    
    const sshCommand = [
      'ssh',
      '-p', SERVER_CONFIG.port?.toString() || '22',
      `${SERVER_CONFIG.user}@${SERVER_CONFIG.host}`,
      `mkdir -p /root/backups && ${backupCommand}`
    ];
    
    console.log('Creating server backup...');
    
    const proc = spawn(sshCommand[0], sshCommand.slice(1), {
      stdio: 'inherit'
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Server backup created successfully');
        resolve();
      } else {
        console.log('⚠️ Backup creation failed, continuing anyway...');
        resolve(); // Don't fail the whole process for backup issues
      }
    });
    
    proc.on('error', (error) => {
      console.log('⚠️ Backup creation error, continuing anyway...', error);
      resolve(); // Don't fail the whole process for backup issues
    });
  });
}

function validateConfig(): boolean {
  if (SERVER_CONFIG.host === 'YOUR_SERVER_IP') {
    console.error('❌ Please update SERVER_CONFIG with your actual server details');
    return false;
  }
  
  const requiredFields: (keyof ServerConfig)[] = ['host', 'user', 'dbName', 'dbUser', 'dbPassword'];
  for (const field of requiredFields) {
    if (!SERVER_CONFIG[field]) {
      console.error(`❌ Missing required config field: ${field}`);
      return false;
    }
  }
  
  return true;
}

async function main() {
  console.log('🚀 Starting data upload to server...\n');
  
  // Validate configuration
  if (!validateConfig()) {
    process.exit(1);
  }
  
  // Find the latest SQL export
  const sqlFile = await findLatestSQLExport();
  if (!sqlFile) {
    console.error('❌ No SQL export files found in ../exports/');
    console.log('💡 Run the local scraper first: bun scripts/run-scrapers-local.ts');
    process.exit(1);
  }
  
  console.log(`📁 Found SQL export: ${sqlFile}`);
  
  try {
    // Step 1: Upload SQL file to server
    await uploadSQLToServer(sqlFile);
    
    // Step 2: Execute SQL on server
    await executeSQLOnServer();
    
    console.log('\n🎉 Data upload completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('  1. Check the application to verify data was imported correctly');
    console.log('  2. Monitor server performance and logs');
    
  } catch (error) {
    console.error('\n❌ Upload failed:', error);
    console.log('\n🔧 Troubleshooting:');
    console.log('  1. Ensure you have SSH key access to the server');
    console.log('  2. Verify server IP and credentials in the script');
    console.log('  3. Check that PostgreSQL is running on the server');
    console.log('  4. Ensure the database and user exist on the server');
    process.exit(1);
  }
}

// Handle command line arguments
if (process.argv.length > 2) {
  const command = process.argv[2];
  if (command === '--help' || command === '-h') {
    console.log(`
📖 Data Upload Script Help

Usage: bun scripts/upload-data-to-server.ts [options]

Before using:
1. Update SERVER_CONFIG in the script with your server details
2. Ensure you have SSH key access to your server
3. Run the local scraper first to generate SQL exports

Options:
  --help, -h    Show this help message

The script will:
1. Find the latest SQL export from local scraping
2. Create a backup on the server (optional)
3. Upload the SQL file to the server
4. Execute it on the remote database
5. Clean up temporary files

Server Configuration (edit in script):
- host: Your server IP address
- user: SSH user (usually 'root')
- port: SSH port (usually 22)
- dbName: Database name ('pharma_search')
- dbUser: Database user ('root')
- dbPassword: Database password

Example workflow:
1. bun scripts/run-scrapers-local.ts
2. bun scripts/upload-data-to-server.ts
    `);
    process.exit(0);
  }
}

main().catch(console.error);