defmodule PharmaLive.Scrapers.ScraperQueue do
  use GenServer

  import Ecto.Query, warn: false

  alias PharmaLive.Repo
  alias PharmaLive.Scrapers
  alias PharmaLive.Scrapers.ScrapeJob

  @default_concurrency 2

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def enqueue_run(run_id) do
    GenServer.cast(__MODULE__, {:enqueue_run, run_id})
  end

  @impl true
  def init(_opts) do
    max = Application.get_env(:pharma_live, __MODULE__, []) |> Keyword.get(:concurrency, @default_concurrency)
    {:ok, %{max: max, queue: :queue.new(), running: %{}}}
  end

  @impl true
  def handle_cast({:enqueue_run, run_id}, state) do
    jobs = Repo.all(from j in ScrapeJob, where: j.run_id == ^run_id and j.status == "queued", order_by: [asc: j.id])

    next_queue =
      Enum.reduce(jobs, state.queue, fn job, queue ->
        :queue.in(job.id, queue)
      end)

    {:noreply, dispatch(%{state | queue: next_queue})}
  end

  @impl true
  def handle_info({ref, _result}, state) do
    Process.demonitor(ref, [:flush])
    {:noreply, dispatch(drop_running(state, ref))}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    running = Map.get(state.running, ref)

    if running && reason != :normal do
      case Repo.get(ScrapeJob, running.job_id) do
        nil -> :ok
        job -> Scrapers.mark_job_failed(job, reason)
      end
    end

    {:noreply, dispatch(drop_running(state, ref))}
  end

  defp dispatch(state) do
    cond do
      map_size(state.running) >= state.max ->
        state

      :queue.is_empty(state.queue) ->
        state

      true ->
        {{:value, job_id}, queue} = :queue.out(state.queue)

        task =
          Task.Supervisor.async_nolink(PharmaLive.Scrapers.TaskSupervisor, fn ->
            run_job(job_id)
          end)

        state
        |> Map.put(:queue, queue)
        |> put_in([:running, task.ref], %{job_id: job_id})
        |> dispatch()
    end
  end

  defp run_job(job_id) do
    job = Scrapers.get_job!(job_id)
    Scrapers.mark_job_running(job)

    adapter = Scrapers.adapter_module!(job.source)

    case adapter.scrape(job.source) do
      {:ok, products} ->
        count = Scrapers.store_products(job.run_id, job.source_id, products)
        Scrapers.mark_job_finished(job, count)
        :ok

      {:error, reason} ->
        Scrapers.mark_job_failed(job, reason)
        :ok
    end
  rescue
    error ->
      if failed_job = Repo.get(ScrapeJob, job_id) do
        Scrapers.mark_job_failed(failed_job, Exception.message(error))
      end
  end

  defp drop_running(state, ref) do
    update_in(state.running, &Map.delete(&1, ref))
  end
end
