package main

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	pq "github.com/lib/pq"
)

const (
	defaultDatabaseURL            = "postgres://postgres:docker@localhost:5432/pharma_search?sslmode=disable"
	foursquareBaseURL             = "https://places-api.foursquare.com/places/search"
	foursquareVersion             = "2025-06-17"
	foursquarePharmacyCategoryID  = "4bf58dd8d48988d10f951735"
	foursquareDrugstoreCategoryID = "5745c2e4498e11e7bccabdbd"
	defaultSerbiaCoverageBounds   = "42.2322,18.8170,46.1900,23.0063"
)

const defaultFoursquareCategoryIDs = ""
const defaultFoursquareFields = "fsq_place_id,fsq_id,name,categories,chains,geocodes,location,tel,email,website,hours,rating,popularity,price,photos,social_media,timezone,latitude,longitude"

type vendorRow struct {
	ID      string
	Name    string
	Website string
}

type importStats struct {
	Vendors            int
	PlacesSeen         int
	PlacesMatched      int
	PlacesSkipped      int
	PlacesSaved        int
	PlacesPruned       int
	FoursquareRequests int
	CoverageSplits     int
	CoverageLimitHits  int
	Errors             int
}

type coverageBounds struct {
	South float64
	West  float64
	North float64
	East  float64
}

type coverageCell struct {
	Bounds coverageBounds
	Depth  int
}

type coverageReport struct {
	Requests      int
	SplitCells    int
	LimitHitCells int
}

type foursquareSearchResponse struct {
	Results []foursquarePlace `json:"results"`
}

type foursquarePlace struct {
	FSQID       string             `json:"fsq_id"`
	FSQPlaceID  string             `json:"fsq_place_id"`
	Name        string             `json:"name"`
	Categories  json.RawMessage    `json:"categories"`
	Chains      json.RawMessage    `json:"chains"`
	Email       string             `json:"email"`
	Geocodes    foursquareGeocodes `json:"geocodes"`
	Hours       foursquareHours    `json:"hours"`
	Link        string             `json:"link"`
	Location    foursquareLocation `json:"location"`
	Photos      json.RawMessage    `json:"photos"`
	Popularity  *float64           `json:"popularity"`
	Price       *int               `json:"price"`
	Rating      *float64           `json:"rating"`
	SocialMedia json.RawMessage    `json:"social_media"`
	Tel         string             `json:"tel"`
	Timezone    string             `json:"timezone"`
	Website     string             `json:"website"`
	Latitude    float64            `json:"latitude"`
	Longitude   float64            `json:"longitude"`
	Raw         json.RawMessage    `json:"-"`
}

type foursquareCategory struct {
	ID            string `json:"id"`
	FSQCategoryID string `json:"fsq_category_id"`
	Name          string `json:"name"`
	ShortName     string `json:"short_name"`
	PluralName    string `json:"plural_name"`
}

type foursquareGeocodes struct {
	Main    foursquareLatLng `json:"main"`
	Roof    foursquareLatLng `json:"roof"`
	DropOff foursquareLatLng `json:"drop_off"`
}

type foursquareLatLng struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type foursquareLocation struct {
	Address          string `json:"address"`
	AddressExtended  string `json:"address_extended"`
	CrossStreet      string `json:"cross_street"`
	Locality         string `json:"locality"`
	Region           string `json:"region"`
	Postcode         string `json:"postcode"`
	Country          string `json:"country"`
	FormattedAddress string `json:"formatted_address"`
}

type foursquareHours struct {
	Display string               `json:"display"`
	OpenNow *bool                `json:"open_now"`
	Regular []foursquareTimeSlot `json:"regular"`
}

type foursquareTimeSlot struct {
	Day   int    `json:"day"`
	Open  string `json:"open"`
	Close string `json:"close"`
}

func (p *foursquarePlace) UnmarshalJSON(data []byte) error {
	type alias foursquarePlace
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*p = foursquarePlace(decoded)
	p.Raw = append(p.Raw[:0], data...)
	return nil
}

