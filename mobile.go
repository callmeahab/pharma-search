package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	pb "github.com/callmeahab/pharma-search/gen"
)

func mobileLimit(r *http.Request, fallback, maxValue int) int {
	limit, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
	if err != nil || limit <= 0 {
		limit = fallback
	}
	if limit > maxValue {
		limit = maxValue
	}
	return limit
}

func mobileOffset(r *http.Request) int {
	offset, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("offset")))
	if err != nil || offset < 0 {
		return 0
	}
	return offset
}

func mobileQueryList(r *http.Request, key string) []string {
	var values []string
	for _, raw := range r.URL.Query()[key] {
		for _, part := range strings.Split(raw, ",") {
			if value := strings.TrimSpace(part); value != "" {
				values = append(values, value)
			}
		}
	}
	return values
}

func mobileFacetsJSON(facets map[string]*pb.FacetValues) map[string]map[string]int32 {
	out := make(map[string]map[string]int32, len(facets))
	for name, facet := range facets {
		if facet == nil {
			continue
		}
		out[name] = facet.Values
	}
	return out
}

func (s *server) handleMobileSearchGroups(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	offset := mobileOffset(r)
	limit := mobileLimit(r, 24, 60)
	brands := mobileQueryList(r, "brand")
	categories := mobileQueryList(r, "category")

	cached, err := s.cachedGroupedSearch(query, brands, categories)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not search products")
		return
	}

	totalGroups := len(cached.groups)
	start := min(offset, totalGroups)
	end := min(start+limit, totalGroups)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"groups":           cached.groups[start:end],
		"total_products":   cached.totalHits,
		"total_groups":     totalGroups,
		"offset":           offset,
		"limit":            limit,
		"search_type_used": "postgresql",
		"facets":           mobileFacetsJSON(cached.facets),
	})
}

func (s *server) handleMobileFeatured(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	limit := mobileLimit(r, 24, 60)
	groups := s.featuredCache
	if len(groups) == 0 {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		var err error
		groups, err = s.GetFeaturedProducts(ctx, limit)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not load featured products")
			return
		}
	}
	if len(groups) > limit {
		groups = groups[:limit]
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"groups": groups,
		"total":  len(groups),
		"offset": 0,
		"limit":  limit,
	})
}

func (s *server) handleMobileFacets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	facets := map[string]interface{}{}
	if vendorRows, err := s.db.Query(`SELECT v.name, COUNT(*) FROM "Product" p JOIN "Vendor" v ON v.id = p."vendorId" GROUP BY v.name ORDER BY COUNT(*) DESC`); err == nil {
		values := map[string]interface{}{}
		for vendorRows.Next() {
			var name string
			var count int
			if err := vendorRows.Scan(&name, &count); err == nil {
				values[name] = count
			}
		}
		vendorRows.Close()
		facets["vendorName"] = values
	}
	if brandRows, err := s.db.Query(`SELECT "extractedBrand", COUNT(*) FROM "Product" WHERE "extractedBrand" IS NOT NULL AND "extractedBrand" != '' GROUP BY "extractedBrand" ORDER BY COUNT(*) DESC LIMIT 200`); err == nil {
		values := map[string]interface{}{}
		for brandRows.Next() {
			var name string
			var count int
			if err := brandRows.Scan(&name, &count); err == nil {
				values[name] = count
			}
		}
		brandRows.Close()
		facets["brand"] = values
	}
	if categoryRows, err := s.db.Query(`SELECT "canonicalCategory", COUNT(*) FROM "Product" WHERE "canonicalCategory" IS NOT NULL AND "canonicalCategory" != '' GROUP BY "canonicalCategory" ORDER BY COUNT(*) DESC`); err == nil {
		values := map[string]interface{}{}
		for categoryRows.Next() {
			var name string
			var count int
			if err := categoryRows.Scan(&name, &count); err == nil {
				values[name] = count
			}
		}
		categoryRows.Close()
		facets["category"] = values
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"facets": facets})
}

func (s *server) handleMobileAutocomplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := mobileLimit(r, 8, 20)
	if query == "" {
		writeJSON(w, http.StatusOK, map[string]interface{}{"suggestions": []interface{}{}, "query": query, "limit": limit})
		return
	}

	suggestions, err := autocompleteDB(s.db, query, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not autocomplete products")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"suggestions": suggestions, "query": query, "limit": limit})
}

func (s *server) handleMobilePriceComparison(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeErr(w, http.StatusBadRequest, "q required")
		return
	}

	hits, err := searchProductsDB(s.db, query, 5000, nil, nil)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not compare prices")
		return
	}
	groups := convertHitsToGroups(hits, query, s.db)
	totalGroups := len(groups)
	if len(groups) > 10 {
		groups = groups[:10]
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"query":        query,
		"groups":       groups,
		"total_groups": totalGroups,
	})
}

func normalizeMobilePlatform(platform string) string {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "ios", "apns", "apple":
		return "ios"
	case "android", "fcm":
		return "android"
	default:
		return ""
	}
}

func (s *server) handleMobilePushToken(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var in struct {
		Platform   string `json:"platform"`
		Token      string `json:"token"`
		DeviceID   string `json:"deviceId"`
		AppVersion string `json:"appVersion"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request")
		return
	}

	platform := normalizeMobilePlatform(in.Platform)
	token := strings.TrimSpace(in.Token)
	if platform == "" || token == "" || len(token) > 4096 {
		writeErr(w, http.StatusBadRequest, "invalid push token")
		return
	}
	deviceID := strings.TrimSpace(in.DeviceID)
	appVersion := strings.TrimSpace(in.AppVersion)

	switch r.Method {
	case http.MethodPost, http.MethodPut:
		var id string
		err := s.db.QueryRow(`
			INSERT INTO "MobilePushToken" ("userId", platform, token, "deviceId", "appVersion")
			VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''))
			ON CONFLICT (platform, token) DO UPDATE SET
			    "userId"=$1,
			    "deviceId"=COALESCE(NULLIF($4, ''), "MobilePushToken"."deviceId"),
			    "appVersion"=COALESCE(NULLIF($5, ''), "MobilePushToken"."appVersion"),
			    "lastSeenAt"=now(),
			    "disabledAt"=NULL
			RETURNING id`,
			u.ID, platform, token, deviceID, appVersion).Scan(&id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not save push token")
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"id": id, "ok": true})
	case http.MethodDelete:
		_, err := s.db.Exec(`
			UPDATE "MobilePushToken" SET "disabledAt"=now(), "lastSeenAt"=now()
			WHERE "userId"=$1 AND platform=$2 AND token=$3`,
			u.ID, platform, token)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not remove push token")
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *server) registerMobileRoutes(mux *http.ServeMux) {
	guard := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if s.db == nil {
				writeErr(w, http.StatusServiceUnavailable, "database not connected")
				return
			}
			h(w, r)
		}
	}

	mux.HandleFunc("/api/mobile/search/groups", guard(s.handleMobileSearchGroups))
	mux.HandleFunc("/api/mobile/featured", guard(s.handleMobileFeatured))
	mux.HandleFunc("/api/mobile/facets", guard(s.handleMobileFacets))
	mux.HandleFunc("/api/mobile/autocomplete", guard(s.handleMobileAutocomplete))
	mux.HandleFunc("/api/mobile/price-comparison", guard(s.handleMobilePriceComparison))
	mux.HandleFunc("/api/mobile/push-token", guard(s.handleMobilePushToken))
}
