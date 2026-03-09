defmodule PharmaLive.Catalog.PriceSnapshot do
  use Ecto.Schema
  import Ecto.Changeset

  schema "price_snapshots" do
    field :price_cents, :integer
    field :currency, :string, default: "RSD"
    field :in_stock, :boolean, default: true
    field :captured_at, :utc_datetime_usec

    belongs_to :vendor_product, PharmaLive.Catalog.VendorProduct
    belongs_to :scrape_run, PharmaLive.Scrapers.ScrapeRun

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(snapshot, attrs) do
    snapshot
    |> cast(attrs, [:vendor_product_id, :scrape_run_id, :price_cents, :currency, :in_stock, :captured_at])
    |> validate_required([:vendor_product_id, :captured_at])
  end
end
