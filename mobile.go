package main

import (
	"net/http"
	"strconv"
	"strings"

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
		writeErr(w, 405, "method not allowed")
		return
	}
	request := catalogRequestFromURL(r)
	request.AllOffers = true
	request.Limit = mobileLimit(r, 24, 60)
	page, e := s.catalogSearch(r.Context(), request)
	if e != nil {
		catalogHTTPError(w, e)
		return
	}
	writeJSON(w, 200, page.asMap())
}

func (s *server) handleMobileFeatured(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "method not allowed")
		return
	}
	page, e := s.catalogSearch(r.Context(), catalogRequest{Limit: mobileLimit(r, 24, 60), Sort: "coverage", AllOffers: true})
	if e != nil {
		catalogHTTPError(w, e)
		return
	}
	writeJSON(w, 200, page.asMap())
}

func (s *server) handleMobileFacets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "method not allowed")
		return
	}
	page, e := s.catalogSearch(r.Context(), catalogRequest{Limit: 1})
	if e != nil {
		catalogHTTPError(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"facets": mobileFacetsJSON(page.Facets)})
}

func (s *server) handleMobileAutocomplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "method not allowed")
		return
	}
	response, e := s.catalogAutocomplete(r.Context(), r.URL.Query().Get("q"), mobileLimit(r, 8, 20))
	if e != nil {
		catalogHTTPError(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"suggestions": response.Suggestions, "query": response.Query, "limit": response.Limit, "corrected_query": response.CorrectedQuery})
}

func (s *server) handleMobilePriceComparison(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "method not allowed")
		return
	}
	request := catalogRequestFromURL(r)
	request.Limit = 10
	request.AllOffers = true
	if strings.HasPrefix(request.Query, "sku:v2:") || strings.HasPrefix(request.Query, "offer:v2:") {
		request.Filters.SKUID = request.Query
		request.Query = ""
		request.Limit = 1
	}
	page, e := s.catalogSearch(r.Context(), request)
	if e != nil {
		catalogHTTPError(w, e)
		return
	}
	writeJSON(w, 200, page.asMap())
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
