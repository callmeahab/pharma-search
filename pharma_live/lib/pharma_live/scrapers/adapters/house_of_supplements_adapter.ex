defmodule PharmaLive.Scrapers.Adapters.HouseOfSupplementsAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://houseofsupplements.rs/product-category/protein",
    "https://houseofsupplements.rs/product-category/aminokiseline",
    "https://houseofsupplements.rs/product-category/sagorevaci-masti",
    "https://houseofsupplements.rs/product-category/kreatini",
    "https://houseofsupplements.rs/product-category/vitamini-i-minerali"
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
    |> Enum.reduce_while({[], seen}, fn page_num, {acc, seen_acc} ->
      url = "#{base_url}/page/#{page_num}"

      case scrape_page(url, seen_acc) do
        {:ok, [], seen_after} -> {:halt, {acc, seen_after}}
        {:ok, list, seen_after} -> {:cont, {acc ++ list, seen_after}}
        {:error, _} -> {:halt, {acc, seen_acc}}
      end
    end)
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 35_000) do
      products =
        doc
        |> Floki.find(".product-small")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    out_of_stock = node |> Floki.find(".out-of-stock-label") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".name.product-title")

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".price ins .woocommerce-Price-amount, .price .woocommerce-Price-amount")
        link = Http.attr(node, ".box-image a", "href")
        image = Http.attr(node, ".box-image img", "src")

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
