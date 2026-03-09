defmodule PharmaLive.Scrapers.ScraperSource do
  use Ecto.Schema
  import Ecto.Changeset

  schema "scraper_sources" do
    field :key, :string
    field :name, :string
    field :base_url, :string
    field :adapter, :string
    field :enabled, :boolean, default: true
    field :settings, :map, default: %{}

    has_many :jobs, PharmaLive.Scrapers.ScrapeJob, foreign_key: :source_id
    belongs_to :vendor, PharmaLive.Catalog.Vendor

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(source, attrs) do
    source
    |> cast(attrs, [:key, :name, :base_url, :adapter, :enabled, :settings, :vendor_id])
    |> validate_required([:key, :name, :adapter])
    |> unique_constraint(:key)
  end
end
