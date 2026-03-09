defmodule PharmaLive.Scrapers.Adapters.OazaZdravljaAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_url "https://www.oazazdravlja.rs/proizvodi"
  @site_base "https://www.oazazdravlja.rs"

  @impl true
  def scrape(_source) do
    products =
      Stream.iterate(1, &(&1 + 1))
      |> Enum.reduce_while({[], MapSet.new()}, fn page_num, {acc, seen} ->
        url = "#{@base_url}/page-#{page_num}"

        case scrape_page(url, "proizvodi", seen) do
          {:ok, [], seen_after} -> {:halt, {acc, seen_after}}
          {:ok, list, seen_after} -> {:cont, {acc ++ list, seen_after}}
          {:error, _} -> {:halt, {acc, seen}}
        end
      end)
      |> elem(0)

    {:ok, products}
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 35_000) do
      products =
        doc
        |> Floki.find(".item.product-item")
        |> Enum.map(&extract_product(&1, category))
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
      title =
        Http.attr(node, ".title > a", "title")
        |> case do
          nil -> Http.text(node, ".title > a")
          value -> String.trim(value)
        end

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".current-price")
        link = Http.attr(node, ".img-wrapper > a", "href")

        image =
          Http.attr(node, ".img-wrapper > a > img", "data-src") ||
            Http.attr(node, ".img-wrapper > a > img", "src") ||
            Http.attr(node, ".img-wrapper > a > img", "data-original")

        image = if is_binary(image) and String.starts_with?(image, "data:image"), do: nil, else: image
        image = Http.absolute_url(image, @site_base)

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

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
