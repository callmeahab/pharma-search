defmodule PharmaLive.Scrapers.Adapters.MaximaliumAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.maximalium.rs/whey-protein-2",
    "https://www.maximalium.rs/kreatin-16",
    "https://www.maximalium.rs/tribulus-terrestis-12",
    "https://www.maximalium.rs/amino-kiseline-4",
    "https://www.maximalium.rs/gaineri-proteini-za-masu-15",
    "https://www.maximalium.rs/sagorevac-masti-11",
    "https://www.maximalium.rs/vitamini-i-minerali-18",
    "https://www.maximalium.rs/ugljeni-hidrati-nadoknada-energije-13",
    "https://www.maximalium.rs/paketi-23",
    "https://www.maximalium.rs/sportska-oprema-14",
    "https://www.maximalium.rs/paketi-31"
  ]
  @base_link "https://www.maximalium.rs"

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
        |> Floki.find(".shop-content .product-article-item")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    out_of_stock = node |> Floki.find(".currently-not-available") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".single-product__title")
      price_raw = Http.text(node, ".sale-price span")

      if title == "" or price_raw == "" do
        nil
      else
        link = Http.attr(node, ".product-img a", "href") |> Http.absolute_url(@base_link)
        image = Http.attr(node, ".product-img img", "src")

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
