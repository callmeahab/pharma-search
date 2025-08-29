#!/usr/bin/env python3
"""
Script to update all scrapers to work without Prisma
This script updates the import statements and wraps the main logic with database initialization
"""

import os
import re
import glob
from pathlib import Path

def update_scraper_file(file_path: str) -> bool:
    """Update a single scraper file to remove Prisma dependency"""
    
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original_content = content
    
    # Replace Prisma utils import
    content = re.sub(
        r"import\s*{\s*([^}]*)\s*}\s*from\s*['\"]\.\/helpers\/utils['\"];?",
        lambda m: f"import {{ {m.group(1)}, initializeDatabase, closeDatabase }} from './helpers/database';",
        content
    )
    
    # If the import wasn't found, add it
    if 'from \'./helpers/database\'' not in content and 'from "./helpers/database"' not in content:
        # Find existing imports from helpers
        helpers_import_match = re.search(r"import\s*{\s*([^}]*)\s*}\s*from\s*['\"]\.\/helpers\/utils['\"];?", original_content)
        if helpers_import_match:
            imports = helpers_import_match.group(1).strip()
            new_import = f"import {{ {imports}, initializeDatabase, closeDatabase }} from './helpers/database';"
            content = content.replace(helpers_import_match.group(0), new_import)
    
    # Find the main execution block (usually at the end)
    # Pattern 1: .then(async (allProducts) => { ... })
    then_pattern = re.search(
        r'(\w+\(\)\.then\(async\s*\([^)]*\)\s*=>\s*{[\s\S]*?}\);?)',
        content
    )
    
    if then_pattern:
        main_block = then_pattern.group(1)
        
        # Extract function call and callback content
        main_match = re.search(
            r'(\w+)\(\)\.then\(async\s*\(([^)]*)\)\s*=>\s*{([\s\S]*?)}\);?',
            main_block
        )
        
        if main_match:
            function_name = main_match.group(1)
            params = main_match.group(2)
            callback_content = main_match.group(3)
            
            # Create new main function
            new_main = f"""async function main() {{
  try {{
    // Initialize database connection
    await initializeDatabase();
    
    const {params} = await {function_name}();
    
{callback_content}  }} catch (error) {{
    console.error('Scraper failed:', error);
    process.exit(1);
  }} finally {{
    // Close database connection
    await closeDatabase();
  }}
}}

// Run the scraper
main();"""
            
            content = content.replace(main_block, new_main)
    
    # Pattern 2: Direct function call without .then()
    elif re.search(r'\w+\(\)\.catch\(console\.error\);?$', content.strip()):
        # Find the function call
        call_match = re.search(r'(\w+)\(\)\.catch\(console\.error\);?$', content.strip())
        if call_match:
            function_name = call_match.group(1)
            old_call = call_match.group(0)
            
            new_main = f"""async function main() {{
  try {{
    // Initialize database connection
    await initializeDatabase();
    
    await {function_name}();
  }} catch (error) {{
    console.error('Scraper failed:', error);
    process.exit(1);
  }} finally {{
    // Close database connection
    await closeDatabase();
  }}
}}

// Run the scraper
main();"""
            
            content = content.replace(old_call, new_main)
    
    # Check if file was actually changed
    if content != original_content:
        # Write updated content back to file
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    
    return False


def main():
    """Main function to update all scrapers"""
    
    scrapers_dir = Path(__file__).parent / 'frontend' / 'scrapers'
    
    if not scrapers_dir.exists():
        print(f"❌ Scrapers directory not found: {scrapers_dir}")
        return
    
    print("🔄 Updating scrapers to work without Prisma...")
    print("=" * 60)
    
    # Find all TypeScript files in the scrapers directory
    scraper_files = list(scrapers_dir.glob('*.ts'))
    scraper_files = [f for f in scraper_files if f.name != 'utils.ts']  # Skip utils.ts
    
    updated_count = 0
    error_count = 0
    
    for scraper_file in scraper_files:
        try:
            print(f"📝 Processing: {scraper_file.name}")
            
            if update_scraper_file(str(scraper_file)):
                print(f"  ✅ Updated: {scraper_file.name}")
                updated_count += 1
            else:
                print(f"  ⏭️  No changes needed: {scraper_file.name}")
                
        except Exception as e:
            print(f"  ❌ Error updating {scraper_file.name}: {e}")
            error_count += 1
    
    print("=" * 60)
    print(f"📊 Summary:")
    print(f"  Total files: {len(scraper_files)}")
    print(f"  Updated: {updated_count}")
    print(f"  No changes: {len(scraper_files) - updated_count - error_count}")
    print(f"  Errors: {error_count}")
    
    # Update the main utils.ts file
    utils_file = scrapers_dir / 'helpers' / 'utils.ts'
    utils_new_file = scrapers_dir / 'helpers' / 'utils_new.ts'
    
    if utils_new_file.exists():
        print(f"\n🔄 Updating utils.ts...")
        try:
            # Backup original utils.ts
            utils_backup = scrapers_dir / 'helpers' / 'utils_prisma.ts'
            if utils_file.exists():
                with open(utils_file, 'r') as f:
                    backup_content = f.read()
                with open(utils_backup, 'w') as f:
                    f.write(backup_content)
                print(f"  📦 Backed up original utils.ts to utils_prisma.ts")
            
            # Replace utils.ts with new version
            with open(utils_new_file, 'r') as f:
                new_utils_content = f.read()
            with open(utils_file, 'w') as f:
                f.write(new_utils_content)
                
            print(f"  ✅ Updated utils.ts with database version")
            
        except Exception as e:
            print(f"  ❌ Error updating utils.ts: {e}")
    
    print(f"\n🎉 Scraper migration complete!")
    print(f"📋 Next steps:")
    print(f"  1. Install dependencies: npm install pg @types/pg")
    print(f"  2. Test a scraper: bun scrapers/apothecary.ts")
    print(f"  3. Run migration script: ./migrate_from_prisma.bat")


if __name__ == "__main__":
    main()