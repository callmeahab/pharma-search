defmodule PharmaLive.Scrapers.Adapters.BenuAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_host "https://benu.rs"

  @base_urls [
    "https://benu.rs/livsane-1612525398",
    "https://benu.rs/dijetetski-suplementi",
    "https://benu.rs/dermokozmetika",
    "https://benu.rs/mame-bebe-i-deca",
    "https://benu.rs/higijena-nega-i-kozmetika",
    "https://benu.rs/medicinska-oprema-i-materijali",
    "https://benu.rs/zdrava-hrana-cajevi-i-biljni-preparati"
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
      url = "#{base_url}?page=#{page_num}"

      case scrape_page(url, seen_acc) do
        {:ok, [], seen_after} ->
          next_empty = empty_count + 1
          if next_empty >= 1, do: {:halt, {acc, seen_after, next_empty}}, else: {:cont, {acc, seen_after, next_empty}}

        {:ok, list, seen_after} ->
          {:cont, {acc ++ list, seen_after, 0}}

        {:error, _} ->
          next_empty = empty_count + 1
          if next_empty >= 1, do: {:halt, {acc, seen_acc, next_empty}}, else: {:cont, {acc, seen_acc, next_empty}}
      end
    end)
    |> then(fn {list, seen_after, _} -> {list, seen_after} end)
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 30_000) do
      products =
        doc
        |> Floki.find(".product-box")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    out_of_stock = node |> Floki.find(".product-box__availability.u-lh-n.u-c-red") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".product-box__name")

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".product-box__price strong")
        link = Http.attr(node, ".product-box__link", "href") |> Http.absolute_url(@base_host)
        image = Http.attr(node, ".product-box__image img", "src")

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
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
