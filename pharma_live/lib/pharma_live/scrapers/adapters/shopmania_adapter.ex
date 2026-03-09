defmodule PharmaLive.Scrapers.Adapters.ShopmaniaAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_site "https://www.shopmania.rs"
  @base_urls [
    "https://www.shopmania.rs/fitness/p",
    "https://www.shopmania.rs/parfemi/p",
    "https://www.shopmania.rs/razni-prirodni-preparati/p",
    "https://www.shopmania.rs/zenska-kozmetika/p",
    "https://www.shopmania.rs/nega-tela/p",
    "https://www.shopmania.rs/vitamini-i-suplementi-ishrane/p",
    "https://www.shopmania.rs/licna-nega/p",
    "https://www.shopmania.rs/apoteka/p"
  ]

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@base_urls, {[], MapSet.new()}, fn base_url, {acc, seen} ->
        category = category_from_base_url(base_url)
        {collected, seen_after} = scrape_category(base_url, category, seen)
        {acc ++ collected, seen_after}
      end)

    {:ok, products}
  end

  defp scrape_category(base_url, category, seen) do
    Stream.iterate(1, &(&1 + 1))
    |> Enum.reduce_while({[], seen}, fn page_num, {acc, seen_acc} ->
      url = "#{base_url}#{page_num}"

      case scrape_page(url, category, seen_acc) do
        {:ok, [], seen_after} -> {:halt, {acc, seen_after}}
        {:ok, list, seen_after} -> {:cont, {acc ++ list, seen_after}}
        {:error, _} -> {:halt, {acc, seen_acc}}
      end
    end)
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 35_000) do
      error_page =
        doc
        |> Floki.find("h2.h4.serif.mb-2")
        |> Floki.text()
        |> String.contains?("Ooops")

      if error_page do
        {:ok, [], seen}
      else
        products =
          doc
          |> Floki.find(".prod-item")
          |> Enum.map(&extract_product(&1, category))
          |> Enum.reject(&is_nil/1)

        {unique, seen_after} = dedupe(products, seen)
        {:ok, unique, seen_after}
      end
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".grid-image.grid-image--out-of-stock") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, "h2")

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".prod-price")
        link = Http.attr(node, "h2 > a", "href") |> Http.absolute_url(@base_site)

        image =
          Http.attr(node, ".prod-item-img-wrap img", "data-src") ||
            Http.attr(node, ".prod-item-img-wrap img", "src")

        image =
          cond do
            image == "https://s.cdnshm.com/img/site/na.svg" -> nil
            is_binary(image) and String.starts_with?(image, "/") -> Http.absolute_url(image, @base_site)
            true -> image
          end

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

  defp category_from_base_url(base_url) do
    base_url
    |> URI.parse()
    |> Map.get(:path, "")
    |> String.split("/", trim: true)
    |> Enum.at(0, "")
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
