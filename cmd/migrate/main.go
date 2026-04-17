package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	_ "github.com/lib/pq"
	pq "github.com/lib/pq"
)

const defaultDatabaseURL = "postgres://postgres:docker@localhost:5432/pharma_search?sslmode=disable"

var permanentIndexNames = []string{
	"idx_vendor_name",
	"idx_product_vendor",
	"idx_product_vendor_price",
	"idx_product_price",
	"idx_product_title_lower",
	"idx_product_title_trgm",
	"idx_product_extracted_brand",
	"idx_product_product_line",
	"idx_product_category",
	"idx_product_form",
	"idx_product_dosage_value",
	"idx_product_dosage_unit",
	"idx_product_volume_value",
	"idx_product_spf_value",
	"idx_product_core_identity",
	"idx_product_search_tokens",
	"idx_product_keyword_tags",
	"idx_product_normalized_lower",
	"idx_product_normalized_trgm",
	"idx_product_processed",
	"idx_product_unprocessed",
}

type migrationRecord struct {
	Checksum string
	Kind     string
}

type probeResult struct {
	Applied bool
	Partial bool
	Details string
}

func main() {
	repoFlag := flag.String("repo", "", "Path to the pharma-search repository root")
	dbURLFlag := flag.String("database-url", "", "PostgreSQL connection string to use")
	seedVendorsFlag := flag.Bool("seed-vendors", true, "Also run migrations/seed/vendors.sql after schema migrations")
	flag.Parse()

	repoRoot, err := resolveRepoRoot(*repoFlag)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to resolve repo root: %v\n", err)
		os.Exit(1)
	}

	loadEnvFile(filepath.Join(repoRoot, ".env"))
	dbURL := resolveDatabaseURL(*dbURLFlag)

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open database connection: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	ctx := context.Background()
	if err := db.PingContext(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "failed to connect to database: %v\n", err)
		os.Exit(1)
	}

	migrationsDir := filepath.Join(repoRoot, "migrations")
	migrationPaths, err := listMigrationFiles(migrationsDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to list migrations: %v\n", err)
		os.Exit(1)
	}

	if err := ensureMigrationHistoryTable(ctx, db); err != nil {
		fmt.Fprintf(os.Stderr, "failed to ensure schema_migrations table: %v\n", err)
		os.Exit(1)
	}

	history, err := loadMigrationHistory(ctx, db)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load migration history: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Running SQL migrations from %s\n", migrationsDir)

	appliedCount := 0
	baselinedCount := 0
	skippedCount := 0

	for _, migrationPath := range migrationPaths {
		status, err := applyMigration(ctx, db, migrationPath, history)
		if err != nil {
			fmt.Fprintf(os.Stderr, "migration failed for %s: %v\n", filepath.Base(migrationPath), err)
			os.Exit(1)
		}

		switch status {
		case "applied":
			appliedCount++
		case "baselined":
			baselinedCount++
		case "skipped":
			skippedCount++
		}
	}

	if *seedVendorsFlag {
		if err := runVendorSeed(ctx, db, filepath.Join(migrationsDir, "seed", "vendors.sql")); err != nil {
			fmt.Fprintf(os.Stderr, "failed to seed vendors: %v\n", err)
			os.Exit(1)
		}
	}

	fmt.Println()
	fmt.Println("=== Migration Complete ===")
	fmt.Printf("Applied: %d\n", appliedCount)
	fmt.Printf("Baselined: %d\n", baselinedCount)
	fmt.Printf("Already recorded: %d\n", skippedCount)
	if *seedVendorsFlag {
		fmt.Println("Vendor seed: synced")
	}
}

func applyMigration(ctx context.Context, db *sql.DB, migrationPath string, history map[string]migrationRecord) (string, error) {
	name := filepath.Base(migrationPath)
	checksum, err := migrationChecksum(migrationPath)
	if err != nil {
		return "", err
	}

	if record, ok := history[name]; ok {
		if record.Checksum != checksum {
			return "", fmt.Errorf("migration checksum changed after it was recorded (%s was previously %s, now %s); create a new migration file instead", name, record.Checksum, checksum)
		}

		fmt.Printf("Skipping %s (%s)\n", name, record.Kind)
		return "skipped", nil
	}

	probe, err := probeMigrationState(ctx, db, name)
	if err != nil {
		return "", err
	}
	if probe.Partial {
		return "", fmt.Errorf("database is in a partial state for %s: %s", name, probe.Details)
	}
	if probe.Applied {
		if err := recordMigration(ctx, db, name, checksum, "baselined"); err != nil {
			return "", err
		}

		history[name] = migrationRecord{Checksum: checksum, Kind: "baselined"}
		fmt.Printf("Baselined %s (%s)\n", name, probe.Details)
		return "baselined", nil
	}

	if name == "005_views.sql" {
		if err := recordMigration(ctx, db, name, checksum, "noop"); err != nil {
			return "", err
		}

		history[name] = migrationRecord{Checksum: checksum, Kind: "noop"}
		fmt.Printf("Recorded %s (no executable statements)\n", name)
		return "applied", nil
	}

	if err := executeSQLFile(ctx, db, migrationPath, name, checksum, "applied"); err != nil {
		return "", err
	}

	history[name] = migrationRecord{Checksum: checksum, Kind: "applied"}
	fmt.Printf("Applied %s\n", name)
	return "applied", nil
}

