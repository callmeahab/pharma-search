defmodule PharmaLive.Scrapers.Adapters.PendingAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  @impl true
  def scrape(source) do
    script = get_in(source.settings, ["script"])
    {:error, "native adapter not implemented yet for source #{source.key} (legacy script: #{script || "n/a"})"}
  end
end
