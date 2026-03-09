defmodule PharmaLive.Scrapers.Adapter do
  @callback scrape(PharmaLive.Scrapers.ScraperSource.t()) ::
              {:ok, [PharmaLive.Scrapers.Product.t()]} | {:error, term()}
end
