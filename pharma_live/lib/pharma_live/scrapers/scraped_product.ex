defmodule PharmaLive.Scrapers.ScrapedProduct do
  use Ecto.Schema
  import Ecto.Changeset

  schema "scraped_products" do
    field :external_id, :string
    field :title, :string
    field :url, :string
    field :price_cents, :integer
    field :currency, :string, default: "RSD"
    field :in_stock, :boolean, default: true
    field :raw_payload, :map

    belongs_to :run, PharmaLive.Scrapers.ScrapeRun
    belongs_to :source, PharmaLive.Scrapers.ScraperSource

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(product, attrs) do
    product
    |> cast(attrs, [
      :run_id,
      :source_id,
      :external_id,
      :title,
      :url,
      :price_cents,
      :currency,
      :in_stock,
      :raw_payload
    ])
    |> validate_required([:run_id, :source_id, :title])
    |> foreign_key_constraint(:run_id)
    |> foreign_key_constraint(:source_id)
  end
end
