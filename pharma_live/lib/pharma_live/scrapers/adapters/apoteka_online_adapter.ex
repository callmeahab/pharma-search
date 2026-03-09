defmodule PharmaLive.Scrapers.Adapters.ApotekaOnlineAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.apoteka-online.rs/catalog/mame-i-bebe-novogodisnja-ponuda-125",
    "https://www.apoteka-online.rs/catalog/zdravlje-novogodisnja-ponuda-124",
    "https://www.apoteka-online.rs/catalog/nega-lica-tela-i-kose-novogodisnja-ponuda-123",
    "https://www.apoteka-online.rs/catalog/dermo-kozmetika-33",
    "https://www.apoteka-online.rs/catalog/nega-lica-69",
    "https://www.apoteka-online.rs/catalog/imunitet-14",
    "https://www.apoteka-online.rs/catalog/vitamini-i-minerali-18",
    "https://www.apoteka-online.rs/catalog/bebe-i-deca-19",
    "https://www.apoteka-online.rs/catalog/trudnoca-i-dojenje-22",
    "https://www.apoteka-online.rs/catalog/varenje-i-metabolizam-16"
  ]

  @base_host "https://www.apoteka-online.rs"

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
      url = "#{base_url}/p#{page_number}"

      case scrape_page(url, seen_acc) do
        {:ok, [], seen_after} ->
          next_empty = empty_count + 1
          if next_empty >= 2, do: {:halt, {acc, seen_after, next_empty}}, else: {:cont, {acc, seen_after, next_empty}}

        {:ok, page_products, seen_after} ->
          {:cont, {acc ++ page_products, seen_after, 0}}

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
        |> Floki.find(".product.product--grid")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    out_of_stock = node |> Floki.find(".grid-image.grid-image--out-of-stock") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".product__name")

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".product__info.product__info--price-gross")
        link = Http.attr(node, ".grid-image__link", "href") |> Http.absolute_url(@base_host)

        image =
          Http.attr(node, ".grid-image__image-wrapper > img", "data-src") ||
            Http.attr(node, ".grid-image__image-wrapper > img", "src")

        %Product{
          external_id: link,
          title: title,
          url: link,
          price_cents: Price.parse_cents(price_raw),
          currency: "RSD",
          in_stock: true,
          raw_payload: %{price_raw: price_raw, image: Http.absolute_url(image, @base_host)}
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
