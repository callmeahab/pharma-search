defmodule PharmaLive.Repo do
  use Ecto.Repo,
    otp_app: :pharma_live,
    adapter: Ecto.Adapters.Postgres
end
