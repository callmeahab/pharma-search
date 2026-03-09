defmodule PharmaLive.Scrapers.Adapters.SrbotradeAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @site_base "https://www.apotekasrbotrade.rs/"
  @pages [
    "https://www.apotekasrbotrade.rs/srpski/proizvodi/dodaci-ishrani?page=9999",
    "https://www.apotekasrbotrade.rs/srpski/proizvodi/kozmetika-444?page=9999",
    "https://www.apotekasrbotrade.rs/srpski/proizvodi/nega-i-zastita-2?page=9999"
  ]

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@pages, {[], MapSet.new()}, fn page_url, {acc, seen} ->
        category = category_from_url(page_url)

        case scrape_page(page_url, category, seen) do
          {:ok, list, seen_after} -> {acc ++ list, seen_after}
          {:error, _} -> {acc, seen}
        end
      end)

    {:ok, products}
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 35_000) do
      products =
        doc
        |> Floki.find(".productItemWrapper")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".offStock") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".title") |> String.replace(",", ".")

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".price")
        link = Http.attr(node, "a", "href") |> Http.absolute_url(@site_base)
        image = Http.attr(node, "img", "src") |> Http.absolute_url(@site_base)

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

  defp category_from_url(url) do
    url
    |> String.split("/proizvodi/")
    |> Enum.at(1, "")
    |> String.split("?")
    |> List.first()
    |> Kernel.||("")
    |> String.replace(~r/\d+/u, "")
    |> String.trim()
    |> String.trim_trailing("-")
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
