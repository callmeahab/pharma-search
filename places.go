package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"
)

// handleVendorPlaces returns imported physical locations for vendors with priced
// products. Foursquare data is cached in VendorPlace by cmd/fetchplaces so the
// public API never exposes the Foursquare key or calls Foursquare from browsers.
func (s *server) handleVendorPlaces(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeErr(w, http.StatusServiceUnavailable, "database not connected")
		return
	}
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	rows, err := s.db.Query(`
		WITH product_counts AS (
			SELECT "vendorId", count(*) AS product_count
			FROM "Product"
			WHERE price > 0
			GROUP BY "vendorId"
		)
		SELECT
			vp.id, vp."vendorId", v.name AS vendor_name, COALESCE(v.website, '') AS vendor_website,
			COALESCE(v.logo, '') AS vendor_logo, COALESCE(pc.product_count, 0) AS product_count,
			vp."foursquareId", vp.name, COALESCE(vp.address, ''), COALESCE(vp.locality, ''),
			COALESCE(vp.region, ''), COALESCE(vp.postcode, ''), COALESCE(vp.country, ''),
			COALESCE(vp."formattedAddress", ''), COALESCE(vp.phone, ''), COALESCE(vp.email, ''),
			COALESCE(vp.website, ''), COALESCE(vp."hoursDisplay", ''), vp."openNow",
			vp.latitude, vp.longitude, vp.rating, vp.popularity, vp.price,
			COALESCE(vp."mapsUrl", ''), COALESCE(vp.categories, '[]'::jsonb)::text,
			vp."fetchedAt"
		FROM "VendorPlace" vp
		JOIN "Vendor" v ON v.id = vp."vendorId"
		JOIN product_counts pc ON pc."vendorId" = v.id
		WHERE EXISTS (
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
						OR lower(v.name) LIKE '%apotek%'
						OR lower(v.name) LIKE '%апотек%'
						OR lower(v.name) LIKE '%pharm%'
						OR lower(v.name) LIKE '%фарм%'
						OR lower(v.name) LIKE '%farmaci%'
						OR lower(v.name) LIKE '%drogerie%'
						OR lower(v.name) LIKE '%drugstore%'
						OR lower(v.name) LIKE '%benu%'
						OR lower(v.name) LIKE '%dr max%'
						OR lower(v.name) LIKE '%lilly%'
						OR lower(v.name) LIKE '%lily%'
						OR lower(v.name) LIKE '%srbotrade%'
						OR lower(v.name) LIKE '%zdravlja%'
						OR lower(v.name) LIKE '%lek%'
						OR lower(v.name) LIKE '%лек%'
						OR lower(v.name) LIKE '%med%'
						OR lower(v.name) LIKE '%мед%'
						OR lower(v.name) LIKE '%vita%'
					)
			   )
		)
		ORDER BY v.name ASC, COALESCE(vp.locality, '') ASC, vp.name ASC`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load vendor places")
		return
	}
	defer rows.Close()

	places := []map[string]interface{}{}
	for rows.Next() {
		var id, vendorID, vendorName, vendorWebsite, vendorLogo, foursquareID, name string
		var address, city, region, postcode, country, formattedAddress, phone, email, website, hoursDisplay, mapsURL string
		var categoriesJSON string
		var productCount int
		var openNow sql.NullBool
		var latitude, longitude float64
		var rating, popularity sql.NullFloat64
		var price sql.NullInt64
		var fetchedAt time.Time

		if err := rows.Scan(&id, &vendorID, &vendorName, &vendorWebsite, &vendorLogo, &productCount,
			&foursquareID, &name, &address, &city, &region, &postcode, &country, &formattedAddress,
			&phone, &email, &website, &hoursDisplay, &openNow, &latitude, &longitude, &rating,
			&popularity, &price, &mapsURL, &categoriesJSON, &fetchedAt); err != nil {
			continue
		}

		places = append(places, map[string]interface{}{
			"id":                id,
			"vendor_id":         vendorID,
			"vendor_name":       vendorName,
			"vendor_website":    vendorWebsite,
			"vendor_logo":       vendorLogo,
			"product_count":     productCount,
			"foursquare_id":     foursquareID,
			"name":              name,
			"address":           address,
			"city":              city,
			"region":            region,
			"postcode":          postcode,
			"country":           country,
			"formatted_address": formattedAddress,
			"phone":             phone,
			"email":             email,
			"website":           website,
			"hours_display":     hoursDisplay,
			"open_now":          nullableBoolValue(openNow),
			"latitude":          latitude,
			"longitude":         longitude,
			"rating":            nullableFloatValue(rating),
			"popularity":        nullableFloatValue(popularity),
			"price":             nullableIntValue(price),
			"maps_url":          mapsURL,
			"categories":        categoryNames(categoriesJSON),
			"fetched_at":        fetchedAt.UTC().Format(time.RFC3339),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"places": places})
}

func categoryNames(raw string) []string {
	var categories []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal([]byte(raw), &categories); err != nil {
		return []string{}
	}
	names := []string{}
	for _, category := range categories {
		if category.Name != "" {
			names = append(names, category.Name)
		}
	}
	return names
}

func nullableBoolValue(v sql.NullBool) interface{} {
	if !v.Valid {
		return nil
	}
	return v.Bool
}

func nullableFloatValue(v sql.NullFloat64) interface{} {
	if !v.Valid {
		return nil
	}
	return v.Float64
}

func nullableIntValue(v sql.NullInt64) interface{} {
	if !v.Valid {
		return nil
	}
	return v.Int64
}
