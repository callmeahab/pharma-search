defmodule PharmaLive.Scrapers.Adapters.OlivaAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.oliva.rs/zdravlje?limit=100&page=",
    "https://www.oliva.rs/kosa?limit=100&page=",
    "https://www.oliva.rs/sminka?limit=100&page=",
    "https://www.oliva.rs/nega?limit=100&page=",
    "https://www.oliva.rs/mame-i-deca?limit=100&page=",
    "https://www.oliva.rs/muskarci?limit=100&page=",
    "https://www.oliva.rs/kucni-ljubimci?limit=100&page=",
    "https://www.oliva.rs/sportska-suplementacija?limit=100&page=",
    "https://www.oliva.rs/snizene-cene?limit=100&page="
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
    |> Enum.reduce_while({[], seen, 0}, fn page_num, {acc, seen_acc, failures} ->
      url = "#{base_url}#{page_num}"

      case scrape_page(url, seen_acc) do
        {:ok, [], seen_after} ->
          next_failures = failures + 1

          if next_failures >= 2 do
            {:halt, {acc, seen_after, next_failures}}
          else
            {:cont, {acc, seen_after, next_failures}}
          end

        {:ok, list, seen_after} ->
          {:cont, {acc ++ list, seen_after, 0}}

        {:error, _} ->
          next_failures = failures + 1

          if next_failures >= 2 do
            {:halt, {acc, seen_acc, next_failures}}
          else
            {:cont, {acc, seen_acc, next_failures}}
          end
      end
    end)
    |> then(fn {list, seen_after, _} -> {list, seen_after} end)
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 35_000) do
      products =
        doc
        |> Floki.find(".product-thumb")
        |> Enum.map(&extract_product(&1, category_from_url(url)))
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".aaa") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".name")

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".price-new, .price-normal")
        link = Http.attr(node, ".name a", "href")

        image =
          Http.attr(node, "a img", "data-src") ||
            Http.attr(node, "a img", "src") ||
            Http.attr(node, "a img", "data-original")

        image = if is_binary(image) and String.starts_with?(image, "data:image"), do: nil, else: image

        %Product{
          external_id: link,
          title: title,
          url: link,
          price_cents: Price.parse_cents(price_raw),
          currency: "RSD",
          in_stock: true,
          raw_payload: %{price_raw: price_raw, image: image, category: category}
        }
      end
    end
  end

  defp category_from_url(url) do
    url
    |> URI.parse()
    |> Map.get(:path, "")
    |> String.split("/", trim: true)
    |> List.first()
    |> Kernel.||("")
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
