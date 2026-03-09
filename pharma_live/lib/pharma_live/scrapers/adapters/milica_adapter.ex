defmodule PharmaLive.Scrapers.Adapters.MilicaAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.apotekamilica.rs/category/dodaci-ishrani",
    "https://www.apotekamilica.rs/category/bebe-i-deca",
    "https://www.apotekamilica.rs/category/cajevi-i-biljne-kapi",
    "https://www.apotekamilica.rs/category/dezinfekciona-sredstva-i-repelenti",
    "https://www.apotekamilica.rs/category/kosa-i-koza-glave",
    "https://www.apotekamilica.rs/category/kozmetika-i-nega",
    "https://www.apotekamilica.rs/category/medicinska-pomagala",
    "https://www.apotekamilica.rs/category/minerali-i-vitamini",
    "https://www.apotekamilica.rs/category/zdravlje-muskaraca",
    "https://apotekamilica.rs/category/zdravlje-zena",
    "https://www.apotekamilica.rs/category/oralna-higijena"
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
      url = if page_num == 1, do: base_url, else: "#{String.trim_trailing(base_url, "/")}/page/#{page_num}"

      case scrape_page(url, category, seen_acc) do
        {:ok, [], seen_after} -> {:halt, {acc, seen_after}}
        {:ok, list, seen_after} -> {:cont, {acc ++ list, seen_after}}
        {:error, _} -> {:halt, {acc, seen_acc}}
      end
    end)
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 35_000) do
      stop_page = doc |> Floki.find("#et-button-922193") |> Enum.any?()

      if stop_page do
        {:ok, [], seen}
      else
        products =
          doc
          |> Floki.find(".custom-product-wrapper")
          |> Enum.map(&extract_product(&1, category))
          |> Enum.reject(&is_nil/1)

        {unique, seen_after} = dedupe(products, seen)
        {:ok, unique, seen_after}
      end
    end
  end

  defp extract_product(node, category) do
    in_stock = node |> Floki.find(".custom-add-button") |> Enum.any?()

    if not in_stock do
      nil
    else
      title = Http.text(node, ".custom-product-title")

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".custom-product-price .woocommerce-Price-amount")
        link = Http.attr(node, ".custom-product-image-container a", "href")
        image = Http.attr(node, ".custom-product-image", "src")

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
