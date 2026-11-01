package main

import (
	"context"
	"database/sql"
	"fmt"
	"html"
	"log"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/callmeahab/pharma-search/internal/matching"
)

// groupSnapshot is the cheapest current offer for a product group.
type groupSnapshot struct {
	MinPrice   float64
	Vendor     string
	OfferCount int
}

// computeGroupSnapshots prices the same persisted SKU identities and current
// offers as search. No query-dependent folding or legacy ingredient grouping.
func computeGroupSnapshots(db *sql.DB) (map[string]groupSnapshot, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, `SELECT p.sku_id,p.price,v.name FROM "CatalogOffer" p JOIN "CatalogSku" s ON s.id=p.sku_id JOIN "Vendor" v ON v.id=p."vendorId"
 WHERE p.price>0 AND p.availability<>'unavailable' AND p."priceScrapedAt">=$1 AND s.identity_version=$2 ORDER BY p.sku_id,p.price,p.id`, time.Now().Add(-currentOfferMaxAge()), matching.CatalogIdentityVersion)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	snap := map[string]groupSnapshot{}
	for rows.Next() {
		var key, vendor string
		var price float64
		if err = rows.Scan(&key, &price, &vendor); err != nil {
			return nil, err
		}
		value := snap[key]
		if value.OfferCount == 0 {
			value.MinPrice = price
			value.Vendor = vendor
		}
		value.OfferCount++
		snap[key] = value
	}
	return snap, rows.Err()
}

type watchRow struct {
	id, userID, email, displayName, groupKey string
	targetPrice, lastPrice                   sql.NullFloat64
}

// runPriceWatch refreshes the cheapest price for every watched group, records a
// price-history point, and emails users when their watch hits its target (or, with
// no target, when the price drops below the previously-seen baseline).
func (s *server) runPriceWatch() error {
	if s.db == nil {
		return fmt.Errorf("database not connected")
	}
	start := time.Now()

	// Load the watches FIRST. computeGroupSnapshots groups the entire catalog
	// (~105k groups) into memory and is expensive (seconds + a large transient
	// allocation) — doing it before checking for watchers meant a box with ZERO
	// watches still paid that cost on every run, and the memory spike tripped pm2's
	// max_memory_restart, crash-looping the backend. With no watches there is nothing
	// to price, so return before touching the catalog.
	rows, err := s.db.Query(`
		SELECT w.id, w."userId", u.email, COALESCE(w."displayName",''), w."groupKey",
		       w."targetPrice", w."lastPrice"
		FROM "Watch" w JOIN "User" u ON u.id = w."userId" WHERE NOT w.needs_review`)
	if err != nil {
		return err
	}
	var watches []watchRow
	for rows.Next() {
		var wr watchRow
		if err := rows.Scan(&wr.id, &wr.userID, &wr.email, &wr.displayName,
			&wr.groupKey, &wr.targetPrice, &wr.lastPrice); err != nil {
			continue
		}
		watches = append(watches, wr)
	}
	rows.Close()

	if len(watches) == 0 {
		log.Printf("pricewatch: 0 watches, skipped snapshot in %v", time.Since(start).Round(time.Millisecond))
		return nil
	}

	snap, err := computeGroupSnapshots(s.db)
	if err != nil {
		return fmt.Errorf("snapshot: %w", err)
	}

	alerts := 0
	for _, wr := range watches {
		gs, ok := snap[wr.groupKey]
		if !ok {
			continue // group no longer present (out of stock / re-extracted)
		}

		// Catalog-wide immutable observations are recorded by ingestion, not by the number of watchers.

		newPrice := gs.MinPrice
		var oldPrice *float64
		if wr.lastPrice.Valid {
			v := wr.lastPrice.Float64
			oldPrice = &v
		}

		kind := ""
		if wr.targetPrice.Valid {
			// Alert once, when crossing from above the target to at/below it.
			if newPrice <= wr.targetPrice.Float64 && (oldPrice == nil || *oldPrice > wr.targetPrice.Float64) {
				kind = "target"
			}
		} else if oldPrice != nil && newPrice < *oldPrice-0.001 {
			// No target: any genuine drop vs the last seen price.
			kind = "drop"
		}

		if kind != "" {
			_, err := s.db.Exec(
				`INSERT INTO "AlertEvent" ("watchId","userId",kind,"oldPrice","newPrice",vendor) VALUES ($1,$2,$3,$4,$5,$6)`,
				wr.id, wr.userID, kind, oldPrice, newPrice, gs.Vendor)
			if err == nil {
				alerts++
				s.sendPriceAlertEmail(wr, kind, oldPrice, newPrice, gs.Vendor)
			} else {
				log.Printf("pricewatch: alert insert failed for watch %s: %v", wr.id, err)
			}
		}

		// Refresh the baseline regardless (so price increases update silently).
		_, _ = s.db.Exec(`UPDATE "Watch" SET "lastPrice"=$1, "lastVendor"=$2 WHERE id=$3`,
			newPrice, gs.Vendor, wr.id)
	}

	log.Printf("pricewatch: %d watches, %d groups priced, %d alerts in %v",
		len(watches), len(snap), alerts, time.Since(start).Round(time.Millisecond))
	return nil
}

