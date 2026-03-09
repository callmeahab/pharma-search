defmodule PharmaLive.Scrapers.Adapters.TitaniumSportAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @url "https://www.titaniumsport.rs/shop/?et_per_page=-1"

  @impl true
  def scrape(_source) do
    case scrape_page(@url, "suplementi", MapSet.new()) do
      {:ok, products, _seen} -> {:ok, products}
      {:error, reason} -> {:error, reason}
    end
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 45_000) do
      products =
        doc
        |> Floki.find(".content-product")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".stock.out-of-stock") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".product-title")

      if title == "" do
        nil
      else
        price_raw =
          case Http.text(node, ".price ins .woocommerce-Price-amount") do
            "" -> Http.text(node, ".price .woocommerce-Price-amount")
            discounted -> discounted
          end

        link = Http.attr(node, ".images-slider-wrapper > a", "href")
        image = Http.attr(node, ".images-slider-wrapper > a > img", "data-src") || Http.attr(node, ".images-slider-wrapper > a > img", "src")

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

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
