defmodule PharmaLive.Catalog.Vendor do
  use Ecto.Schema
  import Ecto.Changeset

  schema "vendors" do
    field :key, :string
    field :name, :string
    field :website, :string
    field :active, :boolean, default: true

    has_many :vendor_products, PharmaLive.Catalog.VendorProduct

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(vendor, attrs) do
    vendor
    |> cast(attrs, [:key, :name, :website, :active])
    |> validate_required([:key, :name])
    |> unique_constraint(:key)
  end
end
