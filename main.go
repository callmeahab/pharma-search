package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/smtp"
	"os"
	"time"

	"connectrpc.com/connect"
	"github.com/rs/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/protobuf/types/known/structpb"

	pb "github.com/callmeahab/pharma-search/gen"
	"github.com/callmeahab/pharma-search/gen/pbconnect"
)

type server struct {
	db *sql.DB
	// Bounded LRU of grouped search results (shared by the unary + streaming handlers).
	searchCache *searchResultCache
	// Small TTL'd LRU of autocomplete suggestions (per-keystroke, common prefixes repeat).
	autocompleteCache *autocompleteCache
	catalogFlights    catalogFlightGroup
}

func connectDB() (*sql.DB, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:docker@localhost:5432/pharma_search?sslmode=disable"
	}
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	return db, nil
}

func toStructPB(v interface{}) (*structpb.Struct, error) {
	// Always round-trip through JSON: structpb.NewStruct rejects nested types like
	// []map[string]interface{} (which our group payloads contain), whereas the JSON
	// round-trip normalizes every array to []interface{} and every number to
	// float64, making the result structpb-compatible regardless of caller.
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var mm map[string]interface{}
	if err := json.Unmarshal(b, &mm); err != nil {
		return nil, err
	}
	return structpb.NewStruct(mm)
}

func (s *server) cleanupSearchCache() {
	ticker := time.NewTicker(1 * time.Minute)
	for range ticker.C {
		s.searchCache.sweepExpired()
		st := s.searchCache.stats()
		total := st.hits + st.misses
		if total > 0 {
			log.Printf("searchcache: %d entries, %d products held, %.0f%% hit rate (%d hits / %d misses)",
				st.entries, st.products, 100*float64(st.hits)/float64(total), st.hits, st.misses)
		}
	}
}

