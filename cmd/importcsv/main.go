package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	repoFlag := flag.String("repo", "", "Path to the pharma-search repository root")
	bunFlag := flag.String("bun", "bun", "Bun executable to use")
	flag.Parse()

	repoRoot, err := resolveRepoRoot(*repoFlag)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to resolve repo root: %v\n", err)
		os.Exit(1)
	}

	scrapersDir := filepath.Join(repoRoot, "scrapers")
	if _, err := os.Stat(filepath.Join(scrapersDir, "package.json")); err != nil {
		fmt.Fprintf(os.Stderr, "scrapers directory is missing package.json: %v\n", err)
		os.Exit(1)
	}

	cmd := exec.Command(*bunFlag, "run", "import")
	cmd.Dir = scrapersDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin

	fmt.Printf("Running scraper CSV import from %s\n", scrapersDir)
	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			os.Exit(exitErr.ExitCode())
		}

		fmt.Fprintf(os.Stderr, "failed to run bun import: %v\n", err)
		os.Exit(1)
	}
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

	return "", errors.New("could not find repo root containing go.mod and scrapers/import-csv.ts; run from the repo or pass -repo")
}

func looksLikeRepoRoot(dir string) bool {
	requiredPaths := []string{
		filepath.Join(dir, "go.mod"),
		filepath.Join(dir, "scrapers", "import-csv.ts"),
	}

	for _, path := range requiredPaths {
		if _, err := os.Stat(path); err != nil {
			return false
		}
	}

	return true
}
