defmodule PharmaLive.Scrapers.Adapters.ProteiniAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://rs.proteini.si/proteini",
    "https://rs.proteini.si/aminokiseline",
    "https://rs.proteini.si/mrsavljenje",
    "https://rs.proteini.si/outlet-ponuda",
    "https://rs.proteini.si/bez-grize-savesti",
    "https://rs.proteini.si/kreatin",
    "https://rs.proteini.si/pre-workout",
    "https://rs.proteini.si/energija",
    "https://rs.proteini.si/gaineri",
    "https://rs.proteini.si/zdravlje-i-dobar-osecaj",
    "https://rs.proteini.si/posni-proizvodi",
    "https://rs.proteini.si/hormonski-stimulansi",
    "https://rs.proteini.si/oprema-za-vezbanje",
    "https://rs.proteini.si/dodaci",
    "https://rs.proteini.si/borilacka-oprema"
  ]
  @base_site "https://rs.proteini.si"

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@base_urls, {[], MapSet.new()}, fn url, {acc, seen} ->
        category = url |> String.split("/") |> List.last() |> Kernel.||("")

        case scrape_category(url, category, seen) do
          {list, seen_after} -> {acc ++ list, seen_after}
        end
      end)

    {:ok, products}
  end

  defp scrape_category(url, category, seen) do
    Stream.iterate(0, &(&1 + 1))
    |> Enum.reduce_while({[], seen}, fn idx, {acc, seen_acc} ->
      page_url = if idx == 0, do: url, else: "#{url}?page=#{idx + 1}"

      case scrape_page(page_url, category, seen_acc) do
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
        |> Floki.find(".product-card")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node, category) do
    title = Http.text(node, "h4")

    if title == "" do
      nil
    else
      price_raw = Http.text(node, ".price")
      link = Http.attr(node, ".product-card-image > a", "href") |> Http.absolute_url(@base_site)
      image = Http.attr(node, ".product-card-image img", "src") |> Http.absolute_url(@base_site)

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

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
