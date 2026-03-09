defmodule PharmaLive.Repo.Migrations.CreateAccountsAndWishlist do
  use Ecto.Migration

  def change do
    create table(:users) do
      add :email, :string, null: false
      add :name, :string, null: false
      add :password_hash, :text, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:users, [:email])

    create table(:user_wishlist_items) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :catalog_product_id, references(:catalog_products, on_delete: :delete_all), null: false

      timestamps(type: :utc_datetime_usec, updated_at: false)
    end

    create unique_index(:user_wishlist_items, [:user_id, :catalog_product_id])
    create index(:user_wishlist_items, [:user_id])
  end
end