func main() {
	repoFlag := flag.String("repo", "", "Path to the pharma-search repository root")
	dbURLFlag := flag.String("database-url", "", "PostgreSQL connection string")
	vendorFlag := flag.String("vendor", "", "Import one vendor by id, exact name, or case-insensitive name fragment")
	nearFlag := flag.String("near", envDefault("FOURSQUARE_NEAR", "Serbia"), "Foursquare near parameter")
	versionFlag := flag.String("api-version", envDefault("FOURSQUARE_API_VERSION", foursquareVersion), "Foursquare Places API version header")
	fieldsFlag := flag.String("fields", envDefault("FOURSQUARE_FIELDS", defaultFoursquareFields), "Comma-separated Foursquare response fields; default includes photos for full-resolution place images")
	categoryIDsFlag := flag.String("category-ids", envDefault("FOURSQUARE_CATEGORY_IDS", defaultFoursquareCategoryIDs), "Optional comma-separated Foursquare category IDs to prefilter requests; blank is best for complete vendor coverage")
	coverageBoundsFlag := flag.String("coverage-bounds", envDefault("FOURSQUARE_COVERAGE_BOUNDS", defaultSerbiaCoverageBounds), "south,west,north,east bounds for exhaustive recursive coverage; use 'near' to disable")
	maxSplitDepthFlag := flag.Int("max-split-depth", envInt("FOURSQUARE_MAX_SPLIT_DEPTH", 8), "Maximum recursive splits for Foursquare cells that hit the per-request limit")
	limitFlag := flag.Int("limit", envInt("FOURSQUARE_SEARCH_LIMIT", 50), "Foursquare places per vendor, maximum 50")
	maxVendorsFlag := flag.Int("max-vendors", 0, "Stop after this many vendors; 0 imports all matching vendors")
	sleepFlag := flag.Duration("sleep", envDuration("FOURSQUARE_REQUEST_SLEEP", 250*time.Millisecond), "Delay between Foursquare requests")
	strictFlag := flag.Bool("strict-match", true, "Skip places whose name/domain does not match the vendor")
	pruneDisallowedFlag := flag.Bool("prune-disallowed", envBool("FOURSQUARE_PRUNE_DISALLOWED", true), "Delete cached VendorPlace rows that do not look like pharmacies or relevant shops")
	pruneStaleFlag := flag.Bool("prune-stale", envBool("FOURSQUARE_PRUNE_STALE", true), "After a complete coverage fetch, delete cached VendorPlace rows not returned for that vendor")
	continueOnErrorFlag := flag.Bool("continue-on-error", envBool("FOURSQUARE_CONTINUE_ON_ERROR", false), "Keep processing vendors after a Foursquare/API/save error")
	dryRunFlag := flag.Bool("dry-run", false, "Fetch and print matches without writing to the database")
	flag.Parse()

	repoRoot, err := resolveRepoRoot(*repoFlag)
	if err != nil {
		log.Fatalf("failed to resolve repo root: %v", err)
	}
	loadDotEnv(filepath.Join(repoRoot, ".env"))

	apiKey := strings.TrimSpace(os.Getenv("FOURSQUARE_API_KEY"))
	if apiKey == "" {
		log.Fatal("FOURSQUARE_API_KEY is not set")
	}

	limit := *limitFlag
	if limit <= 0 || limit > 50 {
		limit = 50
	}
	maxSplitDepth := *maxSplitDepthFlag
	if maxSplitDepth < 0 {
		maxSplitDepth = 0
	}
	coverage, err := parseCoverageBounds(*coverageBoundsFlag)
	if err != nil {
		log.Fatalf("invalid coverage bounds: %v", err)
	}
	if coverage != nil {
		log.Printf("Using recursive Foursquare coverage bounds %s with max split depth %d", coverage.String(), maxSplitDepth)
	} else {
		log.Printf("Using one broad Foursquare near search per vendor near %q", *nearFlag)
	}

	db, err := sql.Open("postgres", resolveDatabaseURL(*dbURLFlag))
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}

	vendors, err := loadVendors(ctx, db, *vendorFlag, *maxVendorsFlag)
	if err != nil {
		log.Fatalf("failed to load vendors: %v", err)
	}
	if len(vendors) == 0 {
		log.Println("No vendors matched.")
		return
	}

	allowedCategoryIDs := parseCSVSet(*categoryIDsFlag)
	client := &http.Client{Timeout: 30 * time.Second}
	stats := importStats{Vendors: len(vendors)}
	var fatalErr error

	for i, vendor := range vendors {
		if i > 0 && *sleepFlag > 0 {
			time.Sleep(*sleepFlag)
		}

		log.Printf("[%d/%d] Searching Foursquare for %s", i+1, len(vendors), vendor.Name)
		places, report, err := searchFoursquareForVendor(ctx, client, apiKey, *versionFlag, *fieldsFlag, *categoryIDsFlag, vendor.Name, *nearFlag, limit, coverage, maxSplitDepth, *sleepFlag)
		stats.FoursquareRequests += report.Requests
		stats.CoverageSplits += report.SplitCells
		stats.CoverageLimitHits += report.LimitHitCells
		if err != nil {
			stats.Errors++
			log.Printf("  error: %v", err)
			if !*continueOnErrorFlag {
				fatalErr = err
				break
			}
			continue
		}
		if coverage != nil {
			log.Printf("  coverage: unique=%d requests=%d split_cells=%d limit_hit_cells=%d", len(places), report.Requests, report.SplitCells, report.LimitHitCells)
		}

		stats.PlacesSeen += len(places)
		savedPlaceIDs := map[string]bool{}
		for _, place := range places {
			if !hasCoordinates(place) || placeID(place) == "" {
				stats.PlacesSkipped++
				continue
			}
			if *strictFlag && !looksLikeVendor(vendor, place) {
				stats.PlacesSkipped++
				log.Printf("  skipped: %s did not look like %s", place.Name, vendor.Name)
				continue
			}
			if !isAllowedVendorPlace(vendor, place, allowedCategoryIDs) {
				stats.PlacesSkipped++
				log.Printf("  skipped: %s is not an allowed pharmacy/shop place", place.Name)
				continue
			}

			stats.PlacesMatched++
			if *dryRunFlag {
				log.Printf("  match: %s (%s)", place.Name, formatAddress(place.Location))
				continue
			}
			if err := upsertVendorPlace(ctx, db, vendor, place); err != nil {
				stats.Errors++
				log.Printf("  save error for %s: %v", place.Name, err)
				if !*continueOnErrorFlag {
					fatalErr = err
					break
				}
				continue
			}
			stats.PlacesSaved++
			savedPlaceIDs[placeID(place)] = true
		}
		if fatalErr != nil {
			break
		}
		if report.LimitHitCells > 0 {
			stats.Errors++
			log.Printf("  incomplete: %d coverage cells still hit Foursquare's %d result limit; increase MAX_SPLIT_DEPTH before trusting this vendor as complete", report.LimitHitCells, limit)
			if !*continueOnErrorFlag {
				fatalErr = fmt.Errorf("%s still has saturated Foursquare coverage cells", vendor.Name)
				break
			}
		}
		if coverage != nil && !*dryRunFlag && *pruneStaleFlag && report.LimitHitCells == 0 {
			removed, err := pruneStaleVendorPlaces(ctx, db, vendor.ID, sortedKeys(savedPlaceIDs))
			if err != nil {
				stats.Errors++
				log.Printf("  failed to prune stale places for %s: %v", vendor.Name, err)
				if !*continueOnErrorFlag {
					fatalErr = err
					break
				}
			} else if removed > 0 {
				stats.PlacesPruned += int(removed)
				log.Printf("  pruned %d stale cached places for %s", removed, vendor.Name)
			}
		}
	}

	if fatalErr == nil && !*dryRunFlag && *pruneDisallowedFlag {
		removed, err := pruneDisallowedPlaces(ctx, db, allowedCategoryIDs)
		if err != nil {
			stats.Errors++
			log.Printf("failed to prune cached non-pharmacy/shop places: %v", err)
			if !*continueOnErrorFlag {
				fatalErr = err
			}
		} else if removed > 0 {
			log.Printf("Pruned %d cached places outside the allowed categories.", removed)
		}
	}

	log.Printf("Done. vendors=%d requests=%d split_cells=%d limit_hit_cells=%d seen=%d matched=%d skipped=%d saved=%d pruned=%d errors=%d dry_run=%t",
		stats.Vendors, stats.FoursquareRequests, stats.CoverageSplits, stats.CoverageLimitHits, stats.PlacesSeen, stats.PlacesMatched, stats.PlacesSkipped, stats.PlacesSaved, stats.PlacesPruned, stats.Errors, *dryRunFlag)
	if fatalErr != nil {
		log.Printf("Failed fast. Re-run with -continue-on-error, or CONTINUE_ON_ERROR=1 make fetch-places, to keep processing after errors.")
		os.Exit(1)
	}
	if stats.Errors > 0 {
		os.Exit(1)
	}
}

