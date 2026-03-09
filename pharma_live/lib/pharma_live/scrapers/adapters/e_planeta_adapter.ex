defmodule PharmaLive.Scrapers.Adapters.EPlanetaAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_url "https://eplaneta.rs/sport-i-hobi/suplementi.html"

  @impl true
  def scrape(_source) do
    products =
      Stream.iterate(1, &(&1 + 1))
      |> Enum.reduce_while({[], MapSet.new()}, fn page_number, {acc, seen} ->
        url = "#{@base_url}?p=#{page_number}"

        case scrape_page(url, seen) do
          {:ok, [], seen_after} -> {:halt, {acc, seen_after}}
          {:ok, list, seen_after} -> {:cont, {acc ++ list, seen_after}}
          {:error, _} -> {:halt, {acc, seen}}
        end
      end)
      |> elem(0)

    {:ok, products}
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 30_000) do
      products =
        doc
        |> Floki.find(".products li")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    out_of_stock = node |> Floki.find(".ast-shop-product-out-of-stock") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".product-item-name")

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".price")
        link = Http.attr(node, ".product-item-photo", "href")
        image = Http.attr(node, ".product-item-photo img", "src")

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
