defmodule PharmaLive.Scrapers.Adapters.MaxFarmAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.markfarm.rs/category/kozmetika/1498/",
    "https://www.markfarm.rs/category/beauty/36413/",
    "https://www.markfarm.rs/category/probiotici-i-enzimi/1494/",
    "https://www.markfarm.rs/category/vitamini-i-minerali/1495/",
    "https://www.markfarm.rs/category/suplementi/1493/",
    "https://www.markfarm.rs/category/medicinska-sredstva/1496/",
    "https://www.markfarm.rs/category/uho-grlo-nos/1497/",
    "https://www.markfarm.rs/category/preparati-za-oci/1500/",
    "https://www.markfarm.rs/category/dentalni-program/1499/",
    "https://www.markfarm.rs/category/masti-kremovi-gelovi/1501/",
    "https://www.markfarm.rs/category/indikacije/1712/",
    "https://www.markfarm.rs/category/otc/12824/"
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
      url = "#{base_url}#{page_num}"

      case scrape_page(url, base_url, seen_acc) do
        {:ok, [], _has_next, seen_after} ->
          {:halt, {acc, seen_after}}

        {:ok, list, false, seen_after} ->
          {:halt, {acc ++ list, seen_after}}

        {:ok, list, true, seen_after} ->
          {:cont, {acc ++ list, seen_after}}

        {:error, _} ->
          {:halt, {acc, seen_acc}}
      end
    end)
  end

  defp scrape_page(url, base_url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 35_000) do
      products =
        doc
        |> Floki.find(".product-list-item")
        |> Enum.map(&extract_product(&1, base_url))
        |> Enum.reject(&is_nil/1)

      has_next = doc |> Floki.find(".fa.fa-chevron-right") |> Enum.any?()
      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, has_next, seen_after}
    end
  end

  defp extract_product(node, base_url) do
    out_of_stock = node |> Floki.find(".sticker2") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".pli-text")

      if title == "" do
        nil
      else
        price_raw =
          node
          |> Http.text(".pli-price")
          |> String.split("Trenutna cena:")
          |> Enum.at(1, "")
          |> String.trim()

        link =
          Http.attr(node, ".product-list-item > div > a", "href") ||
            Http.attr(node, "div > a", "href")

        image = Http.attr(node, ".product-list-item a img, a img", "src")

        %Product{
          external_id: link,
          title: title,
          url: link,
          price_cents: Price.parse_cents(price_raw),
          currency: "RSD",
          in_stock: true,
          raw_payload: %{price_raw: price_raw, image: image, category: category_from_url(base_url)}
        }
      end
    end
  end

  defp category_from_url(url) do
    url
    |> String.split("/category/")
    |> Enum.at(1, "")
    |> String.split("/")
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
