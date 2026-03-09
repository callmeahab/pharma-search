defmodule PharmaLive.Repo.Migrations.CreateScraperRuntime do
  use Ecto.Migration

  def change do
    create table(:scraper_sources) do
      add :key, :string, null: false
      add :name, :string, null: false
      add :base_url, :string
      add :adapter, :string, null: false
      add :enabled, :boolean, default: true, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:scraper_sources, [:key])

    create table(:scrape_runs) do
      add :status, :string, null: false, default: "queued"
      add :requested_by, :string
      add :started_at, :utc_datetime_usec
      add :finished_at, :utc_datetime_usec
      add :total_sources, :integer, null: false, default: 0
      add :completed_sources, :integer, null: false, default: 0
      add :failed_sources, :integer, null: false, default: 0
      add :total_products, :integer, null: false, default: 0
      add :error, :text

      timestamps(type: :utc_datetime_usec)
    end

    create table(:scrape_jobs) do
      add :run_id, references(:scrape_runs, on_delete: :delete_all), null: false
      add :source_id, references(:scraper_sources, on_delete: :delete_all), null: false
      add :status, :string, null: false, default: "queued"
      add :started_at, :utc_datetime_usec
      add :finished_at, :utc_datetime_usec
      add :products_count, :integer, null: false, default: 0
      add :error, :text

      timestamps(type: :utc_datetime_usec)
    end

    create index(:scrape_jobs, [:run_id])
    create index(:scrape_jobs, [:source_id])
    create unique_index(:scrape_jobs, [:run_id, :source_id])

    create table(:scraped_products) do
      add :run_id, references(:scrape_runs, on_delete: :delete_all), null: false
      add :source_id, references(:scraper_sources, on_delete: :delete_all), null: false
      add :external_id, :string
      add :title, :text, null: false
      add :url, :text
      add :price_cents, :integer
      add :currency, :string, default: "RSD", null: false
      add :in_stock, :boolean, default: true, null: false
      add :raw_payload, :map

      timestamps(type: :utc_datetime_usec)
    end

    create index(:scraped_products, [:run_id])
    create index(:scraped_products, [:source_id])
  end
end
