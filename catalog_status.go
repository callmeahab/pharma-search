package main

import (
	"context"
	"net/http"
	"time"

	"github.com/callmeahab/pharma-search/internal/matching"
)

var buildVersion = "development"

func (s *server) handleCatalogStatus(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeErr(w, 503, "catalog unavailable")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var generation string
	var published time.Time
	if e := s.db.QueryRowContext(ctx, `SELECT run_id,published_at FROM "CatalogPublication" WHERE id=1`).Scan(&generation, &published); e != nil {
		writeErr(w, 503, "catalog unavailable")
		return
	}
	var offers, skus, currentOffers, currentSKUs int
	e := s.db.QueryRowContext(ctx, `SELECT count(*),count(DISTINCT sku_id),count(*) FILTER(WHERE price>0 AND availability<>'unavailable' AND "priceScrapedAt">=$1),count(DISTINCT sku_id) FILTER(WHERE price>0 AND availability<>'unavailable' AND "priceScrapedAt">=$1) FROM "CatalogOffer"`, time.Now().Add(-currentOfferMaxAge())).Scan(&offers, &skus, &currentOffers, &currentSKUs)
	if e != nil {
		catalogHTTPError(w, e)
		return
	}
	type sourceStatus struct {
		Name    string     `json:"name"`
		Offers  int        `json:"offers"`
		Current int        `json:"current_offers"`
		Last    *time.Time `json:"last_observed"`
	}
	sources := []sourceStatus{}
	rows, e := s.db.QueryContext(ctx, `SELECT v.name,count(*),count(*) FILTER(WHERE p.price>0 AND p.availability<>'unavailable' AND p."priceScrapedAt">=$1),max(p."priceScrapedAt") FROM "CatalogOffer" p JOIN "Vendor" v ON v.id=p."vendorId" GROUP BY v.id ORDER BY v.name`, time.Now().Add(-currentOfferMaxAge()))
	if e != nil {
		catalogHTTPError(w, e)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var src sourceStatus
		if e = rows.Scan(&src.Name, &src.Offers, &src.Current, &src.Last); e != nil {
			catalogHTTPError(w, e)
			return
		}
		sources = append(sources, src)
	}
	if e = rows.Err(); e != nil {
		catalogHTTPError(w, e)
		return
	}
	type sourceRun struct {
		Scraper  string    `json:"scraper"`
		Status   string    `json:"status"`
		Finished time.Time `json:"finished_at"`
		Products int       `json:"products"`
	}
	runs := []sourceRun{}
	runRows, e := s.db.QueryContext(ctx, `SELECT DISTINCT ON(scraper) scraper,status,finished_at,products FROM "ScraperRun" ORDER BY scraper,finished_at DESC`)
	if e != nil {
		catalogHTTPError(w, e)
		return
	}
	defer runRows.Close()
	for runRows.Next() {
		var v sourceRun
		if e = runRows.Scan(&v.Scraper, &v.Status, &v.Finished, &v.Products); e != nil {
			catalogHTTPError(w, e)
			return
		}
		runs = append(runs, v)
	}
	if e = runRows.Err(); e != nil {
		catalogHTTPError(w, e)
		return
	}

	writeJSON(w, 200, map[string]any{"source_runs": runs, "sources": sources, "catalog_version": generation, "identity_version": matching.CatalogIdentityVersion, "dictionary_version": matching.DictionaryVersion, "build_version": buildVersion, "published_at": published, "offers": offers, "skus": skus, "current_offers": currentOffers, "current_skus": currentSKUs, "offer_max_age_hours": currentOfferMaxAge().Hours()})
}
