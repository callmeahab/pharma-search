defmodule PharmaLive.Repo.Migrations.LinkScraperSourceToVendor do
  use Ecto.Migration

  def change do
    alter table(:scraper_sources) do
      add :vendor_id, references(:vendors, on_delete: :nilify_all)
      add :settings, :map, null: false, default: %{}
    end

    create index(:scraper_sources, [:vendor_id])
  end
end
