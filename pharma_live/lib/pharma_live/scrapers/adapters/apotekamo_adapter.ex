defmodule PharmaLive.Scrapers.Adapters.ApotekamoAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @pages [
    "https://apotekamo.rs/kategorija-proizvoda/zdravlje/?loadMore=9999",
    "https://apotekamo.rs/kategorija-proizvoda/lepota-nega-zastita/?loadMore=9999",
    "https://apotekamo.rs/kategorija-proizvoda/prehrana-i-suplementi/?loadMore=9999",
    "https://apotekamo.rs/kategorija-proizvoda/zdravlje-dece/?loadMore=9999",
    "https://apotekamo.rs/kategorija-proizvoda/zdravlje-zena/?loadMore=9999",
    "https://apotekamo.rs/kategorija-proizvoda/ljubavne-igracke/?loadMore=9999",
    "https://apotekamo.rs/kategorija-proizvoda/zdravlje-muskaraca/?loadMore=9999"
  ]

  @impl true
  def scrape(_source) do
    products =
      Enum.reduce(@pages, {[], MapSet.new()}, fn url, {acc, seen} ->
        case scrape_page(url, seen) do
          {:ok, page_products, seen_after} -> {acc ++ page_products, seen_after}
          {:error, _} -> {acc, seen}
        end
      end)
      |> elem(0)

    {:ok, products}
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 45_000) do
      products =
        doc
        |> Floki.find(".product")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    out_of_stock = node |> Floki.find(".stock.out-of-stock") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, "h3") |> String.replace(",", ".")

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".price ins .woocommerce-Price-amount, .price .woocommerce-Price-amount")
        link = Http.attr(node, "figure > a", "href")
        image = Http.attr(node, "img", "src")

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
