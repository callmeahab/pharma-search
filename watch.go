package main

import (
	"net/http"
	"strings"
)

// A Watch tracks the cheapest offer of a product GROUP. The frontend supplies the
// current cheapest (it already has it from the search results), so adding a watch
// needs no group recomputation; the pricewatch job refreshes it later.

func (s *server) handleWatchList(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	rows, err := s.db.Query(`
		SELECT id, "groupKey", COALESCE("displayName",''), COALESCE(thumbnail,''),
		       "targetPrice", "lastPrice", COALESCE("lastVendor",''), "createdAt"
		FROM "Watch" WHERE "userId"=$1 ORDER BY "createdAt" DESC`, u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load watchlist")
		return
	}
	defer rows.Close()
	watches := []map[string]interface{}{}
	for rows.Next() {
		var id, groupKey, name, thumb, vendor string
		var target, last interface{}
		var createdAt interface{}
		if err := rows.Scan(&id, &groupKey, &name, &thumb, &target, &last, &vendor, &createdAt); err != nil {
			continue
		}
		watches = append(watches, map[string]interface{}{
			"id": id, "group_key": groupKey, "display_name": name, "thumbnail": thumb,
			"target_price": target, "last_price": last, "last_vendor": vendor, "created_at": createdAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"watches": watches})
}

func (s *server) handleWatchAdd(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var in struct {
		GroupKey    string   `json:"groupKey"`
		DisplayName string   `json:"displayName"`
		Thumbnail   string   `json:"thumbnail"`
		Price       *float64 `json:"price"`
		Vendor      string   `json:"vendor"`
		TargetPrice *float64 `json:"targetPrice"`
	}
	if err := readJSON(r, &in); err != nil || strings.TrimSpace(in.GroupKey) == "" {
		writeErr(w, http.StatusBadRequest, "invalid request")
		return
	}
	var id string
	err := s.db.QueryRow(`
		INSERT INTO "Watch" ("userId","groupKey","displayName","thumbnail","targetPrice","lastPrice","lastVendor")
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT ("userId","groupKey") DO UPDATE SET
		    "displayName"=EXCLUDED."displayName",
		    "thumbnail"=EXCLUDED."thumbnail",
		    "targetPrice"=COALESCE(EXCLUDED."targetPrice","Watch"."targetPrice"),
		    "lastPrice"=COALESCE(EXCLUDED."lastPrice","Watch"."lastPrice"),
		    "lastVendor"=COALESCE(EXCLUDED."lastVendor","Watch"."lastVendor")
		RETURNING id`,
		u.ID, in.GroupKey, strings.TrimSpace(in.DisplayName), strings.TrimSpace(in.Thumbnail),
		in.TargetPrice, in.Price, strings.TrimSpace(in.Vendor)).Scan(&id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save watch")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"id": id, "ok": true})
}

func (s *server) handleWatchRemove(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var in struct {
		ID       string `json:"id"`
		GroupKey string `json:"groupKey"`
	}
	if err := readJSON(r, &in); err != nil || (in.ID == "" && in.GroupKey == "") {
		writeErr(w, http.StatusBadRequest, "invalid request")
		return
	}
	if in.ID != "" {
		_, _ = s.db.Exec(`DELETE FROM "Watch" WHERE id=$1 AND "userId"=$2`, in.ID, u.ID)
	} else {
		_, _ = s.db.Exec(`DELETE FROM "Watch" WHERE "groupKey"=$1 AND "userId"=$2`, in.GroupKey, u.ID)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) handleWatchTarget(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var in struct {
		ID          string   `json:"id"`
		GroupKey    string   `json:"groupKey"`
		TargetPrice *float64 `json:"targetPrice"` // null clears the target
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request")
		return
	}
	var err error
	if in.ID != "" {
		_, err = s.db.Exec(`UPDATE "Watch" SET "targetPrice"=$1 WHERE id=$2 AND "userId"=$3`, in.TargetPrice, in.ID, u.ID)
	} else {
		_, err = s.db.Exec(`UPDATE "Watch" SET "targetPrice"=$1 WHERE "groupKey"=$2 AND "userId"=$3`, in.TargetPrice, in.GroupKey, u.ID)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update target")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleAlerts returns the user's recent price-alert notifications (in-app inbox).
func (s *server) handleAlerts(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	rows, err := s.db.Query(`
		SELECT a.kind, a."oldPrice", a."newPrice", COALESCE(a.vendor,''), a."sentAt",
		       COALESCE(w."displayName",''), COALESCE(w."groupKey",'')
		FROM "AlertEvent" a LEFT JOIN "Watch" w ON w.id = a."watchId"
		WHERE a."userId"=$1 ORDER BY a."sentAt" DESC LIMIT 50`, u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load alerts")
		return
	}
	defer rows.Close()
	alerts := []map[string]interface{}{}
	for rows.Next() {
		var kind, vendor, name, groupKey string
		var oldP, newP interface{}
		var sentAt interface{}
		if err := rows.Scan(&kind, &oldP, &newP, &vendor, &sentAt, &name, &groupKey); err != nil {
			continue
		}
		alerts = append(alerts, map[string]interface{}{
			"kind": kind, "old_price": oldP, "new_price": newP, "vendor": vendor,
			"sent_at": sentAt, "display_name": name, "group_key": groupKey,
		})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"alerts": alerts})
}

// handleWatchHistory returns the recorded cheapest-price points for a group so the
// frontend can draw a price-history sparkline. Public (no auth) — it's catalog data.
func (s *server) handleWatchHistory(w http.ResponseWriter, r *http.Request) {
	groupKey := strings.TrimSpace(r.URL.Query().Get("groupKey"))
	if groupKey == "" {
		writeErr(w, http.StatusBadRequest, "groupKey required")
		return
	}
	rows, err := s.db.Query(`
		SELECT "minPrice", "recordedAt" FROM "GroupPriceHistory"
		WHERE "groupKey"=$1 AND "recordedAt" > now() - interval '180 days'
		ORDER BY "recordedAt" ASC LIMIT 500`, groupKey)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load history")
		return
	}
	defer rows.Close()
	points := []map[string]interface{}{}
	for rows.Next() {
		var price float64
		var at interface{}
		if err := rows.Scan(&price, &at); err != nil {
			continue
		}
		points = append(points, map[string]interface{}{"min_price": price, "recorded_at": at})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"points": points})
}

func (s *server) registerWatchRoutes(mux *http.ServeMux) {
	guard := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if s.db == nil {
				writeErr(w, http.StatusServiceUnavailable, "database not connected")
				return
			}
			h(w, r)
		}
	}
	mux.HandleFunc("/api/watch", guard(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			s.handleWatchList(w, r)
		case http.MethodPost:
			s.handleWatchAdd(w, r)
		default:
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	}))
	mux.HandleFunc("/api/watch/remove", guard(s.handleWatchRemove))
	mux.HandleFunc("/api/watch/target", guard(s.handleWatchTarget))
	mux.HandleFunc("/api/watch/history", guard(s.handleWatchHistory))
	mux.HandleFunc("/api/alerts", guard(s.handleAlerts))
}
