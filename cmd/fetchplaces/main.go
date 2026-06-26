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
)

const defaultFoursquareCategoryIDs = foursquarePharmacyCategoryID + "," + foursquareDrugstoreCategoryID

type vendorRow struct {
	ID      string
	Name    string
	Website string
}

type importStats struct {
	Vendors       int
	PlacesSeen    int
	PlacesMatched int
	PlacesSkipped int
	PlacesSaved   int
	Errors        int
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
	fieldsFlag := flag.String("fields", os.Getenv("FOURSQUARE_FIELDS"), "Optional comma-separated Foursquare response fields; leave empty to use the free/default field set")
	categoryIDsFlag := flag.String("category-ids", envDefault("FOURSQUARE_CATEGORY_IDS", defaultFoursquareCategoryIDs), "Comma-separated Foursquare category IDs to fetch and keep; default keeps Pharmacy and Drugstore only")
	limitFlag := flag.Int("limit", envInt("FOURSQUARE_SEARCH_LIMIT", 50), "Foursquare places per vendor, maximum 50")
	maxVendorsFlag := flag.Int("max-vendors", 0, "Stop after this many vendors; 0 imports all matching vendors")
	sleepFlag := flag.Duration("sleep", envDuration("FOURSQUARE_REQUEST_SLEEP", 250*time.Millisecond), "Delay between Foursquare requests")
	strictFlag := flag.Bool("strict-match", true, "Skip places whose name/domain does not match the vendor")
	pruneDisallowedFlag := flag.Bool("prune-disallowed", envBool("FOURSQUARE_PRUNE_DISALLOWED", true), "Delete cached VendorPlace rows outside the allowed Foursquare category IDs")
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
		places, err := searchFoursquare(ctx, client, apiKey, *versionFlag, *fieldsFlag, *categoryIDsFlag, vendor.Name, *nearFlag, limit)
		if err != nil {
			stats.Errors++
			log.Printf("  error: %v", err)
			if !*continueOnErrorFlag {
				fatalErr = err
				break
			}
			continue
		}

		stats.PlacesSeen += len(places)
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
			if !isAllowedPharmacyPlace(vendor, place, allowedCategoryIDs) {
				stats.PlacesSkipped++
				log.Printf("  skipped: %s is not an allowed pharmacy/drugstore place", place.Name)
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
		}
		if fatalErr != nil {
			break
		}
	}

	if fatalErr == nil && !*dryRunFlag && *pruneDisallowedFlag && len(allowedCategoryIDs) > 0 {
		removed, err := pruneDisallowedPlaces(ctx, db, allowedCategoryIDs)
		if err != nil {
			stats.Errors++
			log.Printf("failed to prune cached non-pharmacy places: %v", err)
			if !*continueOnErrorFlag {
				fatalErr = err
			}
		} else if removed > 0 {
			log.Printf("Pruned %d cached places outside the allowed categories.", removed)
		}
	}

	log.Printf("Done. vendors=%d seen=%d matched=%d skipped=%d saved=%d errors=%d dry_run=%t",
		stats.Vendors, stats.PlacesSeen, stats.PlacesMatched, stats.PlacesSkipped, stats.PlacesSaved, stats.Errors, *dryRunFlag)
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