func loadVendors(ctx context.Context, db *sql.DB, filter string, max int) ([]vendorRow, error) {
	args := []interface{}{}
	where := `WHERE EXISTS (
		SELECT 1 FROM public."Product" p WHERE p."vendorId" = v.id AND p.price > 0
	)`
	if strings.TrimSpace(filter) != "" {
		args = append(args, strings.TrimSpace(filter), "%"+strings.TrimSpace(filter)+"%")
		where += ` AND (v.id = $1 OR lower(v.name) = lower($1) OR v.name ILIKE $2)`
	}
	limitSQL := ""
	if max > 0 {
		args = append(args, max)
		limitSQL = fmt.Sprintf(" LIMIT $%d", len(args))
	}

	rows, err := db.QueryContext(ctx, `
		SELECT v.id, v.name, COALESCE(v.website, '')
		FROM public."Vendor" v
		`+where+`
		ORDER BY v.name ASC`+limitSQL, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var vendors []vendorRow
	for rows.Next() {
		var v vendorRow
		if err := rows.Scan(&v.ID, &v.Name, &v.Website); err != nil {
			return nil, err
		}
		vendors = append(vendors, v)
	}
	return vendors, rows.Err()
}

func searchFoursquareForVendor(ctx context.Context, client *http.Client, apiKey, version, fields, categoryIDs, query, near string, limit int, coverage *coverageBounds, maxSplitDepth int, requestSleep time.Duration) ([]foursquarePlace, coverageReport, error) {
	if coverage == nil {
		places, err := searchFoursquare(ctx, client, apiKey, version, fields, categoryIDs, query, near, nil, limit)
		return places, coverageReport{Requests: 1}, err
	}

	report := coverageReport{}
	seen := map[string]foursquarePlace{}
	queue := []coverageCell{{Bounds: *coverage, Depth: 0}}

	for len(queue) > 0 {
		cell := queue[len(queue)-1]
		queue = queue[:len(queue)-1]

		if report.Requests > 0 && requestSleep > 0 {
			time.Sleep(requestSleep)
		}

		places, err := searchFoursquare(ctx, client, apiKey, version, fields, categoryIDs, query, "", &cell.Bounds, limit)
		report.Requests++
		if err != nil {
			return nil, report, err
		}

		if len(places) >= limit {
			if cell.Depth < maxSplitDepth {
				report.SplitCells++
				queue = append(queue, cell.split()...)
				continue
			}
			report.LimitHitCells++
		}

		for _, place := range places {
			id := placeID(place)
			if id == "" {
				lat, lng := coordinates(place)
				id = fmt.Sprintf("%s:%.7f:%.7f", normalizeName(place.Name), lat, lng)
			}
			if id != "" {
				seen[id] = place
			}
		}
	}

	places := make([]foursquarePlace, 0, len(seen))
	for _, place := range seen {
		places = append(places, place)
	}
	sort.Slice(places, func(i, j int) bool {
		return strings.ToLower(places[i].Name) < strings.ToLower(places[j].Name)
	})
	return places, report, nil
}

func searchFoursquare(ctx context.Context, client *http.Client, apiKey, version, fields, categoryIDs, query, near string, bounds *coverageBounds, limit int) ([]foursquarePlace, error) {
	params := url.Values{}
	params.Set("query", query)
	params.Set("limit", strconv.Itoa(limit))
	if bounds != nil {
		params.Set("ne", fmt.Sprintf("%.6f,%.6f", bounds.North, bounds.East))
		params.Set("sw", fmt.Sprintf("%.6f,%.6f", bounds.South, bounds.West))
	} else {
		params.Set("near", near)
	}
	if strings.TrimSpace(categoryIDs) != "" {
		params.Set("categories", strings.TrimSpace(categoryIDs))
	}
	if strings.TrimSpace(fields) != "" {
		params.Set("fields", fields)
	}

	body, statusCode, err := doFoursquareRequest(ctx, client, apiKey, version, params)
	if err != nil {
		return nil, err
	}
	if statusCode == http.StatusUnauthorized && bearerToken(apiKey) != strings.TrimSpace(apiKey) {
		retryBody, retryStatusCode, retryErr := doFoursquareRequestWithAuth(ctx, client, strings.TrimSpace(apiKey), version, params)
		if retryErr == nil {
			body = retryBody
			statusCode = retryStatusCode
		}
	}
	if statusCode < 200 || statusCode >= 300 {
		return nil, fmt.Errorf("Foursquare status %d: %s", statusCode, truncateForLog(body, 500))
	}

	var decoded foursquareSearchResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return nil, err
	}
	return decoded.Results, nil
}

