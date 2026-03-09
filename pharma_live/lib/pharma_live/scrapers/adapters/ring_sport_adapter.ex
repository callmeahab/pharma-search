defmodule PharmaLive.Scrapers.Adapters.RingSportAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @url "https://www.ringsport.rs/suplementi"

  @impl true
  def scrape(_source) do
    case scrape_page(@url, "suplementi", MapSet.new()) do
      {:ok, products, _seen} -> {:ok, products}
      {:error, reason} -> {:error, reason}
    end
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 35_000) do
      products =
        doc
        |> Floki.find(".responsive-container")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".rasprodato") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, "h4")

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".price")
        link = Http.attr(node, ".slika.rems > a", "href")
        image = Http.attr(node, ".slika.rems > a > img", "src")

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