func (s *server) Contact(ctx context.Context, req *connect.Request[pb.ContactRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	contactEmail := os.Getenv("CONTACT_EMAIL")
	if contactEmail == "" {
		contactEmail = "apostekafm@gmail.com"
	}

	smtpHost := os.Getenv("SMTP_HOST")
	smtpPort := os.Getenv("SMTP_PORT")
	smtpUser := os.Getenv("SMTP_USER")
	smtpPass := os.Getenv("SMTP_PASS")

	if smtpHost == "" || smtpPort == "" || smtpUser == "" || smtpPass == "" {
		data := map[string]interface{}{
			"ok":     true,
			"mocked": true,
			"missing": map[string]bool{
				"SMTP_HOST": smtpHost == "",
				"SMTP_PORT": smtpPort == "",
				"SMTP_USER": smtpUser == "",
				"SMTP_PASS": smtpPass == "",
			},
		}
		st, err := toStructPB(data)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
	}

	from := "Pharmagician <no-reply@pharmagician.rs>"
	to := []string{contactEmail}
	subject := fmt.Sprintf("Kontakt forma: %s", req.Msg.GetName())
	body := fmt.Sprintf("Ime: %s\nEmail: %s\n\nPoruka:\n%s", req.Msg.GetName(), req.Msg.GetEmail(), req.Msg.GetMessage())

	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nReply-To: %s\r\nSubject: %s\r\n\r\n%s",
		from, contactEmail, req.Msg.GetEmail(), subject, body)

	auth := smtp.PlainAuth("", smtpUser, smtpPass, smtpHost)
	addr := fmt.Sprintf("%s:%s", smtpHost, smtpPort)

	err := smtp.SendMail(addr, auth, smtpUser, to, []byte(msg))
	if err != nil {
		data := map[string]interface{}{"ok": false, "error": err.Error()}
		st, err := toStructPB(data)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
	}

	data := map[string]interface{}{"ok": true}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

// ProcessProducts is deprecated - Meilisearch indexing is no longer used.
func (s *server) ProcessProducts(ctx context.Context, req *connect.Request[pb.ProcessRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	data := map[string]interface{}{"status": "deprecated", "message": "Meilisearch indexing removed. Search uses PostgreSQL directly."}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

// ReprocessAll is deprecated - Meilisearch indexing is no longer used.
func (s *server) ReprocessAll(ctx context.Context, req *connect.Request[pb.ReprocessAllRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	data := map[string]interface{}{"status": "deprecated", "message": "Meilisearch indexing removed. Search uses PostgreSQL directly."}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

// RebuildIndex is deprecated - Meilisearch indexing is no longer used.
func (s *server) RebuildIndex(ctx context.Context, req *connect.Request[pb.RebuildIndexRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	data := map[string]interface{}{"status": "deprecated", "message": "Meilisearch indexing removed. Search uses PostgreSQL directly."}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

// RebuildIndexWithStandardization is deprecated - Meilisearch indexing is no longer used.
func (s *server) RebuildIndexWithStandardization(ctx context.Context, req *connect.Request[pb.RebuildIndexRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	data := map[string]interface{}{"status": "deprecated", "message": "Meilisearch indexing removed. Search uses PostgreSQL directly."}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

func (s *server) ProcessingAnalysis(ctx context.Context, req *connect.Request[pb.ProcessingAnalysisRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	if s.db == nil {
		data := map[string]interface{}{"status": "error", "message": "Database not connected"}
		st, err := toStructPB(data)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
	}

	// Basic stats query
	var totalProducts, processedProducts int
	err := s.db.QueryRow(`SELECT COUNT(*), COUNT(CASE WHEN "processedAt" IS NOT NULL THEN 1 END) FROM "Product"`).Scan(&totalProducts, &processedProducts)
	if err != nil {
		data := map[string]interface{}{"status": "error", "message": err.Error()}
		st, err := toStructPB(data)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
	}

	data := map[string]interface{}{
		"status": "completed",
		"statistics": map[string]interface{}{
			"total_products":     totalProducts,
			"processed_products": processedProducts,
			"processing_rate":    float64(processedProducts) / float64(totalProducts) * 100,
		},
		"message": "Processing analysis complete",
	}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

func main() {
	// Load .env (SMTP_*, MAIL_FROM, APP_URL, ...) without overriding real env vars.
	loadDotEnv(".env")

	// Handle CLI commands or start ConnectRPC server
	if len(os.Args) >= 2 {
		switch os.Args[1] {
		case "catalog-evaluate":
			if err := runCatalogEvaluation(); err != nil {
				log.Fatal(err)
			}
			return
		case "catalog-rebuild":
			db, err := connectDB()
			if err != nil {
				log.Fatal(err)
			}
			defer db.Close()
			if err := rebuildCatalog(context.Background(), db); err != nil {
				log.Fatal(err)
			}
			return
		case "test-search":
			runTestSearch()
			return
		case "pricewatch":
			runPriceWatchCLI()
			return
		case "help":
			fmt.Println("Usage: pharma-search [command]")
			fmt.Println("")
			fmt.Println("Commands:")
			fmt.Println("  (no args)      Start the ConnectRPC server")
			fmt.Println("  test-search    Test search with query: pharma-search test-search \"query\"")
			fmt.Println("  pricewatch     Run the price-watch job once (refresh prices + send alerts)")
			fmt.Println("  help           Show this help message")
			return
		}
	}
	runConnectServer()
}

func runPriceWatchCLI() {
	db, err := connectDB()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()
	srv := &server{db: db}
	if err := srv.runPriceWatch(); err != nil {
		log.Fatalf("pricewatch failed: %v", err)
	}
}

func runTestSearch() {
	db, err := connectDB()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	query := "vitamin d"
	if len(os.Args) > 2 {
		query = os.Args[2]
	}
	srv := &server{db: db, searchCache: newSearchResultCache(50000, time.Minute)}
	page, err := srv.catalogSearch(context.Background(), catalogRequest{Query: query, Limit: 20, AllOffers: true})
	if err != nil {
		log.Fatal(err)
	}
	data, _ := json.MarshalIndent(page.asMap(), "", "  ")
	fmt.Println(string(data))
}

func runConnectServer() {
	// Connect to database
	db, err := connectDB()
	if err != nil {
		log.Printf("Warning: Failed to connect to database: %v", err)
		db = nil // Set to nil so methods can handle gracefully
	} else {
		log.Println("Database connected successfully")
		defer db.Close()
	}

	// Create the Connect handler. The search cache is bounded by total member-products
	// held (default 50k ≈ ~75MB worst case) so a burst of distinct queries can't OOM the
	// box, with a 5-minute freshness TTL. Both tunable via env; SEARCH_CACHE_TTL=0 disables.
	cacheTTL := 5 * time.Minute
	if v := getEnvDuration("SEARCH_CACHE_TTL"); v != 0 || os.Getenv("SEARCH_CACHE_TTL") != "" {
		cacheTTL = v
	}
	srv := &server{
		db:                db,
		searchCache:       newSearchResultCache(getEnvInt("SEARCH_CACHE_MAX_PRODUCTS", 50000), cacheTTL),
		autocompleteCache: newAutocompleteCache(getEnvInt("AUTOCOMPLETE_CACHE_MAX", 2000), cacheTTL),
	}

	// Start cache cleanup goroutine
	go srv.cleanupSearchCache()

	// Start the background price-watch job (refresh watched prices + email alerts).
	if db != nil && os.Getenv("PRICEWATCH_ENABLED") != "0" {
		go srv.startPriceWatchLoop()
	}

	path, handler := pbconnect.NewPharmaAPIHandler(srv)

	// Create HTTP mux
	mux := http.NewServeMux()
	mux.Handle(path, handler)

	// Account / auth JSON endpoints (separate from the ConnectRPC search API).
	srv.registerAuthRoutes(mux)
	srv.registerWatchRoutes(mux)
	srv.registerVendorRoutes(mux)
	srv.registerMobileRoutes(mux)
	srv.registerCatalogRoutes(mux)

	// Add CORS middleware
	corsHandler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Connect-Protocol-Version"},
		ExposedHeaders:   []string{"Grpc-Status", "Grpc-Message"},
		AllowCredentials: true,
		MaxAge:           300,
	})

	// Wrap with CORS and h2c for HTTP/2 support
	h2cHandler := h2c.NewHandler(corsHandler.Handler(mux), &http2.Server{})

	// Start server
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":50051"
	}
	log.Printf("ConnectRPC server listening on %s", addr)
	httpServer := &http.Server{Addr: addr, Handler: h2cHandler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 1 << 20}
	if err := httpServer.ListenAndServe(); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