func parseCoverageBounds(raw string) (*coverageBounds, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.EqualFold(raw, "near") || strings.EqualFold(raw, "off") || strings.EqualFold(raw, "false") {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	if len(parts) != 4 {
		return nil, fmt.Errorf("expected south,west,north,east")
	}
	values := [4]float64{}
	for i, part := range parts {
		value, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
		if err != nil {
			return nil, err
		}
		values[i] = value
	}
	b := coverageBounds{South: values[0], West: values[1], North: values[2], East: values[3]}
	if b.South >= b.North || b.West >= b.East {
		return nil, fmt.Errorf("south/west must be less than north/east")
	}
	return &b, nil
}

func (b coverageBounds) String() string {
	return fmt.Sprintf("%.4f,%.4f,%.4f,%.4f", b.South, b.West, b.North, b.East)
}

func (c coverageCell) split() []coverageCell {
	midLat := (c.Bounds.South + c.Bounds.North) / 2
	midLng := (c.Bounds.West + c.Bounds.East) / 2
	depth := c.Depth + 1
	return []coverageCell{
		{Bounds: coverageBounds{South: c.Bounds.South, West: c.Bounds.West, North: midLat, East: midLng}, Depth: depth},
		{Bounds: coverageBounds{South: c.Bounds.South, West: midLng, North: midLat, East: c.Bounds.East}, Depth: depth},
		{Bounds: coverageBounds{South: midLat, West: c.Bounds.West, North: c.Bounds.North, East: midLng}, Depth: depth},
		{Bounds: coverageBounds{South: midLat, West: midLng, North: c.Bounds.North, East: c.Bounds.East}, Depth: depth},
	}
}

func doFoursquareRequest(ctx context.Context, client *http.Client, apiKey, version string, params url.Values) ([]byte, int, error) {
	return doFoursquareRequestWithAuth(ctx, client, bearerToken(apiKey), version, params)
}

func doFoursquareRequestWithAuth(ctx context.Context, client *http.Client, authHeader, version string, params url.Values) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, foursquareBaseURL+"?"+params.Encode(), nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", authHeader)
	req.Header.Set("X-Places-Api-Version", version)

	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, 0, err
	}
	return body, resp.StatusCode, nil
}

