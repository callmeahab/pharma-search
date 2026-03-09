defmodule PharmaLive.Scrapers.Adapters.LilyAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.lilly.rs/zdravlje",
    "https://www.lilly.rs/sminka",
    "https://www.lilly.rs/lepota-i-nega",
    "https://www.lilly.rs/parfemi-i-toaletne-vode",
    "https://www.lilly.rs/decji-kutak",
    "https://www.lilly.rs/muski-kutak",
    "https://www.lilly.rs/tekstil",
    "https://www.lilly.rs/domacinstvo",
    "https://www.lilly.rs/nasi-proizvodi",
    "https://www.lilly.rs/ekskluzivni-proizvodi",
    "https://www.lilly.rs/novi-proizvodi",
    "https://www.lilly.rs/poklon-setovi",
    "https://www.lilly.rs/loyalty-program"
  ]

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@base_urls, {[], MapSet.new()}, fn base_url, {acc, seen} ->
        {category, seen_after} = scrape_category(base_url, seen)
        {acc ++ category, seen_after}
      end)

    {:ok, products}
  end

  defp scrape_category(base_url, seen) do
    Stream.iterate(1, &(&1 + 1))
    |> Enum.reduce_while({[], seen, 0}, fn page, {acc, seen_acc, empty_count} ->
      url = "#{base_url}?p=#{page}&product_list_limit=54"

      case scrape_page(url, seen_acc) do
        {:ok, [], seen_after} ->
          next_empty = empty_count + 1

          if next_empty >= 2 do
            {:halt, {acc, seen_after, next_empty}}
          else
            {:cont, {acc, seen_after, next_empty}}
          end

        {:ok, page_products, seen_after} ->
          {:cont, {acc ++ page_products, seen_after, 0}}

        {:error, _} ->
          next_empty = empty_count + 1

          if next_empty >= 2 do
            {:halt, {acc, seen_acc, next_empty}}
          else
            {:cont, {acc, seen_acc, next_empty}}
          end
      end
    end)
    |> then(fn {list, seen_after, _} -> {list, seen_after} end)
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 30_000) do
      products =
        doc
        |> Floki.find("#maincontent .product-item")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    title = Http.text(node, ".text-base.truncate-title-2")

    if title == "" do
      nil
    else
      price_raw = Http.text(node, ".flex.font-medium.text-body-l")
      link = Http.attr(node, "a", "href")
      image = Http.attr(node, "img", "src")

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
      if MapSet.member?(seen_acc, product.title) do
        {acc, seen_acc}
      else
        {[product | acc], MapSet.put(seen_acc, product.title)}
      end
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
