defmodule PharmaLive.Scrapers.Adapters.ApotekaSunceAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.apotekasunce.rs/sr/proizvodi/zdravlje",
    "https://www.apotekasunce.rs/sr/proizvodi/vitamini-i-minerali",
    "https://www.apotekasunce.rs/sr/proizvodi/zene-i-muskarci",
    "https://www.apotekasunce.rs/sr/proizvodi/deca-i-bebe",
    "https://www.apotekasunce.rs/sr/proizvodi/nega",
    "https://www.apotekasunce.rs/sr/proizvodi/kozmetika",
    "https://www.apotekasunce.rs/sr/proizvodi/medicinska-sredstva"
  ]

  @base_host "https://www.apotekasunce.rs"

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
      url = "#{base_url}/#{page_number}?limit=48"

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
      price_raw = Http.text(node, ".price")
      link = Http.attr(node, "h3 > a", "href") |> Http.absolute_url(@base_host)

      image =
        Http.attr(node, ".image-wrapper img", "data-src") ||
          Http.attr(node, ".image-wrapper img", "src") ||
          Http.attr(node, ".image-wrapper img", "data-original")

      image = if is_binary(image) and String.starts_with?(image, "data:image"), do: nil, else: image

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

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
