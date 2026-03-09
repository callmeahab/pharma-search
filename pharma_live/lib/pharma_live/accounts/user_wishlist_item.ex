defmodule PharmaLive.Accounts.UserWishlistItem do
  use Ecto.Schema
  import Ecto.Changeset

  schema "user_wishlist_items" do
    belongs_to :user, PharmaLive.Accounts.User
    belongs_to :catalog_product, PharmaLive.Catalog.CatalogProduct

    timestamps(type: :utc_datetime_usec, updated_at: false)
  end

  def changeset(item, attrs) do
    item
    |> cast(attrs, [:user_id, :catalog_product_id])
    |> validate_required([:user_id, :catalog_product_id])
    |> unique_constraint([:user_id, :catalog_product_id], name: :user_wishlist_items_user_id_catalog_product_id_index)
  end
end