func bearerToken(apiKey string) string {
	apiKey = strings.TrimSpace(apiKey)
	if strings.HasPrefix(strings.ToLower(apiKey), "bearer ") {
		return apiKey
	}
	return "Bearer " + apiKey
}

func upsertVendorPlace(ctx context.Context, db *sql.DB, vendor vendorRow, place foursquarePlace) error {
	lat, lng := coordinates(place)
	foursquareID := placeID(place)
	hoursJSON := rawJSONOrDefault(mustJSON(place.Hours), "{}")
	categoriesJSON := rawJSONOrDefault(place.Categories, "[]")
	chainsJSON := rawJSONOrDefault(place.Chains, "[]")
	photosJSON := rawJSONOrDefault(place.Photos, "[]")
	socialJSON := rawJSONOrDefault(place.SocialMedia, "{}")
	rawPlaceJSON := rawJSONOrDefault(place.Raw, "{}")
	hoursDisplay := strings.TrimSpace(place.Hours.Display)
	if hoursDisplay == "" {
		hoursDisplay = formatRegularHours(place.Hours.Regular)
	}
	mapsURL := googleMapsURL(place.Name, lat, lng)

	_, err := db.ExecContext(ctx, `
		INSERT INTO public."VendorPlace" (
			"vendorId", "foursquareId", name, address, locality, region, postcode, country,
			"formattedAddress", phone, email, website, "hoursDisplay", "openNow", hours,
			categories, chains, photos, "socialMedia", rating, popularity, price, latitude,
			longitude, timezone, "mapsUrl", "rawPlace", "fetchedAt", "updatedAt"
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8,
			$9, $10, $11, $12, $13, $14, $15::jsonb,
			$16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20, $21, $22, $23,
			$24, $25, $26, $27::jsonb, now(), now()
		)
		ON CONFLICT ("vendorId", "foursquareId") DO UPDATE SET
			name = EXCLUDED.name,
			address = EXCLUDED.address,
			locality = EXCLUDED.locality,
			region = EXCLUDED.region,
			postcode = EXCLUDED.postcode,
			country = EXCLUDED.country,
			"formattedAddress" = EXCLUDED."formattedAddress",
			phone = EXCLUDED.phone,
			email = EXCLUDED.email,
			website = EXCLUDED.website,
			"hoursDisplay" = EXCLUDED."hoursDisplay",
			"openNow" = EXCLUDED."openNow",
			hours = EXCLUDED.hours,
			categories = EXCLUDED.categories,
			chains = EXCLUDED.chains,
			photos = EXCLUDED.photos,
			"socialMedia" = EXCLUDED."socialMedia",
			rating = EXCLUDED.rating,
			popularity = EXCLUDED.popularity,
			price = EXCLUDED.price,
			latitude = EXCLUDED.latitude,
			longitude = EXCLUDED.longitude,
			timezone = EXCLUDED.timezone,
			"mapsUrl" = EXCLUDED."mapsUrl",
			"rawPlace" = EXCLUDED."rawPlace",
			"fetchedAt" = now(),
			"updatedAt" = now()
	`, vendor.ID, foursquareID, place.Name, combineAddress(place.Location.Address, place.Location.AddressExtended),
		place.Location.Locality, place.Location.Region, place.Location.Postcode, place.Location.Country,
		formatAddress(place.Location), place.Tel, place.Email, place.Website, hoursDisplay,
		nullableBool(place.Hours.OpenNow), string(hoursJSON), string(categoriesJSON), string(chainsJSON),
		string(photosJSON), string(socialJSON), nullableFloat(place.Rating), nullableFloat(place.Popularity),
		nullableInt(place.Price), lat, lng, place.Timezone, mapsURL, string(rawPlaceJSON))
	if err != nil {
		return err
	}

	return backfillVendorContact(ctx, db, vendor.ID)
}

func backfillVendorContact(ctx context.Context, db *sql.DB, vendorID string) error {
	_, err := db.ExecContext(ctx, `
		UPDATE public."Vendor" v
		SET phone = COALESCE(NULLIF(v.phone, ''), p.phone),
		    address = COALESCE(NULLIF(v.address, ''), p."formattedAddress", p.address),
		    city = COALESCE(NULLIF(v.city, ''), p.locality),
		    hours = COALESCE(NULLIF(v.hours, ''), p."hoursDisplay"),
		    "mapsUrl" = COALESCE(NULLIF(v."mapsUrl", ''), p."mapsUrl"),
		    latitude = COALESCE(v.latitude, p.latitude),
		    longitude = COALESCE(v.longitude, p.longitude),
		    "contactUpdatedAt" = COALESCE(v."contactUpdatedAt", now())
		FROM (
			SELECT *
			FROM public."VendorPlace"
			WHERE "vendorId" = $1
			ORDER BY COALESCE(rating, 0) DESC, COALESCE(popularity, 0) DESC, name ASC
			LIMIT 1
		) p
		WHERE v.id = $1
	`, vendorID)
	return err
}

