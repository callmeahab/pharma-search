package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/callmeahab/pharma-search/internal/matching"
)

func sourceProductID(link string) string {
	u, err := url.Parse(strings.TrimSpace(link))
	if err != nil {
		return strings.TrimSpace(link)
	}
	u.Fragment = ""
	q := u.Query()
	for k := range q {
		if strings.HasPrefix(strings.ToLower(k), "utm_") || k == "fbclid" || k == "gclid" {
			q.Del(k)
		}
	}
	u.RawQuery = q.Encode()
	return u.String()
}

func currentOfferMaxAge() time.Duration {
	if age := getEnvDuration("OFFER_MAX_AGE"); age > 0 {
		return age
	}
	return 7 * 24 * time.Hour
}

// rebuildCatalog materializes stable SKU identities and records source evidence
// in a single transaction. A failed rebuild leaves the published catalog intact.
func rebuildCatalog(ctx context.Context, db *sql.DB) (err error) {
	var runID string
	err = db.QueryRowContext(ctx, `INSERT INTO "CatalogRun" (status,identity_version) VALUES ('running',$1) RETURNING id`, matching.CatalogIdentityVersion).Scan(&runID)
	if err != nil {
		return err
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("catalog rebuild failed: %v", recovered)
		}
		if err != nil {
			_, _ = db.ExecContext(context.Background(), `UPDATE "CatalogRun" SET status='error',finished_at=now(),details=jsonb_build_object('error',$2::text) WHERE id=$1`, runID, err.Error())
		}
	}()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('pharma-catalog-rebuild'))`); err != nil {
		return err
	}
	aliases := map[string]map[string]bool{}
	addAlias := func(legacy, sku string) {
		if legacy == "" {
			return
		}
		if aliases[legacy] == nil {
			aliases[legacy] = map[string]bool{}
		}
		aliases[legacy][sku] = true
	}
	lastID := ""
	total := 0
	comparable := 0
	for {
		rows, e := tx.QueryContext(ctx, `SELECT id,title,"vendorId",link,COALESCE(source_product_id,''),gtin,
			COALESCE("extractedBrand",''),COALESCE("coreProductIdentity",''),COALESCE("canonicalIdentity",''),
			"dosageValue",COALESCE("dosageUnit",''),"volumeValue",COALESCE("volumeUnit",''),"quantityValue",COALESCE(form,''),COALESCE("canonicalCategory",'')
			FROM "Product" WHERE id>$1 ORDER BY id LIMIT 2000`, lastID)
		if e != nil {
			return e
		}
		skus := map[string]map[string]any{}
		updates := []map[string]any{}
		for rows.Next() {
			var id, title, vendor, link, source, gtin, brand, core, canonical, dunit, vunit, form, category string
			var dosage, volume sql.NullFloat64
			var quantity sql.NullInt64
			if e = rows.Scan(&id, &title, &vendor, &link, &source, &gtin, &brand, &core, &canonical, &dosage, &dunit, &volume, &vunit, &quantity, &form, &category); e != nil {
				rows.Close()
				return e
			}
			if source == "" {
				source = sourceProductID(link)
			}
			if !matching.ValidGTIN(gtin) {
				gtin = ""
			}
			input := matching.GroupKeyInput{Title: title, Brand: brand, Core: core, CanonicalIdentity: canonical, ProductID: id, SourceID: source, VendorID: vendor, GTIN: gtin, DosageValue: dosage.Float64, DosageUnit: dunit, VolumeValue: volume.Float64, VolumeUnit: vunit, Quantity: float64(quantity.Int64), Form: form, Category: category}
			sku := matching.BuildSKUIdentity(input)
			addAlias(matching.BuildLegacyGroupKey(input).Key, sku.ID)
			addAlias(id, sku.ID)
			if sku.Comparable {
				comparable++
			}
			sk := map[string]any{"id": sku.ID, "family_id": sku.FamilyID, "signature": sku.Signature, "display": sku.Display, "normalized_title": matching.NormalizeText(sku.Display), "brand": sku.Brand, "category": category, "form": sku.Form, "quantity": sku.Quantity, "dosage": sku.Dosage, "dosage_unit": sku.DosageUnit, "volume": sku.Volume, "volume_unit": sku.VolumeUnit, "comparable": sku.Comparable, "method": sku.Method, "gtin": gtin, "unit_quantity": sku.UnitQuantity, "unit_label": sku.UnitLabel, "tokens": sku.Tokens, "attributes": map[string]any{"evidence": "source-title", "identity_version": matching.CatalogIdentityVersion}}
			if previous, ok := skus[sku.ID]; !ok || len(sku.Display) < len(previous["display"].(string)) {
				skus[sku.ID] = sk
			}
			updates = append(updates, map[string]any{"id": id, "sku_id": sku.ID, "source": source})
			lastID = id
			total++
		}
		if e = rows.Err(); e != nil {
			rows.Close()
			return e
		}
		rows.Close()
		if len(updates) == 0 {
			break
		}
		batch := make([]map[string]any, 0, len(skus))
		for _, sku := range skus {
			batch = append(batch, sku)
		}
		data, _ := json.Marshal(batch)
		_, e = tx.ExecContext(ctx, `INSERT INTO "CatalogSku" (id,family_id,identity_version,identity_signature,display_name,normalized_title,brand,category,form,quantity,dosage_value,dosage_unit,volume_value,volume_unit,comparable,match_method,gtin,unit_quantity,unit_label,search_tokens,attributes)
		 SELECT id,family_id,$2,signature,display,normalized_title,brand,category,form,quantity,dosage,dosage_unit,volume,volume_unit,comparable,method,gtin,unit_quantity,unit_label,ARRAY(SELECT jsonb_array_elements_text(tokens)),attributes
		 FROM jsonb_to_recordset($1) AS x(id text,family_id text,signature text,display text,normalized_title text,brand text,category text,form text,quantity int,dosage float8,dosage_unit text,volume float8,volume_unit text,comparable bool,method text,gtin text,unit_quantity float8,unit_label text,tokens jsonb,attributes jsonb)
		 ON CONFLICT(id) DO UPDATE SET display_name=CASE WHEN NOT EXCLUDED.comparable OR length(EXCLUDED.display_name)<length("CatalogSku".display_name) THEN EXCLUDED.display_name ELSE "CatalogSku".display_name END,
		 normalized_title=CASE WHEN NOT EXCLUDED.comparable OR length(EXCLUDED.display_name)<length("CatalogSku".display_name) THEN EXCLUDED.normalized_title ELSE "CatalogSku".normalized_title END,
		 brand=EXCLUDED.brand,family_id=EXCLUDED.family_id,form=EXCLUDED.form,quantity=EXCLUDED.quantity,dosage_value=EXCLUDED.dosage_value,dosage_unit=EXCLUDED.dosage_unit,
		 volume_value=EXCLUDED.volume_value,volume_unit=EXCLUDED.volume_unit,unit_quantity=EXCLUDED.unit_quantity,unit_label=EXCLUDED.unit_label,
		 search_tokens=CASE WHEN EXCLUDED.comparable THEN ARRAY(SELECT DISTINCT unnest("CatalogSku".search_tokens||EXCLUDED.search_tokens)) ELSE EXCLUDED.search_tokens END,
		 category=CASE WHEN "CatalogSku".category='' THEN EXCLUDED.category ELSE "CatalogSku".category END,updated_at=now()`, string(data), matching.CatalogIdentityVersion)
		if e != nil {
			return fmt.Errorf("SKU batch: %w", e)
		}
		data, _ = json.Marshal(updates)
		_, e = tx.ExecContext(ctx, `UPDATE "Product" p SET sku_id=x.sku_id,source_product_id=x.source FROM jsonb_to_recordset($1) AS x(id text,sku_id text,source text) WHERE p.id=x.id`, string(data))
		if e != nil {
			return e
		}
		if total%20000 == 0 {
			log.Printf("catalog: materialized %d offers", total)
		}
	}
	// Retain the legacy map as evidence. Never map an ingredient family to an
	// arbitrary cheapest SKU or delete a user's ambiguous watch/history.
	legacyKeys := make([]string, 0, len(aliases))
	for key := range aliases {
		legacyKeys = append(legacyKeys, key)
	}
	sort.Strings(legacyKeys)
	for start := 0; start < len(legacyKeys); start += 2000 {
		batch := []map[string]any{}
		for _, key := range legacyKeys[start:min(start+2000, len(legacyKeys))] {
			value := ""
			if len(aliases[key]) == 1 {
				for sku := range aliases[key] {
					value = sku
				}
			}
			batch = append(batch, map[string]any{"legacy": key, "sku": value, "count": len(aliases[key])})
		}
		data, _ := json.Marshal(batch)
		_, e := tx.ExecContext(ctx, `INSERT INTO "CatalogIdentityAlias"(legacy_key,sku_id,candidate_count) SELECT legacy,NULLIF(sku,''),count FROM jsonb_to_recordset($1) AS x(legacy text,sku text,count int) ON CONFLICT(legacy_key) DO UPDATE SET sku_id=EXCLUDED.sku_id,candidate_count=EXCLUDED.candidate_count,reviewed_at=now()`, string(data))
		if e != nil {
			return e
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE "Watch" w SET "groupKey"=a.sku_id,"lastPrice"=NULL,needs_review=false,review_reason=NULL
	 FROM "CatalogIdentityAlias" a WHERE w."groupKey"=a.legacy_key AND a.candidate_count=1 AND a.sku_id IS NOT NULL
AND w.id=(SELECT min(candidate.id) FROM "Watch" candidate JOIN "CatalogIdentityAlias" ca ON ca.legacy_key=candidate."groupKey" WHERE candidate."userId"=w."userId" AND ca.sku_id=a.sku_id AND ca.candidate_count=1)
	 AND NOT EXISTS(SELECT 1 FROM "Watch" other WHERE other."userId"=w."userId" AND other."groupKey"=a.sku_id AND other.id<>w.id)`)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE "Watch" SET needs_review=true,review_reason='Izaberite tačan proizvod i pakovanje da biste nastavili praćenje.' WHERE "groupKey" NOT LIKE 'sku:v2:%' AND "groupKey" NOT LIKE 'offer:v2:%'`)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM "CatalogLexeme"; INSERT INTO "CatalogLexeme"(term,sku_count) SELECT term,count(*) FROM "CatalogSku" s CROSS JOIN LATERAL unnest(s.search_tokens) term WHERE term NOT LIKE 'ingredient:%' AND term NOT LIKE 'measure:%' AND EXISTS(SELECT 1 FROM "Product" p WHERE p.sku_id=s.id) GROUP BY term`)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM "CatalogSuggestion"`)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO "CatalogSuggestion"(term,sku_id,display_name,normalized_title,vendor_count)
 WITH coverage AS MATERIALIZED (SELECT sku_id,count(DISTINCT "vendorId")::int vendors FROM "Product" WHERE price>0 AND availability<>'unavailable' AND "priceScrapedAt">=$1 GROUP BY sku_id),
 ranked AS (SELECT term,s.id,s.display_name,s.normalized_title,c.vendors,
 row_number() OVER(PARTITION BY term ORDER BY CASE WHEN s.normalized_title LIKE term||'%' THEN 0 ELSE 1 END,c.vendors DESC,s.normalized_title,s.id) position
 FROM "CatalogSku" s JOIN coverage c ON c.sku_id=s.id CROSS JOIN LATERAL unnest(s.search_tokens) term
 WHERE term NOT LIKE 'ingredient:%' AND term NOT LIKE 'measure:%')
 SELECT term,id,display_name,normalized_title,vendors FROM ranked WHERE position<=12`, time.Now().Add(-currentOfferMaxAge()))
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `INSERT INTO "OfferPriceObservation"(source_key,sku_id,vendor_id,vendor_name,title,link,price,availability,observed_at)
	 SELECT p."vendorId"||'|'||p.source_product_id,p.sku_id,p."vendorId",v.name,p.title,p.link,p.price,p.availability,p."priceScrapedAt"
	 FROM "Product" p JOIN "Vendor" v ON v.id=p."vendorId" WHERE p.price>0 AND p."priceScrapedAt" IS NOT NULL
	 ON CONFLICT(source_key,observed_at,price,availability) DO NOTHING`)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM "CatalogOffer"; INSERT INTO "CatalogOffer"(id,sku_id,"vendorId",title,price,link,thumbnail,"priceScrapedAt",availability,source_product_id) SELECT id,sku_id,"vendorId",title,price,link,COALESCE(thumbnail,''),"priceScrapedAt",availability,source_product_id FROM "Product" WHERE sku_id IS NOT NULL`)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO "CatalogPriceHistory"(sku_id,observed_at,min_price,offer_count)
	 SELECT sku_id,now(),min(price),count(*) FROM "CatalogOffer" WHERE price>0 AND availability<>'unavailable' AND "priceScrapedAt">=$1 GROUP BY sku_id ON CONFLICT DO NOTHING`, time.Now().Add(-currentOfferMaxAge()))
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE "CatalogRun" SET status='ok',finished_at=now(),offer_count=$2,sku_count=(SELECT count(DISTINCT sku_id) FROM "Product"),details=jsonb_build_object('comparable_offers',$3::int,'dictionary_version',$4::text,'build_version',$5::text) WHERE id=$1`, runID, total, comparable, matching.DictionaryVersion, buildVersion)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO "CatalogPublication"(id,run_id,published_at) VALUES (1,$1,now()) ON CONFLICT(id) DO UPDATE SET run_id=EXCLUDED.run_id,published_at=EXCLUDED.published_at`, runID)
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `ANALYZE "CatalogSku"; ANALYZE "Product"; ANALYZE "CatalogLexeme"`)
	log.Printf("catalog: %d offers, %d eligible for exact matching; run %s", total, comparable, runID)
	return err
}
