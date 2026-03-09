defmodule PharmaLive.Scrapers.Adapters.PansportAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.pansport.rs/amino-kiseline",
    "https://www.pansport.rs/antioksidanti",
    "https://www.pansport.rs/biljni-ekstrakti",
    "https://www.pansport.rs/esencijalne-masne-kiseline",
    "https://www.pansport.rs/kreatin",
    "https://www.pansport.rs/minerali",
    "https://www.pansport.rs/oporavak-i-regeneracija",
    "https://www.pansport.rs/ostalo",
    "https://www.pansport.rs/povecanje-performansi",
    "https://www.pansport.rs/povecanje-telesne-tezine-misicne-mase",
    "https://www.pansport.rs/povecanje-testosterona-i-hormona-rasta",
    "https://www.pansport.rs/prelivi-i-namazi",
    "https://www.pansport.rs/proteini",
    "https://www.pansport.rs/proteinske-cokoladice",
    "https://www.pansport.rs/regulisanje-probave",
    "https://www.pansport.rs/sagorevaci-masti",
    "https://www.pansport.rs/sportska-oprema",
    "https://www.pansport.rs/transportni-sistemi-i-no-reaktori",
    "https://www.pansport.rs/vitamini",
    "https://www.pansport.rs/vitaminsko-mineralni-kompleksi",
    "https://www.pansport.rs/zamene-za-obrok",
    "https://www.pansport.rs/zastita-zglobova",
    "https://www.pansport.rs/zenski-kutak"
  ]

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@base_urls, {[], MapSet.new()}, fn base_url, {acc, seen} ->
        url = "#{base_url}?items_per_page=All"
        category = base_url |> String.split("/") |> List.last() |> Kernel.||("unknown")

        case scrape_page(url, category, seen) do
          {:ok, list, seen_after} -> {acc ++ list, seen_after}
          {:error, _} -> {acc, seen}
        end
      end)

    {:ok, products}
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 40_000, retries: 1) do
      products =
        doc
        |> Floki.find(".product-teaser-holder")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node, category) do
    title = Http.text(node, "h4")

    if title == "" do
      nil
    else
      price_raw = Http.text(node, ".price-amount")
      link = Http.attr(node, ".teaser-image > a", "href")
      image = Http.attr(node, ".teaser-image > a img", "src")

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

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
