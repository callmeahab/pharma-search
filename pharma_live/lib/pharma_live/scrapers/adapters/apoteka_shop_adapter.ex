defmodule PharmaLive.Scrapers.Adapters.ApotekaShopAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.apotekashop.rs/dijetetski-suplementi",
    "https://www.apotekashop.rs/bebi-program",
    "https://www.apotekashop.rs/kozmetika",
    "https://www.apotekashop.rs/nega-i-zastita",
    "https://www.apotekashop.rs/obuca",
    "https://www.apotekashop.rs/bebi-program/igracke"
  ]

  @base_host "https://www.apotekashop.rs"

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
    |> Enum.reduce_while({[], seen}, fn page_num, {acc, seen_acc} ->
      url = "#{base_url}/page-#{page_num}?limit=100"

      case scrape_page(url, seen_acc) do
        {:ok, [], seen_after} -> {:halt, {acc, seen_after}}
        {:ok, page_products, seen_after} -> {:cont, {acc ++ page_products, seen_after}}
        {:error, _} -> {:halt, {acc, seen_acc}}
      end
    end)
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
        price_raw = Http.text(node, ".price-new, .price-normal")
        link = Http.attr(node, ".name a", "href") |> Http.absolute_url(@base_host)

        image =
          Http.attr(node, "a img", "data-src") ||
            Http.attr(node, "a img", "src") ||
            Http.attr(node, "a img", "data-original")

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