func pruneDisallowedPlaces(ctx context.Context, db *sql.DB, allowedCategoryIDs map[string]bool) (int64, error) {
	ids := sortedKeys(allowedCategoryIDs)

	result, err := db.ExecContext(ctx, `
		DELETE FROM public."VendorPlace" vp
		USING public."Vendor" v
		WHERE v.id = vp."vendorId"
		  AND NOT EXISTS (
			SELECT 1
			FROM jsonb_to_recordset(vp.categories) AS c(fsq_category_id text, id text, name text)
			WHERE c.fsq_category_id = ANY($1)
			   OR c.id = ANY($1)
			   OR c.fsq_category_id = '5745c2e4498e11e7bccabdbd'
			   OR c.id = '5745c2e4498e11e7bccabdbd'
			   OR lower(c.name) = 'drugstore'
			   OR c.fsq_category_id = '4bf58dd8d48988d10f951735'
			   OR c.id = '4bf58dd8d48988d10f951735'
			   OR lower(c.name) = 'pharmacy'
			   OR lower(c.name) LIKE '%supplement%'
			   OR lower(c.name) LIKE '%vitamin%'
			   OR lower(c.name) LIKE '%nutrition%'
			   OR lower(c.name) LIKE '%health food%'
			   OR lower(c.name) LIKE '%sporting goods%'
			   OR lower(c.name) LIKE '%cosmetic%'
			   OR lower(c.name) LIKE '%beauty supply%'
		  )
		  AND NOT (
			lower(vp.name || ' ' || v."name") LIKE '%apotek%'
			OR lower(vp.name || ' ' || v."name") LIKE '%апотек%'
			OR lower(vp.name || ' ' || v."name") LIKE '%pharm%'
			OR lower(vp.name || ' ' || v."name") LIKE '%фарм%'
			OR lower(vp.name || ' ' || v."name") LIKE '%farmaci%'
			OR lower(vp.name || ' ' || v."name") LIKE '%drogerie%'
			OR lower(vp.name || ' ' || v."name") LIKE '%drugstore%'
			OR lower(vp.name || ' ' || v."name") LIKE '%benu%'
			OR lower(vp.name || ' ' || v."name") LIKE '%dr max%'
			OR lower(vp.name || ' ' || v."name") LIKE '%lilly%'
			OR lower(vp.name || ' ' || v."name") LIKE '%lily%'
			OR lower(vp.name || ' ' || v."name") LIKE '%srbotrade%'
			OR lower(vp.name || ' ' || v."name") LIKE '%zdravlja%'
			OR lower(vp.name || ' ' || v."name") LIKE '%lek%'
			OR lower(vp.name || ' ' || v."name") LIKE '%лек%'
			OR lower(vp.name || ' ' || v."name") LIKE '%med%'
			OR lower(vp.name || ' ' || v."name") LIKE '%мед%'
			OR lower(vp.name || ' ' || v."name") LIKE '%vita%'
			OR lower(vp.name || ' ' || v."name") LIKE '%vitamin%'
			OR lower(vp.name || ' ' || v."name") LIKE '%suplement%'
			OR lower(vp.name || ' ' || v."name") LIKE '%supplement%'
			OR lower(vp.name || ' ' || v."name") LIKE '%protein%'
			OR lower(vp.name || ' ' || v."name") LIKE '%proteini%'
			OR lower(vp.name || ' ' || v."name") LIKE '%sport%'
			OR lower(vp.name || ' ' || v."name") LIKE '%fitness%'
			OR lower(vp.name || ' ' || v."name") LIKE '%fitlab%'
			OR lower(vp.name || ' ' || v."name") LIKE '%gym%'
			OR lower(vp.name || ' ' || v."name") LIKE '%pansport%'
			OR lower(vp.name || ' ' || v."name") LIKE '%titanium%'
			OR lower(vp.name || ' ' || v."name") LIKE '%superior%'
			OR lower(v."name") = 'dm'
		  )
	`, pq.Array(ids))
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func pruneStaleVendorPlaces(ctx context.Context, db *sql.DB, vendorID string, fetchedPlaceIDs []string) (int64, error) {
	result, err := db.ExecContext(ctx, `
		DELETE FROM public."VendorPlace"
		WHERE "vendorId" = $1
		  AND NOT ("foursquareId" = ANY($2))
	`, vendorID, pq.Array(fetchedPlaceIDs))
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func hasCoordinates(place foursquarePlace) bool {
	lat, lng := coordinates(place)
	return lat != 0 && lng != 0
}

func coordinates(place foursquarePlace) (float64, float64) {
	if place.Latitude != 0 || place.Longitude != 0 {
		return place.Latitude, place.Longitude
	}
	if place.Geocodes.Main.Latitude != 0 || place.Geocodes.Main.Longitude != 0 {
		return place.Geocodes.Main.Latitude, place.Geocodes.Main.Longitude
	}
	if place.Geocodes.Roof.Latitude != 0 || place.Geocodes.Roof.Longitude != 0 {
		return place.Geocodes.Roof.Latitude, place.Geocodes.Roof.Longitude
	}
	return place.Geocodes.DropOff.Latitude, place.Geocodes.DropOff.Longitude
}

func placeID(place foursquarePlace) string {
	if strings.TrimSpace(place.FSQPlaceID) != "" {
		return strings.TrimSpace(place.FSQPlaceID)
	}
	return strings.TrimSpace(place.FSQID)
}

func isAllowedVendorPlace(vendor vendorRow, place foursquarePlace, allowedCategoryIDs map[string]bool) bool {
	hasAllowedCategory := false
	hasRelevantCategory := false

	for _, category := range placeCategories(place.Categories) {
		categoryID := strings.TrimSpace(category.FSQCategoryID)
		if categoryID == "" {
			categoryID = strings.TrimSpace(category.ID)
		}
		name := normalizeName(strings.Join([]string{category.Name, category.ShortName, category.PluralName}, " "))

		switch {
		case allowedCategoryIDs[categoryID]:
			hasAllowedCategory = true
		case categoryID == foursquareDrugstoreCategoryID || categoryID == foursquarePharmacyCategoryID:
			hasRelevantCategory = true
		case hasRelevantPlaceCategoryName(name):
			hasRelevantCategory = true
		}
	}

	return hasAllowedCategory || hasRelevantCategory || hasRelevantPlaceNameSignal(vendor, place)
}

func hasRelevantPlaceCategoryName(name string) bool {
	for _, signal := range []string{
		"pharmacy", "drugstore", "supplement", "vitamin", "nutrition", "health food",
		"sporting goods", "cosmetic", "beauty supply",
	} {
		if strings.Contains(name, signal) {
			return true
		}
	}
	return false
}

func hasRelevantPlaceNameSignal(vendor vendorRow, place foursquarePlace) bool {
	raw := strings.ToLower(vendor.Name + " " + place.Name)
	for _, signal := range []string{"апотек", "фарма", "лек", "мед", "суплемент", "витамин", "спорт"} {
		if strings.Contains(raw, signal) {
			return true
		}
	}

	normalized := normalizeName(vendor.Name + " " + place.Name)
	if normalized == "" {
		return false
	}
	for _, signal := range []string{
		"apotek", "pharm", "farmaci", "drogerie", "drugstore", "zdravlja", "lek", "med", "vita",
		"vitamin", "suplement", "supplement", "protein", "proteini", "sport", "fitness", "fitlab",
		"gym", "pansport", "titanium", "superior",
	} {
		if strings.Contains(normalized, signal) {
			return true
		}
	}

	tokens := tokenSet(normalized)
	if tokens["benu"] || tokens["dm"] || tokens["lilly"] || tokens["lily"] || tokens["srbotrade"] {
		return true
	}
	return tokens["dr"] && tokens["max"]
}

func placeCategories(raw json.RawMessage) []foursquareCategory {
	var categories []foursquareCategory
	if err := json.Unmarshal(rawJSONOrDefault(raw, "[]"), &categories); err != nil {
		return nil
	}
	return categories
}

func looksLikeVendor(v vendorRow, place foursquarePlace) bool {
	if sameDomain(v.Website, place.Website) {
		return true
	}

	vendorName := normalizeName(v.Name)
	placeName := normalizeName(place.Name)
	if vendorName == "" || placeName == "" {
		return false
	}
	if strings.Contains(placeName, vendorName) || strings.Contains(vendorName, placeName) {
		return true
	}

	vendorTokens := meaningfulTokens(vendorName)
	if len(vendorTokens) == 0 {
		vendorTokens = splitTokens(vendorName)
	}
	if len(vendorTokens) == 0 {
		return false
	}

	placeTokens := tokenSet(placeName)
	for _, token := range vendorTokens {
		if !placeTokens[token] {
			return false
		}
	}
	return true
}

func normalizeName(value string) string {
	value = strings.NewReplacer(
		"c", "c", "C", "c",
		"ć", "c", "Ć", "c",
		"č", "c", "Č", "c",
		"š", "s", "Š", "s",
		"đ", "dj", "Đ", "dj",
		"ž", "z", "Ž", "z",
	).Replace(strings.ToLower(value))
	var b strings.Builder
	lastSpace := true
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastSpace = false
			continue
		}
		if !lastSpace {
			b.WriteByte(' ')
			lastSpace = true
		}
	}
	return strings.TrimSpace(b.String())
}