func searchFoursquare(ctx context.Context, client *http.Client, apiKey, version, fields, categoryIDs, query, near string, limit int) ([]foursquarePlace, error) {
	params := url.Values{}
	params.Set("query", query)
	params.Set("near", near)
	params.Set("limit", strconv.Itoa(limit))
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
	if len(ids) == 0 {
		return 0, nil
	}

	result, err := db.ExecContext(ctx, `
		DELETE FROM public."VendorPlace" vp
		USING public."Vendor" v
		WHERE v.id = vp."vendorId"
		  AND NOT EXISTS (
			SELECT 1
			FROM jsonb_to_recordset(vp.categories) AS c(fsq_category_id text, id text, name text)
			WHERE c.fsq_category_id = '5745c2e4498e11e7bccabdbd'
			   OR c.id = '5745c2e4498e11e7bccabdbd'
			   OR lower(c.name) = 'drugstore'
			   OR (
					(c.fsq_category_id = '4bf58dd8d48988d10f951735'
					 OR c.id = '4bf58dd8d48988d10f951735'
					 OR lower(c.name) = 'pharmacy')
					AND (
						lower(vp.name) LIKE '%apotek%'
						OR lower(vp.name) LIKE '%апотек%'
						OR lower(vp.name) LIKE '%pharm%'
						OR lower(vp.name) LIKE '%фарм%'
						OR lower(vp.name) LIKE '%farmaci%'
						OR lower(vp.name) LIKE '%drogerie%'
						OR lower(vp.name) LIKE '%drugstore%'
						OR lower(vp.name) LIKE '%benu%'
						OR lower(vp.name) LIKE '%dr max%'
						OR lower(vp.name) LIKE '%lilly%'
						OR lower(vp.name) LIKE '%lily%'
						OR lower(vp.name) LIKE '%srbotrade%'
						OR lower(vp.name) LIKE '%zdravlja%'
						OR lower(vp.name) LIKE '%lek%'
						OR lower(vp.name) LIKE '%лек%'
						OR lower(vp.name) LIKE '%med%'
						OR lower(vp.name) LIKE '%мед%'
						OR lower(vp.name) LIKE '%vita%'
						OR lower(v."name") LIKE '%apotek%'
						OR lower(v."name") LIKE '%апотек%'
						OR lower(v."name") LIKE '%pharm%'
						OR lower(v."name") LIKE '%фарм%'
						OR lower(v."name") LIKE '%farmaci%'
						OR lower(v."name") LIKE '%drogerie%'
						OR lower(v."name") LIKE '%drugstore%'
						OR lower(v."name") LIKE '%benu%'
						OR lower(v."name") LIKE '%dr max%'
						OR lower(v."name") LIKE '%lilly%'
						OR lower(v."name") LIKE '%lily%'
						OR lower(v."name") LIKE '%srbotrade%'
						OR lower(v."name") LIKE '%zdravlja%'
						OR lower(v."name") LIKE '%lek%'
						OR lower(v."name") LIKE '%лек%'
						OR lower(v."name") LIKE '%med%'
						OR lower(v."name") LIKE '%мед%'
						OR lower(v."name") LIKE '%vita%'
					)
			   )
			   OR (
					(c.fsq_category_id = ANY($1) OR c.id = ANY($1))
					AND c.fsq_category_id NOT IN ('4bf58dd8d48988d10f951735', '5745c2e4498e11e7bccabdbd')
					AND c.id NOT IN ('4bf58dd8d48988d10f951735', '5745c2e4498e11e7bccabdbd')
			   )
		)
	`, pq.Array(ids))
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

func isAllowedPharmacyPlace(vendor vendorRow, place foursquarePlace, allowedCategoryIDs map[string]bool) bool {
	if len(allowedCategoryIDs) == 0 {
		return true
	}
	hasPharmacy := false
	hasDrugstore := false
	hasOtherAllowed := false

	for _, category := range placeCategories(place.Categories) {
		categoryID := strings.TrimSpace(category.FSQCategoryID)
		if categoryID == "" {
			categoryID = strings.TrimSpace(category.ID)
		}
		name := strings.ToLower(strings.TrimSpace(category.Name))

		switch {
		case categoryID == foursquareDrugstoreCategoryID || name == "drugstore":
			hasDrugstore = true
		case categoryID == foursquarePharmacyCategoryID || name == "pharmacy":
			hasPharmacy = true
		case allowedCategoryIDs[categoryID]:
			hasOtherAllowed = true
		}
	}

	return hasDrugstore || hasOtherAllowed || (hasPharmacy && hasPharmacyNameSignal(vendor, place))
}

func hasPharmacyNameSignal(vendor vendorRow, place foursquarePlace) bool {
	raw := strings.ToLower(vendor.Name + " " + place.Name)
	for _, signal := range []string{"апотек", "фарма", "лек", "мед"} {
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
