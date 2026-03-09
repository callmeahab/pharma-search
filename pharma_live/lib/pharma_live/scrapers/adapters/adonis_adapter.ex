defmodule PharmaLive.Scrapers.Adapters.AdonisAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.adonisapoteka.rs/dijetetski-suplementi/prikazi-100",
    "https://www.adonisapoteka.rs/nega-i-zastita/prikazi-100",
    "https://www.adonisapoteka.rs/kozmetika/prikazi-100",
    "https://www.adonisapoteka.rs/bebi-program/prikazi-100"
  ]

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@base_urls, {[], MapSet.new()}, fn base_url, {acc, seen} ->
        {collected, seen_after} = scrape_category(base_url, seen)
        {acc ++ collected, seen_after}
      end)

    {:ok, products}
  end

  defp scrape_category(base_url, seen) do
    Stream.iterate(1, &(&1 + 1))
    |> Enum.reduce_while({[], seen, 0}, fn page_number, {acc, seen_acc, empty_count} ->
      url = if page_number == 1, do: base_url, else: "#{base_url}/page-#{page_number}"

      case scrape_page(url, seen_acc) do
        {:ok, [], seen_after} ->
          next_empty = empty_count + 1
          if next_empty >= 2, do: {:halt, {acc, seen_after, next_empty}}, else: {:cont, {acc, seen_after, next_empty}}

        {:ok, list, seen_after} ->
          {:cont, {acc ++ list, seen_after, 0}}

        {:error, _} ->
          next_empty = empty_count + 1
          if next_empty >= 2, do: {:halt, {acc, seen_acc, next_empty}}, else: {:cont, {acc, seen_acc, next_empty}}
      end
    end)
    |> then(fn {list, seen_after, _} -> {list, seen_after} end)
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 30_000) do
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
        price_raw = Http.text(node, ".price-new, .price-normal")
        link = Http.attr(node, ".name a", "href")

        image =
          Http.attr(node, "a img", "data-src") ||
            Http.attr(node, "a img", "src") ||
            Http.attr(node, "a img", "data-original")

        image = if is_binary(image) and String.starts_with?(image, "data:image"), do: nil, else: image

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
