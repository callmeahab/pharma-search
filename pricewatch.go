package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/url"
	"os"
	"strconv"
	"time"
)

// groupSnapshot is the cheapest current offer for a product group.
type groupSnapshot struct {
	MinPrice   float64
	Vendor     string
	OfferCount int
}

// loadAllProductsForGrouping loads every in-stock product with the fields the
// grouping pipeline needs (same map shape as searchProductsDB rows).
func loadAllProductsForGrouping(db *sql.DB) ([]map[string]interface{}, error) {
	rows, err := db.Query(`
		SELECT p.id, p.title, p.price, p."vendorId", v.name,
		       p.link, COALESCE(p.thumbnail,''), COALESCE(p."extractedBrand",''),
		       COALESCE(p."normalizedName",''), COALESCE(p."coreProductIdentity",''),
		       p."dosageValue", COALESCE(p."dosageUnit",''),
		       p."volumeValue", COALESCE(p."volumeUnit",''),
		       COALESCE(p.form,''), p."quantityValue"
		FROM "Product" p JOIN "Vendor" v ON v.id = p."vendorId"
		WHERE p.price > 0`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []map[string]interface{}
	for rows.Next() {
		var id, title, vendorID, vendorName, link, thumbnail string
		var brand, normalizedName, core, dosageUnit, volumeUnit, form string
		var price, dosageValue, volumeValue sql.NullFloat64
		var quantityValue sql.NullInt64
		if err := rows.Scan(&id, &title, &price, &vendorID, &vendorName, &link, &thumbnail,
			&brand, &normalizedName, &core, &dosageValue, &dosageUnit,
			&volumeValue, &volumeUnit, &form, &quantityValue); err != nil {
			return nil, err
		}
		out = append(out, map[string]interface{}{
			"id": id, "title": title, "price": nullF(price), "vendorId": vendorID,
			"vendorName": vendorName, "link": link, "thumbnail": thumbnail,
			"brand": brand, "normalizedName": normalizedName, "coreProductIdentity": core,
			"dosageValue": dosageValue.Float64, "dosageUnit": dosageUnit,
			"volumeValue": volumeValue.Float64, "volumeUnit": volumeUnit,
			"form": form, "quantityValue": float64(quantityValue.Int64),
		})
	}
	return out, rows.Err()
}

func nullF(v sql.NullFloat64) float64 {
	if v.Valid {
		return v.Float64
	}
	return 0
}

// computeGroupSnapshots runs the exact same grouping pipeline the search API uses
// (BuildGroupKey + the sizeless/formless folding passes) over the whole catalog,
// then reduces each group to its current cheapest offer. The keys it produces are
// identical to what the frontend stored as a watch's groupKey.
func computeGroupSnapshots(db *sql.DB) (map[string]groupSnapshot, error) {
	hits, err := loadAllProductsForGrouping(db)
	if err != nil {
		return nil, err
	}
	products := enrichProductsWithGroupKey(hits)
	attachSizelessToLines(products)
	attachFormlessToDominantForm(products)

	snap := make(map[string]groupSnapshot, len(products)/2)
	for _, p := range products {
		gk := getString(p, "group_key")
		if gk == "" {
			continue
		}
		price := getFloat(p, "price")
		if price <= 0 {
			continue
		}
		cur, ok := snap[gk]
		if !ok {
			snap[gk] = groupSnapshot{MinPrice: price, Vendor: getString(p, "vendor_name"), OfferCount: 1}
			continue
		}
		cur.OfferCount++
		if price < cur.MinPrice {
			cur.MinPrice = price
			cur.Vendor = getString(p, "vendor_name")
		}
		snap[gk] = cur
	}
	return snap, nil
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

	snap, err := computeGroupSnapshots(s.db)
	if err != nil {
		return fmt.Errorf("snapshot: %w", err)
	}

	rows, err := s.db.Query(`
		SELECT w.id, w."userId", u.email, COALESCE(w."displayName",''), w."groupKey",
		       w."targetPrice", w."lastPrice"
		FROM "Watch" w JOIN "User" u ON u.id = w."userId"`)
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

	historyDone := map[string]bool{}
	alerts := 0
	for _, wr := range watches {
		gs, ok := snap[wr.groupKey]
		if !ok {
			continue // group no longer present (out of stock / re-extracted)
		}

		// One history point per distinct watched group per run.
		if !historyDone[wr.groupKey] {
			historyDone[wr.groupKey] = true
			_, _ = s.db.Exec(
				`INSERT INTO "GroupPriceHistory" ("groupKey","minPrice","offerCount") VALUES ($1,$2,$3)`,
				wr.groupKey, gs.MinPrice, gs.OfferCount)
		}

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
	intro := fmt.Sprintf("Cena za <strong>%s</strong> je pala!", name)
	if kind == "target" {
		intro = fmt.Sprintf("Cena za <strong>%s</strong> je dostigla vašu ciljnu cenu!", name)
	}
	oldStr := "—"
	if oldPrice != nil {
		oldStr = formatRSD(*oldPrice)
	}
	link := appURL() + "/?q=" + url.QueryEscape(name)
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
	return " (" + vendor + ")"
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
