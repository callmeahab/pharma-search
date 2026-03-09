defmodule PharmaLive.Scrapers.Adapters.EApotekaNetAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://eapoteka.net/proizvodi/suplementi-parafarmaceutika/",
    "https://eapoteka.net/proizvodi/veterinarska-apoteka/",
    "https://eapoteka.net/proizvodi/poljoprivredna-apoteka/"
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
    |> Enum.reduce_while({[], seen, 0}, fn page_num, {acc, seen_acc, empty_count} ->
      url = "#{base_url}page/#{page_num}"

      case scrape_page(url, seen_acc) do
        {:ok, [], seen_after} ->
          next_empty = empty_count + 1
          if next_empty >= 1, do: {:halt, {acc, seen_after, next_empty}}, else: {:cont, {acc, seen_after, next_empty}}

        {:ok, page_products, seen_after} ->
          {:cont, {acc ++ page_products, seen_after, 0}}

        {:error, _} ->
          next_empty = empty_count + 1
          if next_empty >= 1, do: {:halt, {acc, seen_acc, next_empty}}, else: {:cont, {acc, seen_acc, next_empty}}
      end
    end)
    |> then(fn {list, seen_after, _} -> {list, seen_after} end)
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url) do
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
      price_raw = Http.text(node, ".price .woocommerce-Price-amount")
      link = Http.attr(node, ".product > a", "href") || Http.attr(node, "a", "href")
      image = Http.attr(node, ".product > a > img", "src") || Http.attr(node, "img", "src")
      image = if is_binary(image) and String.starts_with?(image, "//"), do: "https:" <> image, else: image

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