func (s *server) sendPriceAlertEmail(wr watchRow, kind string, oldPrice *float64, newPrice float64, vendor string) {
	if wr.email == "" {
		return
	}
	name := wr.displayName
	if name == "" {
		name = "praćeni proizvod"
	}
	intro := fmt.Sprintf("Cena za <strong>%s</strong> je pala!", html.EscapeString(name))
	if kind == "target" {
		intro = fmt.Sprintf("Cena za <strong>%s</strong> je dostigla vašu ciljnu cenu!", html.EscapeString(name))
	}
	oldStr := "—"
	if oldPrice != nil {
		oldStr = formatRSD(*oldPrice)
	}
	link := appURL() + "/proizvod/" + url.PathEscape(wr.groupKey)
	subject := "Apošteka: cena je pala — " + name
	body := fmt.Sprintf(`<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
  <p style="font-size:16px;color:#111">%s</p>
  <p style="font-size:15px;color:#333">
    Nova najniža cena: <strong style="color:#16a34a">%s</strong>%s<br/>
    Prethodno: <span style="text-decoration:line-through;color:#888">%s</span>
  </p>
  <p><a href="%s" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Pogledaj ponudu</a></p>
  <p style="font-size:12px;color:#999">Dobijate ovaj email jer pratite cenu ovog proizvoda na Apošteci.</p>
</div>`, intro, formatRSD(newPrice), vendorSuffix(vendor), oldStr, link)

	if err := sendMail(wr.email, subject, body); err != nil {
		log.Printf("pricewatch: email to %s failed: %v", wr.email, err)
	}
}

func vendorSuffix(vendor string) string {
	if vendor == "" {
		return ""
	}
	return " (" + html.EscapeString(vendor) + ")"
}

// formatRSD renders a price as "1.234 RSD" with a dot thousands separator.
func formatRSD(v float64) string {
	n := int64(v + 0.5)
	s := strconv.FormatInt(n, 10)
	neg := false
	if n < 0 {
		neg = true
		s = s[1:]
	}
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, c)
	}
	res := string(out)
	if neg {
		res = "-" + res
	}
	return res + " RSD"
}

// startPriceWatchLoop runs the price-watch job periodically in the background.
func (s *server) startPriceWatchLoop() {
	interval := 6 * time.Hour
	if v := getEnvDuration("PRICEWATCH_INTERVAL"); v > 0 {
		interval = v
	}
	// Initial run shortly after startup so the baseline is populated.
	time.Sleep(45 * time.Second)
	if err := s.runPriceWatch(); err != nil {
		log.Printf("pricewatch: initial run error: %v", err)
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		if err := s.runPriceWatch(); err != nil {
			log.Printf("pricewatch: run error: %v", err)
		}
	}
}

func getEnvDuration(key string) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return 0
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0
	}
	return d
}
