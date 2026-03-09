defmodule PharmaLive.Catalog.CatalogProduct do
  use Ecto.Schema
  import Ecto.Changeset

  schema "catalog_products" do
    field :normalized_name, :string
    field :display_name, :string
    field :brand, :string
    field :category, :string
    field :form, :string
    field :dosage_value, :decimal
    field :dosage_unit, :string
    field :volume_value, :decimal
    field :volume_unit, :string
    field :quantity_value, :integer
    field :quantity_unit, :string

    has_many :vendor_products, PharmaLive.Catalog.VendorProduct

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(product, attrs) do
    product
    |> cast(attrs, [:normalized_name, :display_name, :brand, :category, :form, :dosage_value, :dosage_unit, :volume_value, :volume_unit, :quantity_value, :quantity_unit])
    |> validate_required([:normalized_name, :display_name])
    |> unique_constraint(:normalized_name)
  end
end