func splitTokens(value string) []string {
	if value == "" {
		return nil
	}
	return strings.Fields(value)
}

func meaningfulTokens(value string) []string {
	stop := map[string]bool{
		"apoteka": true, "apoteke": true, "apotekarska": true, "ustanova": true,
		"pharmacy": true, "farmacija": true, "online": true, "shop": true,
		"store": true, "prodavnica": true, "srbija": true, "rs": true, "www": true,
	}
	var tokens []string
	for _, token := range splitTokens(value) {
		if stop[token] {
			continue
		}
		tokens = append(tokens, token)
	}
	sort.Strings(tokens)
	return tokens
}

func tokenSet(value string) map[string]bool {
	out := map[string]bool{}
	for _, token := range splitTokens(value) {
		out[token] = true
	}
	return out
}

func parseCSVSet(value string) map[string]bool {
	out := map[string]bool{}
	for _, part := range strings.Split(value, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			out[part] = true
		}
	}
	return out
}

func sortedKeys(values map[string]bool) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sameDomain(left, right string) bool {
	leftHost := hostWithoutWWW(left)
	rightHost := hostWithoutWWW(right)
	if leftHost == "" || rightHost == "" {
		return false
	}
	return leftHost == rightHost || strings.HasSuffix(leftHost, "."+rightHost) || strings.HasSuffix(rightHost, "."+leftHost)
}

