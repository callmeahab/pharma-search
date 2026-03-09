defmodule PharmaLive.Scrapers.Adapters.FarmasiAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  @impl true
  def scrape(_source) do
    user = System.get_env("FARMASI_USER")
    pass = System.get_env("FARMASI_PASS")

    if is_binary(user) and user != "" and is_binary(pass) and pass != "" do
      {:error, "Farmasi native scraper requires authenticated session flow; adapter scaffolded but not fully implemented yet"}
    else
      {:error, "Farmasi requires login. Set FARMASI_USER and FARMASI_PASS to enable implementation."}
    end
  end
end
