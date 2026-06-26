package main

import (
	"net/http"
)

// handleVendorList returns all pharmacies with their contact details (and product
// count), powering the public pharmacy directory and the contact actions in the
// price-comparison view. Public — no auth required.
func (s *server) handleVendorList(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeErr(w, http.StatusServiceUnavailable, "database not connected")
		return
	}
	// Only list vendors that actually have priced products. Broken scrapers (e.g.
	// dead/replatformed sites, Cloudflare-blocked vendors) leave a Vendor row with
	// zero products; surfacing them in the public directory just shows empty
	// pharmacies. They reappear automatically once their scraper produces offers.
	rows, err := s.db.Query(`
		SELECT v.id, v.name, COALESCE(v.website,''), COALESCE(v.logo,''),
		       COALESCE(v.phone,''), COALESCE(v.email,''), COALESCE(v.address,''),
		       COALESCE(v.city,''), COALESCE(v.hours,''), COALESCE(v."mapsUrl",''),
		       v.latitude, v.longitude,
		       (SELECT count(*) FROM "Product" p WHERE p."vendorId" = v.id AND p.price > 0) AS product_count
		FROM "Vendor" v
		WHERE EXISTS (
			SELECT 1 FROM "Product" p WHERE p."vendorId" = v.id AND p.price > 0
		)
		ORDER BY v.name ASC`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load vendors")
		return
	}
	defer rows.Close()

	vendors := []map[string]interface{}{}
	for rows.Next() {
		var id, name, website, logo, phone, email, address, city, hours, mapsURL string
		var lat, lng interface{}
		var productCount int
		if err := rows.Scan(&id, &name, &website, &logo, &phone, &email, &address,
			&city, &hours, &mapsURL, &lat, &lng, &productCount); err != nil {
			continue
		}
		vendors = append(vendors, map[string]interface{}{
			"id": id, "name": name, "website": website, "logo": logo,
			"phone": phone, "email": email, "address": address, "city": city,
			"hours": hours, "maps_url": mapsURL, "latitude": lat, "longitude": lng,
			"product_count": productCount,
		})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"vendors": vendors})
}

func (s *server) registerVendorRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/vendors", s.handleVendorList)
}
