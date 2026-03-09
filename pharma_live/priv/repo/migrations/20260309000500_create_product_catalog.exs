defmodule PharmaLive.Repo.Migrations.CreateProductCatalog do
  use Ecto.Migration

  def change do
    create table(:vendors) do
      add :key, :string, null: false
      add :name, :string, null: false
      add :website, :string
      add :active, :boolean, null: false, default: true

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:vendors, [:key])

    create table(:catalog_products) do
      add :normalized_name, :text, null: false
      add :display_name, :text, null: false
      add :brand, :text
      add :category, :text
      add :form, :text
      add :dosage_value, :decimal
      add :dosage_unit, :text
      add :volume_value, :decimal
      add :volume_unit, :text
      add :quantity_value, :integer
      add :quantity_unit, :text

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:catalog_products, [:normalized_name])

    create table(:vendor_products) do
      add :vendor_id, references(:vendors, on_delete: :delete_all), null: false
      add :catalog_product_id, references(:catalog_products, on_delete: :nilify_all)
      add :source_product_key, :text, null: false
      add :title, :text, null: false
      add :product_url, :text
      add :thumbnail_url, :text
      add :description, :text
      add :currency, :string, null: false, default: "RSD"
      add :active, :boolean, null: false, default: true
      add :last_seen_at, :utc_datetime_usec
      add :raw_payload, :map

      timestamps(type: :utc_datetime_usec)
    end

    create index(:vendor_products, [:vendor_id])
    create index(:vendor_products, [:catalog_product_id])
    create unique_index(:vendor_products, [:vendor_id, :source_product_key])

    create table(:price_snapshots) do
      add :vendor_product_id, references(:vendor_products, on_delete: :delete_all), null: false
      add :scrape_run_id, references(:scrape_runs, on_delete: :nilify_all)
      add :price_cents, :integer
      add :currency, :string, null: false, default: "RSD"
      add :in_stock, :boolean, null: false, default: true
      add :captured_at, :utc_datetime_usec, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create index(:price_snapshots, [:vendor_product_id])
    create index(:price_snapshots, [:scrape_run_id])
    create index(:price_snapshots, [:captured_at])
  end
end