func hostWithoutWWW(raw string) string {
	raw = strings.TrimSpace(strings.ToLower(raw))
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	host := parsed.Hostname()
	host = strings.TrimPrefix(host, "www.")
	return host
}

func formatAddress(loc foursquareLocation) string {
	if strings.TrimSpace(loc.FormattedAddress) != "" {
		return strings.TrimSpace(loc.FormattedAddress)
	}
	parts := []string{combineAddress(loc.Address, loc.AddressExtended), loc.Locality, loc.Region, loc.Postcode, loc.Country}
	var cleaned []string
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			cleaned = append(cleaned, part)
		}
	}
	return strings.Join(cleaned, ", ")
}

func combineAddress(address, extended string) string {
	address = strings.TrimSpace(address)
	extended = strings.TrimSpace(extended)
	if address == "" {
		return extended
	}
	if extended == "" {
		return address
	}
	return address + ", " + extended
}

func formatRegularHours(slots []foursquareTimeSlot) string {
	if len(slots) == 0 {
		return ""
	}
	dayNames := map[int]string{1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"}
	var lines []string
	for _, slot := range slots {
		day := dayNames[slot.Day]
		if day == "" {
			day = strconv.Itoa(slot.Day)
		}
		lines = append(lines, fmt.Sprintf("%s %s-%s", day, formatClock(slot.Open), formatClock(slot.Close)))
	}
	return strings.Join(lines, "\n")
}

func formatClock(raw string) string {
	raw = regexp.MustCompile(`\D`).ReplaceAllString(raw, "")
	if len(raw) != 4 {
		return raw
	}
	return raw[:2] + ":" + raw[2:]
}

func googleMapsURL(name string, lat, lng float64) string {
	query := fmt.Sprintf("%s %.6f,%.6f", strings.TrimSpace(name), lat, lng)
	return "https://www.google.com/maps/search/?api=1&query=" + url.QueryEscape(query)
}

func nullableFloat(v *float64) interface{} {
	if v == nil {
		return nil
	}
	return *v
}

func nullableInt(v *int) interface{} {
	if v == nil {
		return nil
	}
	return *v
}

func nullableBool(v *bool) interface{} {
	if v == nil {
		return nil
	}
	return *v
}

func mustJSON(v interface{}) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return data
}

func rawJSONOrDefault(raw json.RawMessage, fallback string) json.RawMessage {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || !json.Valid(raw) {
		return json.RawMessage(fallback)
	}
	return raw
}

func truncateForLog(body []byte, max int) string {
	body = bytes.TrimSpace(body)
	if len(body) <= max {
		return string(body)
	}
	return string(body[:max]) + "..."
}

func envDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func envDuration(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err == nil {
		return value
	}
	if seconds, err := strconv.Atoi(raw); err == nil {
		return time.Duration(seconds) * time.Second
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if raw == "" {
		return fallback
	}
	switch raw {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return fallback
	}
}

func resolveDatabaseURL(flagValue string) string {
	if strings.TrimSpace(flagValue) != "" {
		return normalizeLegacyDatabaseURL(flagValue)
	}
	if envValue := strings.TrimSpace(os.Getenv("DATABASE_URL")); envValue != "" {
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

func loadDotEnv(path string) {
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
		line = strings.TrimPrefix(line, "export ")
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])
		if len(value) >= 2 && ((value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'')) {
			value = value[1 : len(value)-1]
		}
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, value)
		}
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
	return "", errors.New("could not find repo root")
}

func looksLikeRepoRoot(path string) bool {
	_, goModErr := os.Stat(filepath.Join(path, "go.mod"))
	_, migrationsErr := os.Stat(filepath.Join(path, "migrations"))
	return goModErr == nil && migrationsErr == nil
}
