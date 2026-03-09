# PharmaLive

Phoenix LiveView rewrite entrypoint for scraper orchestration.

To start your Phoenix server:

* Run `mix setup` to install and setup dependencies
* Start Phoenix endpoint with `mix phx.server` or inside IEx with `iex -S mix phx.server`

Now you can visit [`localhost:4000`](http://localhost:4000) from your browser.

## Scraper Runtime

The app now includes a native scraper runtime with:

* `scraper_sources`, `scrape_runs`, `scrape_jobs`, `scraped_products` tables
* normalized product catalog tables:
  * `vendors`
  * `catalog_products`
  * `vendor_products`
  * `price_snapshots`
* OTP queue worker with configurable concurrency (`SCRAPER_CONCURRENCY`, default `2`)
* LiveView control panel at [`/scrapers`](http://localhost:4000/scrapers)
* Adapter-based scraper system:
  * `PharmaLive.Scrapers.Adapters.ApotekaNetAdapter` (native)
  * `PharmaLive.Scrapers.Adapters.DrMaxAdapter` (native)
  * `PharmaLive.Scrapers.Adapters.LilyAdapter` (native)
  * `PharmaLive.Scrapers.Adapters.ApotekaOnlineAdapter` (native)
  * `PharmaLive.Scrapers.Adapters.ApotekaNisAdapter` (native)
  * `PharmaLive.Scrapers.Adapters.ApotekaShopAdapter` (native)
  * `PharmaLive.Scrapers.Adapters.ApotekarOnlineAdapter` (native)
  * `PharmaLive.Scrapers.Adapters.ApotekaZivanovicAdapter` (native)
  * `PharmaLive.Scrapers.Adapters.PendingAdapter` (explicitly marks sources not yet ported)
  * `PharmaLive.Scrapers.Adapters.DemoAdapter`
  * `PharmaLive.Scrapers.Adapters.GenericHtmlAdapter`

By default, all detected legacy scraper scripts are registered in `scraper_sources`.
Migrated native sources are enabled; unmigrated sources are assigned `PendingAdapter`.

### Run Setup

1. `mix deps.get`
2. `mix ecto.create`
3. `mix ecto.migrate`
4. `mix run priv/repo/seeds.exs`
5. `mix phx.server`

Ready to run in production? Please [check our deployment guides](https://hexdocs.pm/phoenix/deployment.html).

## Learn more

* Official website: https://www.phoenixframework.org/
* Guides: https://hexdocs.pm/phoenix/overview.html
* Docs: https://hexdocs.pm/phoenix
* Forum: https://elixirforum.com/c/phoenix-forum
* Source: https://github.com/phoenixframework/phoenix
