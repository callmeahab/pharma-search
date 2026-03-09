defmodule PharmaLive.Scrapers.Adapters.NatureHubAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.naturehub.rs/biljni-suplementi",
    "https://www.naturehub.rs/prirodna-kozmetika",
    "https://www.naturehub.rs/proteini-i-fitness",
    "https://www.naturehub.rs/proizvodi"
  ]
  @base_link "https://www.naturehub.rs"

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@base_urls, {[], MapSet.new()}, fn base_url, {acc, seen} ->
        category = category_from_url(base_url)
        {collected, seen_after} = scrape_category(base_url, category, seen)
        {acc ++ collected, seen_after}
      end)

    {:ok, products}
  end

  defp scrape_category(base_url, category, seen) do
    Stream.iterate(1, &(&1 + 1))
    |> Enum.reduce_while({[], seen}, fn page_num, {acc, seen_acc} ->
      url = "#{base_url}/page-#{page_num}"

      case scrape_page(url, category, seen_acc) do
        {:ok, [], seen_after} -> {:halt, {acc, seen_after}}
        {:ok, list, seen_after} -> {:cont, {acc ++ list, seen_after}}
        {:error, _} -> {:halt, {acc, seen_acc}}
      end
    end)
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 35_000) do
      products =
        doc
        |> Floki.find(".wrapper-grid-view")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".fa.fa-warning") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".title")

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".current-price")
        link = Http.attr(node, ".item-data > .img-wrapper > a", "href")

        image =
          Http.attr(node, ".item-data > .img-wrapper > a > img", "data-original-img") ||
            Http.attr(node, ".item-data > .img-wrapper > a > img", "src")

        image = Http.absolute_url(image, @base_link)

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

  defp category_from_url(base_url) do
    base_url
    |> URI.parse()
    |> Map.get(:path, "")
    |> String.split("/")
    |> List.last()
    |> Kernel.||("unknown")
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
