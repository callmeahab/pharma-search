defmodule PharmaLive.Scrapers.Adapters.DrMaxAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.drmax.rs/lepota.html",
    "https://www.drmax.rs/mama-i-beba.html",
    "https://www.drmax.rs/higijena.html",
    "https://www.drmax.rs/aparati.html",
    "https://www.drmax.rs/zdravlje.html"
  ]

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@base_urls, {[], MapSet.new()}, fn base_url, {acc, seen} ->
        category_products = scrape_category(base_url, seen)
        {acc ++ elem(category_products, 0), elem(category_products, 1)}
      end)

    {:ok, products}
  end

  defp scrape_category(base_url, seen) do
    Stream.iterate(1, &(&1 + 1))
    |> Enum.reduce_while({[], seen, 0}, fn page, {acc, seen_acc, empty} ->
      url = "#{base_url}?p=#{page}"

      case scrape_page(url, seen_acc) do
        {:ok, [], seen_after} ->
          next_empty = empty + 1
          if next_empty >= 1, do: {:halt, {acc, seen_after, next_empty}}, else: {:cont, {acc, seen_after, next_empty}}

        {:ok, list, seen_after} ->
          {:cont, {acc ++ list, seen_after, 0}}

        {:error, _} ->
          next_empty = empty + 1
          if next_empty >= 1, do: {:halt, {acc, seen_acc, next_empty}}, else: {:cont, {acc, seen_acc, next_empty}}
      end
    end)
    |> then(fn {acc, new_seen, _} -> {acc, new_seen} end)
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url) do
      empty = doc |> Floki.find(".message.info.empty") |> Enum.any?()

      if empty do
        {:ok, [], seen}
      else
        products =
          doc
          |> Floki.find(".product-item-info")
          |> Enum.map(&extract_product/1)
          |> Enum.reject(&is_nil/1)

        {unique, seen_after} = dedupe(products, seen)
        {:ok, unique, seen_after}
      end
    end
  end

  defp extract_product(node) do
    in_stock = node |> Floki.find(".stock.available") |> Enum.any?()

    if not in_stock do
      nil
    else
      title = Http.text(node, ".product-item-link")

      if title == "" do
        nil
      else
        link = Http.attr(node, ".product-item-link", "href")

        image =
          Http.attr(node, "picture.product-image-photo source[type='image/webp']", "srcset") ||
            Http.attr(node, "picture.product-image-photo img.product-image-photo", "src") ||
            Http.attr(node, ".product-image-photo", "src")

        price_raw = Http.text(node, "[data-price-type='finalPrice']")

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
