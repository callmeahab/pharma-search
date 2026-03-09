defmodule PharmaLive.Scrapers.ScrapeJob do
  use Ecto.Schema
  import Ecto.Changeset

  schema "scrape_jobs" do
    field :status, :string, default: "queued"
    field :started_at, :utc_datetime_usec
    field :finished_at, :utc_datetime_usec
    field :products_count, :integer, default: 0
    field :error, :string

    belongs_to :run, PharmaLive.Scrapers.ScrapeRun
    belongs_to :source, PharmaLive.Scrapers.ScraperSource

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(job, attrs) do
    job
    |> cast(attrs, [:run_id, :source_id, :status, :started_at, :finished_at, :products_count, :error])
    |> validate_required([:run_id, :source_id, :status])
    |> foreign_key_constraint(:run_id)
    |> foreign_key_constraint(:source_id)
    |> unique_constraint(:source_id, name: :scrape_jobs_run_id_source_id_index)
  end
end