func runVendorSeed(ctx context.Context, db *sql.DB, seedPath string) error {
	if _, err := os.Stat(seedPath); err != nil {
		return fmt.Errorf("vendor seed file missing: %w", err)
	}

	if !tableExists(ctx, db, `public."Vendor"`) {
		return errors.New(`public."Vendor" does not exist yet; run schema migrations first`)
	}

	seedSQL, err := readSQLFile(seedPath)
	if err != nil {
		return err
	}

	if _, err := db.ExecContext(ctx, seedSQL); err != nil {
		return fmt.Errorf("executing vendor seed: %w", err)
	}

	var vendorCount int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM public."Vendor"`).Scan(&vendorCount); err != nil {
		return fmt.Errorf("counting vendors after seed: %w", err)
	}

	fmt.Printf("Seeded vendors (%d rows present)\n", vendorCount)
	return nil
}

func probeMigrationState(ctx context.Context, db *sql.DB, name string) (probeResult, error) {
	switch name {
	case "001_base_schema.sql":
		vendorExists := tableExists(ctx, db, `public."Vendor"`)
		productExists := tableExists(ctx, db, `public."Product"`)

		switch {
		case !vendorExists && !productExists:
			return probeResult{}, nil
		case vendorExists && productExists:
			return probeResult{Applied: true, Details: `public."Vendor" and public."Product" already exist`}, nil
		default:
			return probeResult{Partial: true, Details: `expected both public."Vendor" and public."Product" to either exist or be absent`}, nil
		}

	case "003_indexes.sql":
		var permanentIndexCount int
		if err := db.QueryRowContext(ctx, `
			SELECT COUNT(*)
			FROM pg_indexes
			WHERE schemaname = 'public'
			  AND indexname = ANY($1)
		`, pq.Array(permanentIndexNames)).Scan(&permanentIndexCount); err != nil {
			return probeResult{}, fmt.Errorf("checking index state: %w", err)
		}

		computedGroupColumnExists := columnExists(ctx, db, "Product", "computedGroupId")
		computedGroupIndexExists := indexExists(ctx, db, "idx_product_computed_group")

		switch {
		case permanentIndexCount == 0 && computedGroupColumnExists && !computedGroupIndexExists:
			return probeResult{}, nil
		case permanentIndexCount == len(permanentIndexNames) && computedGroupColumnExists && computedGroupIndexExists:
			return probeResult{Applied: true, Details: "all indexes from 003_indexes.sql already exist"}, nil
		case permanentIndexCount == len(permanentIndexNames) && !computedGroupColumnExists && !computedGroupIndexExists:
			return probeResult{Applied: true, Details: "latest schema already includes the post-007 index state"}, nil
		default:
			return probeResult{
				Partial: true,
				Details: fmt.Sprintf("found %d/%d permanent indexes, computedGroupId column present=%t, idx_product_computed_group present=%t",
					permanentIndexCount, len(permanentIndexNames), computedGroupColumnExists, computedGroupIndexExists),
			}, nil
		}

	case "005_views.sql":
		return probeResult{Applied: true, Details: "migration file is currently a no-op"}, nil

	case "006_product_standardization.sql":
		table := tableExists(ctx, db, `public."ProductStandardization"`)
		function := functionExists(ctx, db, "lookup_standardization")

		switch {
		case !table && !function:
			return probeResult{}, nil
		case table && function:
			return probeResult{Applied: true, Details: `public."ProductStandardization" and lookup_standardization() already exist`}, nil
		default:
			return probeResult{Partial: true, Details: `expected ProductStandardization table and lookup_standardization() function to appear together`}, nil
		}

	case "007_drop_computed_group_id.sql":
		column := columnExists(ctx, db, "Product", "computedGroupId")
		index := indexExists(ctx, db, "idx_product_computed_group")

		switch {
		case !column && !index:
			return probeResult{Applied: true, Details: `computedGroupId and idx_product_computed_group are already absent`}, nil
		case column && index:
			return probeResult{}, nil
		default:
			return probeResult{Partial: true, Details: `expected computedGroupId column and idx_product_computed_group to either both exist or both be absent`}, nil
		}
	}

	return probeResult{}, nil
}

func ensureMigrationHistoryTable(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS public.schema_migrations (
			name text PRIMARY KEY,
			checksum text NOT NULL,
			kind text NOT NULL,
			applied_at timestamptz NOT NULL DEFAULT NOW()
		)
	`)
	return err
}

