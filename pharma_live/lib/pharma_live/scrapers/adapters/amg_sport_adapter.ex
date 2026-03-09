defmodule PharmaLive.Scrapers.Adapters.AmgSportAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @url "https://amgsport.net/shop/?per_page=-1"

  @impl true
  def scrape(_source) do
    case scrape_page(@url, MapSet.new()) do
      {:ok, list, _seen} -> {:ok, list}
      {:error, reason} -> {:error, reason}
    end
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 45_000) do
      products =
        doc
        |> Floki.find(".product-wrapper")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    title = Http.text(node, "h3")

    if title == "" do
      nil
    else
      price_raw = Http.text(node, ".price ins .woocommerce-Price-amount, .price .woocommerce-Price-amount")
      link = Http.attr(node, ".product-image-link", "href")
      image = Http.attr(node, ".product-image-link > img", "src")

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
