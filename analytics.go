package main

import "context"

// Featured products use the same SKU identity, eligibility and complete offer
// aggregation as every other catalog surface.
type FeaturedGroup = catalogGroup

func (s *server) GetFeaturedProducts(ctx context.Context, limit int) ([]FeaturedGroup, error) {
	page, err := s.catalogSearch(ctx, catalogRequest{Limit: limit, Sort: "coverage"})
	if err != nil {
		return nil, err
	}
	return page.Groups, nil
}
