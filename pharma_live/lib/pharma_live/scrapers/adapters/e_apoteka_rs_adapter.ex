defmodule PharmaLive.Scrapers.Adapters.EApotekaRsAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_url "https://www.eapoteka.rs/sr/svi-proizvodi/"

  @impl true
  def scrape(_source) do
    products =
      Stream.iterate(1, &(&1 + 1))
      |> Enum.reduce_while({[], MapSet.new(), 0}, fn page_number, {acc, seen, empty_count} ->
        url = "#{@base_url}#{page_number}?limit=48"

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

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 30_000) do
      products =
        doc
        |> Floki.find(".product-preview-item")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    title = Http.text(node, "h3")

    if title == "" do
      nil
    else
      price_raw = Http.text(node, ".price") |> String.replace(~r/[^\d,\.]/u, "")
      link = Http.attr(node, "h3 > a", "href")
      image = Http.attr(node, ".image-wrapper img", "data-src") || Http.attr(node, ".image-wrapper img", "src")
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

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
