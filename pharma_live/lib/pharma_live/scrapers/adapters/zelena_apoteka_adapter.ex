defmodule PharmaLive.Scrapers.Adapters.ZelenaApotekaAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://prodaja.zelena-apoteka.com/catalog/ajur-veda-21125/p",
    "https://prodaja.zelena-apoteka.com/catalog/aromaterapija-21506/p",
    "https://prodaja.zelena-apoteka.com/catalog/bahove-cvetne-kapi-22022/p",
    "https://prodaja.zelena-apoteka.com/catalog/bolnicki-program-30967/p",
    "https://prodaja.zelena-apoteka.com/catalog/carape-za-vene-30961/p",
    "https://prodaja.zelena-apoteka.com/catalog/dodaci-ishrani-19598/p",
    "https://prodaja.zelena-apoteka.com/catalog/homeopatija-25376/p",
    "https://prodaja.zelena-apoteka.com/catalog/medicinska-kozmetika-20087/p",
    "https://prodaja.zelena-apoteka.com/catalog/obolela-i-ostecena-koza-31116/p",
    "https://prodaja.zelena-apoteka.com/catalog/preparati-protiv-insekata-31016/p",
    "https://prodaja.zelena-apoteka.com/catalog/preparati-za-higijenu-31124/p",
    "https://prodaja.zelena-apoteka.com/catalog/prirodna-kozmetika-20057/p",
    "https://prodaja.zelena-apoteka.com/catalog/program-za-bebe-30951/p",
    "https://prodaja.zelena-apoteka.com/catalog/zdrava-hrana-31158/p",
    "https://prodaja.zelena-apoteka.com/catalog/kratak-rok-31161/p",
    "https://prodaja.zelena-apoteka.com/catalog/razno-31159/p"
  ]

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@base_urls, {[], MapSet.new()}, fn base_url, {acc, seen} ->
        category = category_from_base_url(base_url)
        {collected, seen_after} = scrape_category(base_url, category, seen)
        {acc ++ collected, seen_after}
      end)

    {:ok, products}
  end

  defp scrape_category(base_url, category, seen) do
    Stream.iterate(1, &(&1 + 1))
    |> Enum.reduce_while({[], seen}, fn page_num, {acc, seen_acc} ->
      url = "#{base_url}#{page_num}"

      case scrape_page(url, category, seen_acc) do
        {:ok, [], seen_after} -> {:halt, {acc, seen_after}}
        {:ok, list, seen_after} -> {:cont, {acc ++ list, seen_after}}
        {:error, _} -> {:halt, {acc, seen_acc}}
      end
    end)
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 40_000) do
      empty_page = doc |> Floki.find(".message.info.empty") |> Enum.any?()

      if empty_page do
        {:ok, [], seen}
      else
        products =
          doc
          |> Floki.find(".product.product--grid")
          |> Enum.map(&extract_product(&1, category))
          |> Enum.reject(&is_nil/1)

        {unique, seen_after} = dedupe(products, seen)
        {:ok, unique, seen_after}
      end
    end
  end

  defp extract_product(node, category) do
    title = Http.text(node, ".product__name")
    price_raw = Http.text(node, ".product__info--price-gross span") |> String.replace(~r/\s+RSD$/u, "") |> String.trim()
    link = Http.attr(node, ".product__name", "href")
    image = Http.attr(node, ".grid-image__image", "src")

    if title == "" or price_raw == "" or is_nil(link) do
      nil
    else
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

  defp category_from_base_url(base_url) do
    base_url
    |> String.split("/")
    |> Enum.reject(&(&1 == ""))
    |> Enum.slice(-2, 1)
    |> List.first()
    |> Kernel.||("")
    |> String.replace(~r/-\d+$/u, "")
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
