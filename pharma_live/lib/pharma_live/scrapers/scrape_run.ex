defmodule PharmaLive.Scrapers.ScrapeRun do
  use Ecto.Schema
  import Ecto.Changeset

  schema "scrape_runs" do
    field :status, :string, default: "queued"
    field :requested_by, :string
    field :started_at, :utc_datetime_usec
    field :finished_at, :utc_datetime_usec
    field :total_sources, :integer, default: 0
    field :completed_sources, :integer, default: 0
    field :failed_sources, :integer, default: 0
    field :total_products, :integer, default: 0
    field :error, :string

    has_many :jobs, PharmaLive.Scrapers.ScrapeJob, foreign_key: :run_id

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(run, attrs) do
    run
    |> cast(attrs, [
      :status,
      :requested_by,
      :started_at,
      :finished_at,
      :total_sources,
      :completed_sources,
      :failed_sources,
      :total_products,
      :error
    ])
    |> validate_required([:status])
  end
end
