defmodule PharmaLive.Scrapers.Adapters.ApotekarOnlineAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_url "https://apotekar-online.rs/prodavnica/"

  @impl true
  def scrape(_source) do
    products =
      Stream.iterate(1, &(&1 + 1))
      |> Enum.reduce_while({[], MapSet.new(), 0}, fn page, {acc, seen, empty_count} ->
        url = page_url(page)

        case scrape_page(url, seen) do
          {:ok, [], seen_after} ->
            next_empty = empty_count + 1
            if next_empty >= 2, do: {:halt, {acc, seen_after, next_empty}}, else: {:cont, {acc, seen_after, next_empty}}

          {:ok, list, seen_after} ->
            {:cont, {acc ++ list, seen_after, 0}}

          {:error, _} ->
            next_empty = empty_count + 1
            if next_empty >= 2, do: {:halt, {acc, seen, next_empty}}, else: {:cont, {acc, seen, next_empty}}
        end
      end)
      |> elem(0)

    {:ok, products}
  end

  defp page_url(1), do: @base_url
  defp page_url(page), do: "#{@base_url}page/#{page}/"

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 30_000) do
      products =
        doc
        |> Floki.find(".product")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    title = Http.text(node, "h2")

    if title == "" do
      nil
    else
      price_raw = Http.text(node, ".price ins .woocommerce-Price-amount, .price .woocommerce-Price-amount")
      link = Http.attr(node, ".product > a", "href") || Http.attr(node, "a", "href")
      image = Http.attr(node, ".product > a > img", "src") || Http.attr(node, "img", "src")

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
