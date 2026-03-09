defmodule PharmaLiveWeb.ScraperLive.Index do
  use PharmaLiveWeb, :live_view

  alias PharmaLive.Scrapers

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket), do: Scrapers.subscribe()

    Scrapers.seed_sources()

    {:ok, assign(socket, selected_source_ids: []) |> reload()}
  end

  @impl true
  def handle_event("toggle-source", %{"id" => id}, socket) do
    source_id = String.to_integer(id)

    selected =
      if source_id in socket.assigns.selected_source_ids do
        Enum.reject(socket.assigns.selected_source_ids, &(&1 == source_id))
      else
        [source_id | socket.assigns.selected_source_ids]
      end

    {:noreply, assign(socket, selected_source_ids: selected)}
  end

  @impl true
  def handle_event("run-selected", _params, socket) do
    case Scrapers.start_run(socket.assigns.selected_source_ids, requested_by: "liveview") do
      {:ok, _run} ->
        {:noreply,
         socket
         |> put_flash(:info, "Scrape run started")
         |> assign(selected_source_ids: [])
         |> reload()}

      {:error, :no_sources} ->
        {:noreply, put_flash(socket, :error, "No sources selected")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to start run: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_info({_event, _run_id}, socket) do
    {:noreply, reload(socket)}
  end

  defp reload(socket) do
    runs = Scrapers.list_runs(10)
    latest_run = List.first(runs)

    assign(socket,
      runs: runs,
      sources: Scrapers.list_sources(),
      latest_run: latest_run,
      jobs: jobs_for(latest_run)
    )
  end

  defp jobs_for(nil), do: []
  defp jobs_for(run), do: Scrapers.list_jobs(run.id)

  defp status_color("completed"), do: "badge-success"
  defp status_color("running"), do: "badge-info"
  defp status_color("failed"), do: "badge-error"
  defp status_color("succeeded"), do: "badge-success"
  defp status_color(_), do: "badge-ghost"

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash}>
      <div class="mx-auto max-w-6xl p-6 space-y-6">
        <h1 class="text-3xl font-semibold">Scraper Control</h1>

        <section class="card bg-base-100 shadow">
          <div class="card-body">
            <h2 class="card-title">Sources</h2>
            <p class="text-sm text-base-content/70">Select sources and trigger a new run.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <label :for={source <- @sources} class="label cursor-pointer justify-start gap-2">
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  checked={source.id in @selected_source_ids}
                  phx-click="toggle-source"
                  phx-value-id={source.id}
                />
                <span class="label-text"><%= source.name %></span>
                <span :if={!source.enabled} class="badge badge-ghost">disabled</span>
              </label>
            </div>
            <div class="card-actions justify-end mt-3">
              <button class="btn btn-primary" phx-click="run-selected">Run Selected</button>
            </div>
          </div>
        </section>

        <section :if={@latest_run} class="card bg-base-100 shadow">
          <div class="card-body">
            <h2 class="card-title">Latest Run #<%= @latest_run.id %></h2>
            <div class="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div>Status: <span class={["badge", status_color(@latest_run.status)]}><%= @latest_run.status %></span></div>
              <div>Total Sources: <%= @latest_run.total_sources %></div>
              <div>Completed: <%= @latest_run.completed_sources %></div>
              <div>Failed: <%= @latest_run.failed_sources %></div>
              <div>Products: <%= @latest_run.total_products %></div>
            </div>
            <div class="overflow-x-auto mt-4">
              <table class="table table-zebra table-sm">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Products</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  <tr :for={job <- @jobs}>
                    <td><%= job.source.name %></td>
                    <td><span class={["badge", status_color(job.status)]}><%= job.status %></span></td>
                    <td><%= job.products_count %></td>
                    <td class="max-w-md truncate"><%= job.error %></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section class="card bg-base-100 shadow">
          <div class="card-body">
            <h2 class="card-title">Recent Runs</h2>
            <div class="overflow-x-auto">
              <table class="table table-zebra table-sm">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Finished</th>
                    <th>Sources</th>
                    <th>Products</th>
                  </tr>
                </thead>
                <tbody>
                  <tr :for={run <- @runs}>
                    <td><%= run.id %></td>
                    <td><span class={["badge", status_color(run.status)]}><%= run.status %></span></td>
                    <td><%= run.started_at %></td>
                    <td><%= run.finished_at %></td>
                    <td><%= run.completed_sources %>/<%= run.total_sources %></td>
                    <td><%= run.total_products %></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </Layouts.app>
    """
  end
end
