defmodule PharmaLive.Scrapers.Adapters.XSportAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://xsport.rs/besplatna_dostava",
    "https://xsport.rs/webcena",
    "https://xsport.rs/grupa/u_borbi_protiv_virusa",
    "https://xsport.rs/grupa/one-dose-jedna-doza",
    "https://xsport.rs/grupa/sagorevaci_masti",
    "https://xsport.rs/grupa/veganski-proteini-100-biljnog-porekla",
    "https://xsport.rs/grupa/vitamini_minerali_multivitamini",
    "https://xsport.rs/grupa/poboljsanje_raspolozenje_i_sna",
    "https://xsport.rs/grupa/anti",
    "https://xsport.rs/grupa/minerali-1",
    "https://xsport.rs/grupa/regulisanje-secera-i-pomoc-pri-insulinskoj-rezistenciji",
    "https://xsport.rs/grupa/podrska-i-regeracija-jetre",
    "https://xsport.rs/grupa/nootropici_i_proizvodi_za_bolju_koncetraciju_i_memoriju",
    "https://xsport.rs/grupa/povecanje_plodnosti_poboljsanje_potencije_zastita_prostate",
    "https://xsport.rs/grupa/regulacija-hormona-stitnezlezde",
    "https://xsport.rs/grupa/stimulatori_hormona",
    "https://xsport.rs/grupa/proteini",
    "https://xsport.rs/grupa/omega_3_i_esencijalne_masne_kiseline",
    "https://xsport.rs/grupa/probava_digestivni_enzimi_detoksikacija_organizma",
    "https://xsport.rs/grupa/aminokiseline",
    "https://xsport.rs/grupa/kreatin",
    "https://xsport.rs/grupa/no_reaktori_i_preworkou_suplementi",
    "https://xsport.rs/grupa/biljni_ekstrakti",
    "https://xsport.rs/grupa/stimulatori_na_bazi_kofeina_i_taurina",
    "https://xsport.rs/grupa/poveanje_performansi",
    "https://xsport.rs/grupa/proteinske_okoladice_gelovi_isotonini_napici",
    "https://xsport.rs/grupa/garderoba",
    "https://xsport.rs/grupa/body_font_faceverdana_colorff0066_size3font_enski_kutakbody_"
  ]

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@base_urls, {[], MapSet.new()}, fn base_url, {acc, seen} ->
        category = category_from_url(base_url)
        {collected, seen_after} = scrape_category(base_url, category, seen)
        {acc ++ collected, seen_after}
      end)

    {:ok, products}
  end

  defp scrape_category(base_url, category, seen) do
    Stream.iterate(1, &(&1 + 1))
    |> Enum.reduce_while({[], seen}, fn page_num, {acc, seen_acc} ->
      url = "#{base_url}?page=#{page_num}"

      case scrape_page(url, category, seen_acc) do
        {:ok, [], seen_after} -> {:halt, {acc, seen_after}}
        {:ok, list, seen_after} -> {:cont, {acc ++ list, seen_after}}
        {:error, _} -> {:halt, {acc, seen_acc}}
      end
    end)
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 40_000) do
      products =
        doc
        |> Floki.find(".product-list-item")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".fa.fa-warning") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".product-list-title")
      price_raw = Http.text(node, ".price") |> String.split("-") |> List.first() |> Kernel.||("") |> String.trim()

      if title == "" or price_raw == "" do
        nil
      else
        link = Http.attr(node, ".product-list-title", "href")
        image = Http.attr(node, ".img-responsive", "src")

        %Product{
          external_id: link,
          title: title,
          url: link,
          price_cents: Price.parse_cents(price_raw),
          currency: "RSD",
          in_stock: true,
          raw_payload: %{price_raw: price_raw, image: image, category: category}
        }
      end
    end
  end

  defp category_from_url(base_url) do
    base_url
    |> URI.parse()
    |> Map.get(:path, "")
    |> String.split("/", trim: true)
    |> List.last()
    |> Kernel.||("unknown")
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
