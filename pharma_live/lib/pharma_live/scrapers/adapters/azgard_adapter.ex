defmodule PharmaLive.Scrapers.Adapters.AzgardAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.azgardnutrition.rs/proizvodi/azgard-proteini?sort=4&show=48",
    "https://www.azgardnutrition.rs/proizvodi/azgard-gejneri-gainers?sort=4&show=48",
    "https://www.azgardnutrition.rs/proizvodi/aminokiseline?sort=4&show=48",
    "https://www.azgardnutrition.rs/proizvodi/azgard-kreatini?sort=4&show=48",
    "https://www.azgardnutrition.rs/proizvodi/azgard-vitamini?sort=4&show=48"
  ]

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@base_urls, {[], MapSet.new()}, fn url, {acc, seen} ->
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
        |> Floki.find(".shop-product-wrap.grid.row .product-item")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    out_of_stock = node |> Floki.find("button[disabled]") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".product-name h4 a")

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".regular-price")
        link = Http.attr(node, ".product-name h4 a", "href")
        image = Http.attr(node, ".product-thumb img", "src")

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
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
