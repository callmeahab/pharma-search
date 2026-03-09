defmodule PharmaLive.Scrapers.Adapters.SuperiorAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_url "https://www.superior14.rs/proizvodi"
  @site_base "https://www.superior14.rs"

  @impl true
  def scrape(_source) do
    products =
      Stream.iterate(1, &(&1 + 1))
      |> Enum.reduce_while({[], MapSet.new()}, fn page_num, {acc, seen} ->
        url = if page_num == 1, do: @base_url, else: "#{@base_url}/strana-#{page_num}"

        case scrape_page(url, "suplementi", seen) do
          {:ok, [], _has_next, seen_after} -> {:halt, {acc, seen_after}}
          {:ok, list, false, seen_after} -> {:halt, {acc ++ list, seen_after}}
          {:ok, list, true, seen_after} -> {:cont, {acc ++ list, seen_after}}
          {:error, _} -> {:halt, {acc, seen}}
        end
      end)
      |> elem(0)

    {:ok, products}
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 40_000) do
      products =
        doc
        |> Floki.find(".block")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      has_next = doc |> Floki.find(".next") |> Enum.any?()
      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, has_next, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".stock.out-of-stock") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".title")
      price_raw = Http.text(node, ".price") |> String.replace("RSD", "") |> String.trim()

      if title == "" or price_raw == "" do
        nil
      else
        link = Http.attr(node, "a", "href") |> Http.absolute_url(@site_base)
        image = Http.attr(node, "figure.zoomzoom img", "src") || Http.attr(node, "figure.zoomzoom img", "data-src")

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
