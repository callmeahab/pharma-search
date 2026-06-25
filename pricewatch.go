package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/callmeahab/pharma-search/internal/matching"
)

// groupSnapshot is the cheapest current offer for a product group.
type groupSnapshot struct {
	MinPrice   float64
	Vendor     string
	OfferCount int
}

// liteOffer is the MINIMAL per-product state the snapshot needs. The whole catalog
// (~184k rows) is held at once, so this must stay lean: the old map[string]interface{}
// representation spiked RSS to ~855MB and crash-looped the backend on the 2GB box.
// Only the fields that the folding passes and the cheapest-offer reduction read are
// kept; everything else (title, brand, dosage, …) is consumed when the key is computed
// and then dropped. vendorID/vendorName/method are interned (≤80 vendors, ~5 methods).
type liteOffer struct {
	price      float64
	vendorID   string
	vendorName string
	key        string
	method     string
	residual   string
	hasMeasure bool
}

// computeGroupSnapshots groups the whole catalog the same way the search API does
// (matching.BuildGroupKey + the sizeless/formless folding passes) and reduces each
// group to its current cheapest offer. The keys it produces are identical to what the
// frontend stored as a watch's groupKey — including canonicalIdentity, which the search
// path uses, so canonicalIdentity-grouped products (protein/probiotik lines) match too.
func computeGroupSnapshots(db *sql.DB) (map[string]groupSnapshot, error) {
	rows, err := db.Query(`
		SELECT p.price, p."vendorId", v.name, p.title,
		       COALESCE(p."extractedBrand",''), COALESCE(p."coreProductIdentity",''),
		       COALESCE(p."canonicalIdentity",''),
		       p."dosageValue", COALESCE(p."dosageUnit",''),
		       p."volumeValue", COALESCE(p."volumeUnit",''),
		       COALESCE(p.form,''), p."quantityValue", p.id
		FROM "Product" p JOIN "Vendor" v ON v.id = p."vendorId"
		WHERE p.price > 0`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	pool := map[string]string{}
	intern := func(s string) string {
		if v, ok := pool[s]; ok {
			return v
		}
		pool[s] = s
		return s
	}

	offers := make([]liteOffer, 0, 200000)
	for rows.Next() {
		var price, dosageValue, volumeValue sql.NullFloat64
		var quantityValue sql.NullInt64
		var vendorID, vendorName, title, brand, core, canonical, dosageUnit, volumeUnit, form, id string
		if err := rows.Scan(&price, &vendorID, &vendorName, &title, &brand, &core, &canonical,
			&dosageValue, &dosageUnit, &volumeValue, &volumeUnit, &form, &quantityValue, &id); err != nil {
			return nil, err
		}
		gk := matching.BuildGroupKey(matching.GroupKeyInput{
			Core:              core,
			CanonicalIdentity: canonical,
			Brand:             brand,
			Title:             title,
			ProductID:         strings.ReplaceAll(id, "product_", ""),
			DosageValue:       dosageValue.Float64,
			DosageUnit:        dosageUnit,
			VolumeValue:       volumeValue.Float64,
			VolumeUnit:        volumeUnit,
			Quantity:          float64(quantityValue.Int64),
			Form:              form,
		})
		offers = append(offers, liteOffer{
			price:      price.Float64,
			vendorID:   intern(vendorID),
			vendorName: intern(vendorName),
			key:        gk.Key,
			method:     intern(gk.Method),
			residual:   gk.Residual,
			hasMeasure: gk.HasMeasure,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	foldSizelessToLines(offers)
	foldFormlessToDominantForm(offers)

	snap := make(map[string]groupSnapshot, len(offers)/2)
	for i := range offers {
		o := &offers[i]
		if o.key == "" || o.price <= 0 {
			continue
		}
		cur, ok := snap[o.key]
		if !ok {
			snap[o.key] = groupSnapshot{MinPrice: o.price, Vendor: o.vendorName, OfferCount: 1}
			continue
		}
		cur.OfferCount++
		if o.price < cur.MinPrice {
			cur.MinPrice = o.price
			cur.Vendor = o.vendorName
		}
		snap[o.key] = cur
	}
	return snap, nil
}

// foldSizelessToLines is the lean-struct twin of attachSizelessToLines (main.go): a
// sizeless brand-sku/single offer whose 2+-token residual matches a brand-LINE residual
// folds into that line's brand-independent prod:: key.
func foldSizelessToLines(offers []liteOffer) {
	lineResiduals := map[string]bool{}
	for i := range offers {
		if offers[i].method == "brand-line" && offers[i].residual != "" {
			lineResiduals[offers[i].residual] = true
		}
	}
	if len(lineResiduals) == 0 {
		return
	}
	for i := range offers {
		m := offers[i].method
		if m != "brand-sku" && m != "single" {
			continue
		}
		if offers[i].hasMeasure {
			continue // has a size/strength of its own — keep it
		}
		r := offers[i].residual
		if r == "" || !lineResiduals[r] || len(strings.Fields(r)) < 2 {
			continue
		}
		offers[i].key = "prod::" + r
	}
}

// foldFormlessToDominantForm is the lean-struct twin of attachFormlessToDominantForm
// (main.go): a form-unknown ingredient group folds into the most-stocked form variant
// of the same ingredient+strength.
func foldFormlessToDominantForm(offers []liteOffer) {
	const sep = "::form:"
	baseForms := map[string]map[string]map[string]struct{}{}
	for i := range offers {
		if offers[i].method != "ingredient" {
			continue
		}
		k := offers[i].key
		idx := strings.Index(k, sep)
		if idx < 0 {
			continue // formless — counted as a target only, not a form variant
		}
		base := k[:idx]
		if baseForms[base] == nil {
			baseForms[base] = map[string]map[string]struct{}{}
		}
		if baseForms[base][k] == nil {
			baseForms[base][k] = map[string]struct{}{}
		}
		baseForms[base][k][offers[i].vendorID] = struct{}{}
	}
	if len(baseForms) == 0 {
		return
	}
	dominant := make(map[string]string, len(baseForms))
	for base, forms := range baseForms {
		bestKey, bestN := "", -1
		for fk, vendors := range forms {
			if n := len(vendors); n > bestN || (n == bestN && fk < bestKey) {
				bestN, bestKey = n, fk
			}
		}
		dominant[base] = bestKey
	}
	for i := range offers {
		if offers[i].method != "ingredient" {
			continue
		}
		k := offers[i].key
		if strings.Contains(k, sep) {
			continue // already has a form
		}
		if dk, ok := dominant[k]; ok {
			offers[i].key = dk
		}
	}
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

	if len(watches) == 0 {
		log.Printf("pricewatch: 0 watches, skipped snapshot in %v", time.Since(start).Round(time.Millisecond))
		return nil
	}

	snap, err := computeGroupSnapshots(s.db)
	if err != nil {
		return fmt.Errorf("snapshot: %w", err)
	}

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
