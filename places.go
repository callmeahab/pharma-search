package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
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
			COALESCE(vp.photos, '[]'::jsonb)::text,
			vp."fetchedAt"
		FROM "VendorPlace" vp
		JOIN "Vendor" v ON v.id = vp."vendorId"
		JOIN product_counts pc ON pc."vendorId" = v.id
		WHERE (
			EXISTS (
				SELECT 1
				FROM jsonb_to_recordset(vp.categories) AS c(fsq_category_id text, id text, name text)
				WHERE c.fsq_category_id = '5745c2e4498e11e7bccabdbd'
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
			OR lower(vp.name || ' ' || v.name) LIKE '%apotek%'
			OR lower(vp.name || ' ' || v.name) LIKE '%апотек%'
			OR lower(vp.name || ' ' || v.name) LIKE '%pharm%'
			OR lower(vp.name || ' ' || v.name) LIKE '%фарм%'
			OR lower(vp.name || ' ' || v.name) LIKE '%farmaci%'
			OR lower(vp.name || ' ' || v.name) LIKE '%drogerie%'
			OR lower(vp.name || ' ' || v.name) LIKE '%drugstore%'
			OR lower(vp.name || ' ' || v.name) LIKE '%benu%'
			OR lower(vp.name || ' ' || v.name) LIKE '%dr max%'
			OR lower(vp.name || ' ' || v.name) LIKE '%lilly%'
			OR lower(vp.name || ' ' || v.name) LIKE '%lily%'
			OR lower(vp.name || ' ' || v.name) LIKE '%srbotrade%'
			OR lower(vp.name || ' ' || v.name) LIKE '%zdravlja%'
			OR lower(vp.name || ' ' || v.name) LIKE '%lek%'
			OR lower(vp.name || ' ' || v.name) LIKE '%лек%'
			OR lower(vp.name || ' ' || v.name) LIKE '%med%'
			OR lower(vp.name || ' ' || v.name) LIKE '%мед%'
			OR lower(vp.name || ' ' || v.name) LIKE '%vita%'
			OR lower(vp.name || ' ' || v.name) LIKE '%vitamin%'
			OR lower(vp.name || ' ' || v.name) LIKE '%suplement%'
			OR lower(vp.name || ' ' || v.name) LIKE '%supplement%'
			OR lower(vp.name || ' ' || v.name) LIKE '%protein%'
			OR lower(vp.name || ' ' || v.name) LIKE '%proteini%'
			OR lower(vp.name || ' ' || v.name) LIKE '%sport%'
			OR lower(vp.name || ' ' || v.name) LIKE '%fitness%'
			OR lower(vp.name || ' ' || v.name) LIKE '%fitlab%'
			OR lower(vp.name || ' ' || v.name) LIKE '%gym%'
			OR lower(vp.name || ' ' || v.name) LIKE '%pansport%'
			OR lower(vp.name || ' ' || v.name) LIKE '%titanium%'
			OR lower(vp.name || ' ' || v.name) LIKE '%superior%'
			OR lower(v.name) = 'dm'
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
		var categoriesJSON, photosJSON string
		var productCount int
		var openNow sql.NullBool
		var latitude, longitude float64
		var rating, popularity sql.NullFloat64
		var price sql.NullInt64
		var fetchedAt time.Time

		if err := rows.Scan(&id, &vendorID, &vendorName, &vendorWebsite, &vendorLogo, &productCount,
			&foursquareID, &name, &address, &city, &region, &postcode, &country, &formattedAddress,
			&phone, &email, &website, &hoursDisplay, &openNow, &latitude, &longitude, &rating,
			&popularity, &price, &mapsURL, &categoriesJSON, &photosJSON, &fetchedAt); err != nil {
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
			"photos":            placePhotos(photosJSON),
			"fetched_at":        fetchedAt.UTC().Format(time.RFC3339),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"places": places})
}

func placePhotos(raw string) []map[string]interface{} {
	var photos []struct {
		ID        string `json:"id"`
		Prefix    string `json:"prefix"`
		Suffix    string `json:"suffix"`
		URL       string `json:"url"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
		CreatedAt string `json:"created_at"`
	}
	if err := json.Unmarshal([]byte(raw), &photos); err != nil {
		return []map[string]interface{}{}
	}

	out := []map[string]interface{}{}
	for _, photo := range photos {
		originalURL := strings.TrimSpace(photo.URL)
		if originalURL == "" {
			originalURL = foursquarePhotoURL(photo.Prefix, photo.Suffix, "original")
		}
		if originalURL == "" {
			continue
		}

		item := map[string]interface{}{
			"url":          originalURL,
			"original_url": originalURL,
		}
		if photo.ID != "" {
			item["id"] = photo.ID
		}
		if photo.Width > 0 {
			item["width"] = photo.Width
		}
		if photo.Height > 0 {
			item["height"] = photo.Height
		}
		if photo.CreatedAt != "" {
			item["created_at"] = photo.CreatedAt
		}
		if thumbURL := foursquarePhotoURL(photo.Prefix, photo.Suffix, "300x300"); thumbURL != "" {
			item["thumbnail_url"] = thumbURL
		}
		out = append(out, item)
	}
	return out
}

func foursquarePhotoURL(prefix, suffix, size string) string {
	prefix = strings.TrimSpace(prefix)
	suffix = strings.TrimSpace(suffix)
	if prefix == "" || suffix == "" {
		return ""
	}
	return prefix + size + suffix
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
