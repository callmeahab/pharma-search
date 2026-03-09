defmodule PharmaLive.Scrapers.Adapters.HiperAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.hiper.rs/sport-i-fitness/",
    "https://www.hiper.rs/higijena-i-kozmetika/",
    "https://www.hiper.rs/apoteka/"
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
      url = "#{base_url}?p=#{page_num}"

      case scrape_page(url, seen_acc) do
        {:ok, [], seen_after} -> {:halt, {acc, seen_after}}
        {:ok, list, seen_after} -> {:cont, {acc ++ list, seen_after}}
        {:error, _} -> {:halt, {acc, seen_acc}}
      end
    end)
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 35_000) do
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
    title = Http.text(node, ".product-item-link")

    if title == "" do
      nil
    else
      price_raw = Http.text(node, ".special-price .price, .price-final_price .price")
      link = Http.attr(node, ".product-item-link", "href")
      image = Http.attr(node, ".product-image-photo", "src")

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

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