func loadMigrationHistory(ctx context.Context, db *sql.DB) (map[string]migrationRecord, error) {
	rows, err := db.QueryContext(ctx, `SELECT name, checksum, kind FROM public.schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	history := make(map[string]migrationRecord)
	for rows.Next() {
		var name string
		var record migrationRecord
		if err := rows.Scan(&name, &record.Checksum, &record.Kind); err != nil {
			return nil, err
		}
		history[name] = record
	}

	return history, rows.Err()
}

func recordMigration(ctx context.Context, db *sql.DB, name, checksum, kind string) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO public.schema_migrations (name, checksum, kind)
		VALUES ($1, $2, $3)
	`, name, checksum, kind)
	return err
}

func executeSQLFile(ctx context.Context, db *sql.DB, path, name, checksum, kind string) error {
	sqlText, err := readSQLFile(path)
	if err != nil {
		return err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, sqlText); err != nil {
		return fmt.Errorf("executing %s: %w", filepath.Base(path), err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO public.schema_migrations (name, checksum, kind)
		VALUES ($1, $2, $3)
	`, name, checksum, kind); err != nil {
		return fmt.Errorf("recording %s in schema_migrations: %w", filepath.Base(path), err)
	}

	return tx.Commit()
}

func listMigrationFiles(migrationsDir string) ([]string, error) {
	paths, err := filepath.Glob(filepath.Join(migrationsDir, "*.sql"))
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	return paths, nil
}

func migrationChecksum(path string) (string, error) {
	fileBytes, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	sum := sha256.Sum256(fileBytes)
	return hex.EncodeToString(sum[:]), nil
}

func tableExists(ctx context.Context, db *sql.DB, qualifiedName string) bool {
	var exists bool
	err := db.QueryRowContext(ctx, `SELECT to_regclass($1) IS NOT NULL`, qualifiedName).Scan(&exists)
	return err == nil && exists
}

func indexExists(ctx context.Context, db *sql.DB, indexName string) bool {
	var exists bool
	err := db.QueryRowContext(ctx, `SELECT to_regclass($1) IS NOT NULL`, "public."+indexName).Scan(&exists)
	return err == nil && exists
}

func functionExists(ctx context.Context, db *sql.DB, functionName string) bool {
	var exists bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM pg_proc p
			JOIN pg_namespace n ON n.oid = p.pronamespace
			WHERE n.nspname = 'public'
			  AND p.proname = $1
		)
	`, functionName).Scan(&exists)
	return err == nil && exists
}

func columnExists(ctx context.Context, db *sql.DB, tableName, columnName string) bool {
	var exists bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'public'
			  AND table_name = $1
			  AND column_name = $2
		)
	`, tableName, columnName).Scan(&exists)
	return err == nil && exists
}

func resolveDatabaseURL(flagValue string) string {
	if flagValue != "" {
		return normalizeLegacyDatabaseURL(flagValue)
	}

	if envValue := os.Getenv("DATABASE_URL"); envValue != "" {
		return normalizeLegacyDatabaseURL(envValue)
	}

	return defaultDatabaseURL
}

func normalizeLegacyDatabaseURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}

	switch strings.TrimPrefix(parsed.Path, "/") {
	case "pharma-search", "pharmagician":
		parsed.Path = "/pharma_search"
	}

	return parsed.String()
}

func loadEnvFile(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}

		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}

		value := strings.TrimSpace(parts[1])
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}

		os.Setenv(key, value)
	}
}

func readSQLFile(path string) (string, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(contents), nil
}

func resolveRepoRoot(explicit string) (string, error) {
	if explicit != "" {
		return filepath.Abs(explicit)
	}

	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	for {
		if looksLikeRepoRoot(cwd) {
			return cwd, nil
		}

		parent := filepath.Dir(cwd)
		if parent == cwd {
			break
		}
		cwd = parent
	}

	return "", errors.New("could not find repo root containing go.mod and migrations/001_base_schema.sql; run from the repo or pass -repo")
}

func looksLikeRepoRoot(dir string) bool {
	requiredPaths := []string{
		filepath.Join(dir, "go.mod"),
		filepath.Join(dir, "migrations", "001_base_schema.sql"),
	}

	for _, path := range requiredPaths {
		if _, err := os.Stat(path); err != nil {
			return false
		}
	}

	return true
}
