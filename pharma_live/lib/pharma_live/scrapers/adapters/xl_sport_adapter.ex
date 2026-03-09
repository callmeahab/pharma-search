defmodule PharmaLive.Scrapers.Adapters.XlSportAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.xlsport.rs/product-category/no-reaktori",
    "https://www.xlsport.rs/product-category/proteini",
    "https://www.xlsport.rs/product-category/sagorevaci-masti",
    "https://www.xlsport.rs/product-category/gh-stimulanti",
    "https://www.xlsport.rs/product-category/amino-kiseline",
    "https://www.xlsport.rs/product-category/kreatini",
    "https://www.xlsport.rs/product-category/vitamaniminerali",
    "https://www.xlsport.rs/product-category/energenti",
    "https://www.xlsport.rs/product-category/gejneri",
    "https://www.xlsport.rs/product-category/zastita-zglobova",
    "https://www.xlsport.rs/product-category/vegan",
    "https://www.xlsport.rs/product-category/biljni-preparati",
    "https://www.xlsport.rs/product-category/imunitet",
    "https://www.xlsport.rs/product-category/potencija",
    "https://www.xlsport.rs/product-category/lecenje-jetre",
    "https://www.xlsport.rs/product-category/lecenje-prostate",
    "https://www.xlsport.rs/product-category/lecenje-srca",
    "https://www.xlsport.rs/product-category/mrp",
    "https://www.xlsport.rs/product-category/rtd",
    "https://www.xlsport.rs/product-category/protein-bar",
    "https://www.xlsport.rs/product-category/oprema",
    "https://www.xlsport.rs/product-category/odeca"
  ]

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
      url = if page_num == 1, do: "#{base_url}?product_count=36", else: "#{base_url}/page/#{page_num}/?product_count=36"

      case scrape_page(url, category, seen_acc) do
        {:ok, [], seen_after} -> {:halt, {acc, seen_after}}
        {:ok, list, seen_after} -> {:cont, {acc ++ list, seen_after}}
        {:error, _} -> {:halt, {acc, seen_acc}}
      end
    end)
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 40_000) do
      products =
        doc
        |> Floki.find(".product-grid-view")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".fusion-out-of-stock") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".product-title a")
      price_raw = Http.text(node, ".woocommerce-Price-amount")

      if title == "" or price_raw == "" do
        nil
      else
        link = Http.attr(node, ".product-title a", "href")
        image = Http.attr(node, ".attachment-shop_catalog", "src")

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
    |> String.split("/product-category/")
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
