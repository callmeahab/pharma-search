defmodule PharmaLive.Catalog.VendorProduct do
  use Ecto.Schema
  import Ecto.Changeset

  schema "vendor_products" do
    field :source_product_key, :string
    field :title, :string
    field :product_url, :string
    field :thumbnail_url, :string
    field :description, :string
    field :currency, :string, default: "RSD"
    field :active, :boolean, default: true
    field :last_seen_at, :utc_datetime_usec
    field :raw_payload, :map

    belongs_to :vendor, PharmaLive.Catalog.Vendor
    belongs_to :catalog_product, PharmaLive.Catalog.CatalogProduct

    has_many :price_snapshots, PharmaLive.Catalog.PriceSnapshot

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(vendor_product, attrs) do
    vendor_product
    |> cast(attrs, [:vendor_id, :catalog_product_id, :source_product_key, :title, :product_url, :thumbnail_url, :description, :currency, :active, :last_seen_at, :raw_payload])
    |> validate_required([:vendor_id, :source_product_key, :title])
    |> unique_constraint(:source_product_key, name: :vendor_products_vendor_id_source_product_key_index)
  end
end
