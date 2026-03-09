defmodule PharmaLive.Scrapers.Adapters.LamaAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.lama.rs/lamavita-zdravlje",
    "https://www.lama.rs/proteini",
    "https://www.lama.rs/povecanje-misicne-mase",
    "https://www.lama.rs/aminokiseline",
    "https://www.lama.rs/kreatini"
  ]

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@base_urls, {[], MapSet.new()}, fn base_url, {acc, seen} ->
        url = "#{base_url}?items_per_page=All"

        case scrape_page(url, seen) do
          {:ok, list, seen_after} -> {acc ++ list, seen_after}
          {:error, _} -> {acc, seen}
        end
      end)

    {:ok, products}
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 35_000) do
      products =
        doc
        |> Floki.find(".shopBoxProdN")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    title = Http.text(node, ".pTl")

    if title == "" do
      nil
    else
      price_raw = Http.text(node, ".priceProdN p:last-child")
      link = Http.attr(node, ".shopBoxProdN > a", "href")
      image = Http.attr(node, ".shopBoxProdImg > img", "src")

      %Product{
        external_id: link,
        title: title,
        url: link,
        price_cents: Price.parse_cents(price_raw),
        currency: "RSD",
        in_stock: true,
        raw_payload: %{price_raw: price_raw, image: image}
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
