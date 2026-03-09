defmodule PharmaLive.Scrapers.Adapters.ApotekaNetAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_url "https://www.apotekanet.rs"

  @impl true
  def scrape(_source) do
    products =
      Stream.iterate(1, &(&1 + 1))
      |> Enum.reduce_while({[], MapSet.new(), 0}, fn page, {acc, seen, empty_pages} ->
        url = "#{@base_url}/katalog?limit=100&page=#{page}"

        case scrape_page(url, seen) do
          {:ok, [], seen_after} ->
            next_empty = empty_pages + 1
            if next_empty >= 2, do: {:halt, {acc, seen_after, next_empty}}, else: {:cont, {acc, seen_after, next_empty}}

          {:ok, page_products, seen_after} ->
            {:cont, {acc ++ page_products, seen_after, 0}}

          {:error, _} ->
            next_empty = empty_pages + 1
            if next_empty >= 2, do: {:halt, {acc, seen, next_empty}}, else: {:cont, {acc, seen, next_empty}}
        end
      end)
      |> elem(0)

    {:ok, products}
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url) do
      products =
        doc
        |> Floki.find(".product-thumb")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    out_of_stock = node |> Floki.find(".out-of-stock") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".name")

      if title == "" do
        nil
      else
        link = Http.attr(node, ".name a", "href") |> Http.absolute_url(@base_url)
        image = Http.attr(node, "a img", "src") |> Http.absolute_url(@base_url)
        price_raw = Http.text(node, ".price-new, .price-normal")

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
      if MapSet.member?(seen_acc, product.title) do
        {acc, seen_acc}
      else
        {[product | acc], MapSet.put(seen_acc, product.title)}
      end
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
