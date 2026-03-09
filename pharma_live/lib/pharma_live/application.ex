defmodule PharmaLive.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      PharmaLiveWeb.Telemetry,
      PharmaLive.Repo,
      {DNSCluster, query: Application.get_env(:pharma_live, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: PharmaLive.PubSub},
      {Finch, name: PharmaLive.Finch},
      {Task.Supervisor, name: PharmaLive.Scrapers.TaskSupervisor},
      PharmaLive.Scrapers.ScraperQueue,
      # Start to serve requests, typically the last entry
      PharmaLiveWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: PharmaLive.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    PharmaLiveWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
