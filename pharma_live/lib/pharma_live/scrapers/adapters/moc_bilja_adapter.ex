defmodule PharmaLive.Scrapers.Adapters.MocBiljaAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/bubrezi/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/debelo-crevo/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/donji-disajni-putevi/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/gornji-disajni-putevi/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/gusteraca/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/jetra/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/kostani-misicni-sistem/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/koza-i-kosa/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/mokracni-kanali-i-besika/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/nervni-sistem/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/pluca/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/reproduktivni-sistemi/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/slezina-i-imuni-sistem/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/srce/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/stitna-zlezda/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/tanko-crevo/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/vaskularni-sistem/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/zeludac/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/zucna-kesa/",
    "https://www.mocbilja.rs/kategorija-proizvoda/filter-cajevi/",
    "https://www.mocbilja.rs/kategorija-proizvoda/biljne-kapi-tinkture/",
    "https://www.mocbilja.rs/kategorija-proizvoda/cajne-mesavine/",
    "https://www.mocbilja.rs/kategorija-proizvoda/jednokomponentni/",
    "https://www.mocbilja.rs/kategorija-proizvoda/fitopreparati/",
    "https://www.mocbilja.rs/kategorija-proizvoda/kozmeticki-preparati/",
    "https://www.mocbilja.rs/kategorija-proizvoda/preparati-na-bazi-pcelinjih-proizvoda/",
    "https://www.mocbilja.rs/kategorija-proizvoda/samo-u-nasim-apotekama/"
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
      url = "#{base_url}page/#{page_num}"

      case scrape_page(url, category, seen_acc) do
        {:ok, [], _has_next, seen_after} -> {:halt, {acc, seen_after}}
        {:ok, list, false, seen_after} -> {:halt, {acc ++ list, seen_after}}
        {:ok, list, true, seen_after} -> {:cont, {acc ++ list, seen_after}}
        {:error, _} -> {:halt, {acc, seen_acc}}
      end
    end)
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 35_000) do
      products =
        doc
        |> Floki.find(".product")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      has_next = doc |> Floki.find(".next.page-numbers") |> Enum.any?()
      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, has_next, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".aaa, .stock.out-of-stock") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, "h2")

      if title == "" do
        nil
      else
        price_raw =
          case Http.text(node, ".price ins .woocommerce-Price-amount") do
            "" -> Http.text(node, ".price .woocommerce-Price-amount")
            discounted -> discounted
          end

        link = Http.attr(node, "a", "href")

        image =
          Http.attr(node, "img", "data-src") ||
            Http.attr(node, "img", "src") ||
            Http.attr(node, "img", "data-original")

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

  defp category_from_base_url(base_url) do
    base_url
    |> String.trim_trailing("/")
    |> String.split("/")
    |> List.last()
    |> Kernel.||("unknown-category")
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
