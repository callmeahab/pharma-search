defmodule PharmaLive.Scrapers do
  import Ecto.Query, warn: false

  alias Ecto.Multi
  alias PharmaLive.Catalog
  alias PharmaLive.Repo
  alias PharmaLive.Scrapers.ScrapeJob
  alias PharmaLive.Scrapers.ScrapeRun
  alias PharmaLive.Scrapers.ScrapedProduct
  alias PharmaLive.Scrapers.ScraperQueue
  alias PharmaLive.Scrapers.ScraperSource

  @topic "scrapers"

  def topic, do: @topic

  def subscribe do
    Phoenix.PubSub.subscribe(PharmaLive.PubSub, @topic)
  end

  def list_sources do
    Repo.all(from s in ScraperSource, order_by: [asc: s.name])
  end

  def enabled_sources do
    Repo.all(from s in ScraperSource, where: s.enabled == true, order_by: [asc: s.name])
  end

  def list_runs(limit \\ 20) do
    Repo.all(
      from r in ScrapeRun,
        order_by: [desc: r.inserted_at],
        limit: ^limit,
        preload: [jobs: [:source]]
    )
  end

  def get_run!(id) do
    Repo.get!(ScrapeRun, id) |> Repo.preload(jobs: [:source])
  end

  def seed_sources do
    seeds = legacy_scraper_seeds()

    Enum.each(seeds, fn source ->
      {:ok, vendor} =
        Catalog.upsert_vendor(%{
          key: source.key,
          name: source.name,
          website: source.base_url
        })

      attrs =
        source
        |> Map.put(:vendor_id, vendor.id)
        |> Map.put_new(:settings, %{})

      Repo.insert(
        ScraperSource.changeset(%ScraperSource{}, attrs),
        on_conflict: [
          set: [
            name: attrs.name,
            adapter: attrs.adapter,
            base_url: attrs[:base_url],
            enabled: attrs.enabled,
            settings: attrs.settings,
            vendor_id: vendor.id
          ]
        ],
        conflict_target: :key
      )
    end)
  end

  def start_run(source_ids \\ [], opts \\ []) do
    sources =
      if source_ids == [] do
        enabled_sources()
      else
        Repo.all(from s in ScraperSource, where: s.id in ^source_ids, order_by: [asc: s.name])
      end

    requested_by = Keyword.get(opts, :requested_by)

    if sources == [] do
      {:error, :no_sources}
    else
      now = DateTime.utc_now()

      multi =
        Multi.new()
        |> Multi.insert(
          :run,
          ScrapeRun.changeset(%ScrapeRun{}, %{
            status: "running",
            requested_by: requested_by,
            started_at: now,
            total_sources: length(sources)
          })
        )
        |> Multi.run(:jobs, fn repo, %{run: run} ->
          jobs =
            Enum.map(sources, fn source ->
              %{run_id: run.id, source_id: source.id, status: "queued", inserted_at: now, updated_at: now}
            end)

          {count, _} = repo.insert_all(ScrapeJob, jobs)
          if count == length(jobs), do: {:ok, count}, else: {:error, :job_insert_failed}
        end)

      case Repo.transaction(multi) do
        {:ok, %{run: run}} ->
          ScraperQueue.enqueue_run(run.id)
          broadcast({:run_started, run.id})
          {:ok, run}

        {:error, _step, reason, _changes} ->
          {:error, reason}
      end
    end
  end

  def list_jobs(run_id) do
    Repo.all(
      from j in ScrapeJob,
        where: j.run_id == ^run_id,
        order_by: [asc: j.id],
        preload: [:source]
    )
  end

  def mark_job_running(job) do
    update_job(job, %{status: "running", started_at: DateTime.utc_now(), error: nil})
  end

  def mark_job_finished(job, products_count) do
    now = DateTime.utc_now()

    Repo.transaction(fn ->
      {:ok, _job} =
        update_job(job, %{status: "succeeded", finished_at: now, products_count: products_count, error: nil})

      run = Repo.get!(ScrapeRun, job.run_id)

      {:ok, _run} =
        run
        |> ScrapeRun.changeset(%{
          completed_sources: run.completed_sources + 1,
          total_products: run.total_products + products_count
        })
        |> Repo.update()

      maybe_finish_run!(run.id)
    end)

    broadcast({:job_finished, job.run_id})
    :ok
  end

  def mark_job_failed(job, reason) do
    now = DateTime.utc_now()
    message = inspect(reason)

    Repo.transaction(fn ->
      {:ok, _job} = update_job(job, %{status: "failed", finished_at: now, error: message})

      run = Repo.get!(ScrapeRun, job.run_id)

      {:ok, _run} =
        run
        |> ScrapeRun.changeset(%{
          completed_sources: run.completed_sources + 1,
          failed_sources: run.failed_sources + 1
        })
        |> Repo.update()

      maybe_finish_run!(run.id)
    end)

    broadcast({:job_failed, job.run_id})
    :ok
  end

  def store_products(run_id, source_id, products) do
    source = Repo.get!(ScraperSource, source_id)
    catalog_count = Catalog.ingest_products(source, run_id, products)

    now = DateTime.utc_now()

    rows =
      Enum.map(products, fn product ->
        %{
          run_id: run_id,
          source_id: source_id,
          external_id: product.external_id,
          title: product.title,
          url: product.url,
          price_cents: product.price_cents,
          currency: product.currency,
          in_stock: product.in_stock,
          raw_payload: product.raw_payload,
          inserted_at: now,
          updated_at: now
        }
      end)

    if rows == [] do
      catalog_count
    else
      {count, _} = Repo.insert_all(ScrapedProduct, rows)
      max(count, catalog_count)
    end
  end

  def get_job!(id) do
    Repo.get!(ScrapeJob, id) |> Repo.preload([:source, :run])
  end

  def adapter_module!(%ScraperSource{adapter: module_name}) do
    module =
      module_name
      |> String.trim_leading("Elixir.")
      |> String.split(".")
      |> Module.concat()

    if Code.ensure_loaded?(module), do: module, else: raise(ArgumentError, "adapter module #{module_name} is not available")
  rescue
    _ ->
      raise ArgumentError, "adapter module #{module_name} is not loaded"
  end

  defp update_job(job, attrs) do
    job |> ScrapeJob.changeset(attrs) |> Repo.update()
  end

  defp maybe_finish_run!(run_id) do
    run = Repo.get!(ScrapeRun, run_id)

    if run.completed_sources >= run.total_sources do
      status = if run.failed_sources > 0, do: "failed", else: "completed"

      run
      |> ScrapeRun.changeset(%{status: status, finished_at: DateTime.utc_now()})
      |> Repo.update!()

      broadcast({:run_finished, run_id})
    end

    :ok
  end

  defp broadcast(payload) do
    Phoenix.PubSub.broadcast(PharmaLive.PubSub, @topic, payload)
  end

  defp legacy_scraper_seeds do
    scripts_dir = Application.get_env(:pharma_live, :legacy_scrapers_dir, Path.expand("../scrapers", File.cwd!()))

    case File.ls(scripts_dir) do
      {:ok, files} ->
        files
        |> Enum.filter(&String.ends_with?(&1, ".ts"))
        |> Enum.reject(&(&1 in ignored_legacy_scripts()))
        |> Enum.sort()
        |> Enum.map(fn script ->
          base = Path.basename(script, ".ts")
          adapter = adapter_for_script(base)

          %{
            key: base,
            name: humanize_scraper_name(base),
            adapter: adapter,
            enabled: adapter != "Elixir.PharmaLive.Scrapers.Adapters.PendingAdapter",
            settings: %{"script" => script}
          }
        end)

      {:error, _} ->
        [
          %{
            key: "demo",
            name: "Demo Source",
            adapter: "Elixir.PharmaLive.Scrapers.Adapters.DemoAdapter",
            enabled: true
          }
        ]
    end
  end

  defp ignored_legacy_scripts do
    [
      "run-scrapers-worker.ts",
      "deleteItemsWithoutPrice.ts",
      "deleteDuplicateProducts.ts",
      "import-csv.ts",
      "apothecary_new.ts"
    ]
  end

  defp humanize_scraper_name(base) do
    base
    |> String.replace(~r/([a-z])([A-Z])/, "\\1 \\2")
    |> String.replace(~r/[-_]/, " ")
    |> String.trim()
    |> String.split(" ")
    |> Enum.map_join(" ", &String.capitalize/1)
  end

  defp adapter_for_script("apotekaNet"), do: "Elixir.PharmaLive.Scrapers.Adapters.ApotekaNetAdapter"
  defp adapter_for_script("drMax"), do: "Elixir.PharmaLive.Scrapers.Adapters.DrMaxAdapter"
  defp adapter_for_script("lily"), do: "Elixir.PharmaLive.Scrapers.Adapters.LilyAdapter"
  defp adapter_for_script("apotekaOnline"), do: "Elixir.PharmaLive.Scrapers.Adapters.ApotekaOnlineAdapter"
  defp adapter_for_script("apotekaNis"), do: "Elixir.PharmaLive.Scrapers.Adapters.ApotekaNisAdapter"
  defp adapter_for_script("apotekaShop"), do: "Elixir.PharmaLive.Scrapers.Adapters.ApotekaShopAdapter"
  defp adapter_for_script("apotekarOnline"), do: "Elixir.PharmaLive.Scrapers.Adapters.ApotekarOnlineAdapter"
  defp adapter_for_script("apotekaZivanovic"), do: "Elixir.PharmaLive.Scrapers.Adapters.ApotekaZivanovicAdapter"
  defp adapter_for_script("apotekaSunce"), do: "Elixir.PharmaLive.Scrapers.Adapters.ApotekaSunceAdapter"
  defp adapter_for_script("apotekaValerijana"), do: "Elixir.PharmaLive.Scrapers.Adapters.ApotekaValerijanaAdapter"
  defp adapter_for_script("apotekamo"), do: "Elixir.PharmaLive.Scrapers.Adapters.ApotekamoAdapter"
  defp adapter_for_script("eApoteka"), do: "Elixir.PharmaLive.Scrapers.Adapters.EApotekaAdapter"
  defp adapter_for_script("eApotekaNet"), do: "Elixir.PharmaLive.Scrapers.Adapters.EApotekaNetAdapter"
  defp adapter_for_script("eApotekaRs"), do: "Elixir.PharmaLive.Scrapers.Adapters.EApotekaRsAdapter"
  defp adapter_for_script("ePlaneta"), do: "Elixir.PharmaLive.Scrapers.Adapters.EPlanetaAdapter"
  defp adapter_for_script("esensa"), do: "Elixir.PharmaLive.Scrapers.Adapters.EsensaAdapter"
  defp adapter_for_script("biofarm"), do: "Elixir.PharmaLive.Scrapers.Adapters.BiofarmAdapter"
  defp adapter_for_script("benu"), do: "Elixir.PharmaLive.Scrapers.Adapters.BenuAdapter"
  defp adapter_for_script("fitnessShop"), do: "Elixir.PharmaLive.Scrapers.Adapters.FitnessShopAdapter"
  defp adapter_for_script("gymBeam"), do: "Elixir.PharmaLive.Scrapers.Adapters.GymBeamAdapter"
  defp adapter_for_script("supplementStore"), do: "Elixir.PharmaLive.Scrapers.Adapters.SupplementStoreAdapter"
  defp adapter_for_script("supplementShop"), do: "Elixir.PharmaLive.Scrapers.Adapters.SupplementShopAdapter"
  defp adapter_for_script("supplements"), do: "Elixir.PharmaLive.Scrapers.Adapters.SupplementsAdapter"
  defp adapter_for_script("atpSport"), do: "Elixir.PharmaLive.Scrapers.Adapters.AtpSportAdapter"
  defp adapter_for_script("4fitness"), do: "Elixir.PharmaLive.Scrapers.Adapters.FourFitnessAdapter"
  defp adapter_for_script("amgSport"), do: "Elixir.PharmaLive.Scrapers.Adapters.AmgSportAdapter"
  defp adapter_for_script("adonis"), do: "Elixir.PharmaLive.Scrapers.Adapters.AdonisAdapter"
  defp adapter_for_script("alekSuplementi"), do: "Elixir.PharmaLive.Scrapers.Adapters.AlekSuplementiAdapter"
  defp adapter_for_script("aleksandarMn"), do: "Elixir.PharmaLive.Scrapers.Adapters.AleksandarMnAdapter"
  defp adapter_for_script("apothecary"), do: "Elixir.PharmaLive.Scrapers.Adapters.ApothecaryAdapter"
  defp adapter_for_script("azgard"), do: "Elixir.PharmaLive.Scrapers.Adapters.AzgardAdapter"
  defp adapter_for_script("bazzar"), do: "Elixir.PharmaLive.Scrapers.Adapters.BazzarAdapter"
  defp adapter_for_script("dm"), do: "Elixir.PharmaLive.Scrapers.Adapters.DmAdapter"
  defp adapter_for_script("explode"), do: "Elixir.PharmaLive.Scrapers.Adapters.ExplodeAdapter"
  defp adapter_for_script("exYuFitness"), do: "Elixir.PharmaLive.Scrapers.Adapters.ExYuFitnessAdapter"
  defp adapter_for_script("farmasi"), do: "Elixir.PharmaLive.Scrapers.Adapters.FarmasiAdapter"
  defp adapter_for_script("filly"), do: "Elixir.PharmaLive.Scrapers.Adapters.FillyAdapter"
  defp adapter_for_script("fitLab"), do: "Elixir.PharmaLive.Scrapers.Adapters.FitLabAdapter"
  defp adapter_for_script("flos"), do: "Elixir.PharmaLive.Scrapers.Adapters.FlosAdapter"
  defp adapter_for_script("herba"), do: "Elixir.PharmaLive.Scrapers.Adapters.HerbaAdapter"
  defp adapter_for_script("hiper"), do: "Elixir.PharmaLive.Scrapers.Adapters.HiperAdapter"
  defp adapter_for_script("houseOfSupplements"), do: "Elixir.PharmaLive.Scrapers.Adapters.HouseOfSupplementsAdapter"
  defp adapter_for_script("jankovic"), do: "Elixir.PharmaLive.Scrapers.Adapters.JankovicAdapter"
  defp adapter_for_script("jugofarm"), do: "Elixir.PharmaLive.Scrapers.Adapters.JugofarmAdapter"
  defp adapter_for_script("krsenkovic"), do: "Elixir.PharmaLive.Scrapers.Adapters.KrsenkovicAdapter"
  defp adapter_for_script("lama"), do: "Elixir.PharmaLive.Scrapers.Adapters.LamaAdapter"
  defp adapter_for_script("laurus"), do: "Elixir.PharmaLive.Scrapers.Adapters.LaurusAdapter"
  defp adapter_for_script("livada"), do: "Elixir.PharmaLive.Scrapers.Adapters.LivadaAdapter"
  defp adapter_for_script("maelia"), do: "Elixir.PharmaLive.Scrapers.Adapters.MaeliaAdapter"
  defp adapter_for_script("maxFarm"), do: "Elixir.PharmaLive.Scrapers.Adapters.MaxFarmAdapter"
  defp adapter_for_script("maximalium"), do: "Elixir.PharmaLive.Scrapers.Adapters.MaximaliumAdapter"
  defp adapter_for_script("medXapoteka"), do: "Elixir.PharmaLive.Scrapers.Adapters.MedXApotekaAdapter"
  defp adapter_for_script("melisa"), do: "Elixir.PharmaLive.Scrapers.Adapters.MelisaAdapter"
  defp adapter_for_script("milica"), do: "Elixir.PharmaLive.Scrapers.Adapters.MilicaAdapter"
  defp adapter_for_script("mocBilja"), do: "Elixir.PharmaLive.Scrapers.Adapters.MocBiljaAdapter"
  defp adapter_for_script("natureHub"), do: "Elixir.PharmaLive.Scrapers.Adapters.NatureHubAdapter"
  defp adapter_for_script("oazaZdravlja"), do: "Elixir.PharmaLive.Scrapers.Adapters.OazaZdravljaAdapter"
  defp adapter_for_script("ogistra"), do: "Elixir.PharmaLive.Scrapers.Adapters.OgistraAdapter"
  defp adapter_for_script("oliva"), do: "Elixir.PharmaLive.Scrapers.Adapters.OlivaAdapter"
  defp adapter_for_script("pansport"), do: "Elixir.PharmaLive.Scrapers.Adapters.PansportAdapter"
  defp adapter_for_script("profFarm"), do: "Elixir.PharmaLive.Scrapers.Adapters.ProfFarmAdapter"
  defp adapter_for_script("proteinbox"), do: "Elixir.PharmaLive.Scrapers.Adapters.ProteinboxAdapter"
  defp adapter_for_script("proteini"), do: "Elixir.PharmaLive.Scrapers.Adapters.ProteiniAdapter"
  defp adapter_for_script("ringSport"), do: "Elixir.PharmaLive.Scrapers.Adapters.RingSportAdapter"
  defp adapter_for_script("shopmania"), do: "Elixir.PharmaLive.Scrapers.Adapters.ShopmaniaAdapter"
  defp adapter_for_script("sop"), do: "Elixir.PharmaLive.Scrapers.Adapters.SopAdapter"
  defp adapter_for_script("spartanSuplementi"), do: "Elixir.PharmaLive.Scrapers.Adapters.SpartanSuplementiAdapter"
  defp adapter_for_script("srbotrade"), do: "Elixir.PharmaLive.Scrapers.Adapters.SrbotradeAdapter"
  defp adapter_for_script("superior"), do: "Elixir.PharmaLive.Scrapers.Adapters.SuperiorAdapter"
  defp adapter_for_script("suplementiShop"), do: "Elixir.PharmaLive.Scrapers.Adapters.SuplementiShopAdapter"
  defp adapter_for_script("suplementiSrbija"), do: "Elixir.PharmaLive.Scrapers.Adapters.SuplementiSrbijaAdapter"
  defp adapter_for_script("titaniumSport"), do: "Elixir.PharmaLive.Scrapers.Adapters.TitaniumSportAdapter"
  defp adapter_for_script("vitalikum"), do: "Elixir.PharmaLive.Scrapers.Adapters.VitalikumAdapter"
  defp adapter_for_script("vitaminShop"), do: "Elixir.PharmaLive.Scrapers.Adapters.VitaminShopAdapter"
  defp adapter_for_script("webApoteka"), do: "Elixir.PharmaLive.Scrapers.Adapters.WebApotekaAdapter"
  defp adapter_for_script("xlSport"), do: "Elixir.PharmaLive.Scrapers.Adapters.XlSportAdapter"
  defp adapter_for_script("xSport"), do: "Elixir.PharmaLive.Scrapers.Adapters.XSportAdapter"
  defp adapter_for_script("zelenaApoteka"), do: "Elixir.PharmaLive.Scrapers.Adapters.ZelenaApotekaAdapter"
  defp adapter_for_script("zero"), do: "Elixir.PharmaLive.Scrapers.Adapters.ZeroAdapter"
  defp adapter_for_script("ananas"), do: "Elixir.PharmaLive.Scrapers.Adapters.AnanasAdapter"
  defp adapter_for_script("ananas1"), do: "Elixir.PharmaLive.Scrapers.Adapters.AnanasAdapter"
  defp adapter_for_script("ananas2"), do: "Elixir.PharmaLive.Scrapers.Adapters.AnanasAdapter"
  defp adapter_for_script("ananas3"), do: "Elixir.PharmaLive.Scrapers.Adapters.AnanasAdapter"
  defp adapter_for_script("ananas4"), do: "Elixir.PharmaLive.Scrapers.Adapters.AnanasAdapter"
  defp adapter_for_script("ananas5"), do: "Elixir.PharmaLive.Scrapers.Adapters.AnanasAdapter"
  defp adapter_for_script("ananas6"), do: "Elixir.PharmaLive.Scrapers.Adapters.AnanasAdapter"
  defp adapter_for_script(_), do: "Elixir.PharmaLive.Scrapers.Adapters.PendingAdapter"
end
