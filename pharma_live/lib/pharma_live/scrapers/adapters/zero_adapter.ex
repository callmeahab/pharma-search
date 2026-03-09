defmodule PharmaLive.Scrapers.Adapters.ZeroAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @site_base "https://apotekazero.rs"
  @base_urls [
    "https://apotekazero.rs/shop/category_problemi-sa-varenjem",
    "https://apotekazero.rs/shop/category_prehlada-i-grip",
    "https://apotekazero.rs/shop/category_vitamini-i-minerali",
    "https://apotekazero.rs/shop/category_stres-i-nesanica",
    "https://apotekazero.rs/shop/category_dijabetes",
    "https://apotekazero.rs/shop/category_srce-i-krvni-sudovi",
    "https://apotekazero.rs/shop/category_zenski-problemi",
    "https://apotekazero.rs/shop/category_muski-problemi",
    "https://apotekazero.rs/shop/category_bebe-i-deca",
    "https://apotekazero.rs/shop/category_alergija",
    "https://apotekazero.rs/shop/category_nervni-sistem",
    "https://apotekazero.rs/shop/category_urinarni-sistem",
    "https://apotekazero.rs/shop/category_oko-i-vid",
    "https://apotekazero.rs/shop/category_kosti-i-zglobovi",
    "https://apotekazero.rs/shop/category_zdravlje-jetre",
    "https://apotekazero.rs/shop/category_biljni-lekovi",
    "https://apotekazero.rs/shop/category_posebna-ishrana",
    "https://apotekazero.rs/shop/category_bol",
    "https://apotekazero.rs/shop/category_koza-kosa-nokti",
    "https://apotekazero.rs/shop/category_kozmetika-za-bebe",
    "https://apotekazero.rs/shop/category_dermokozmetika",
    "https://apotekazero.rs/shop/category_nega-i-zastita",
    "https://apotekazero.rs/shop/category_higijena",
    "https://apotekazero.rs/shop/category_meraci-pritiska-toplomeri-inhalatori"
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
      url = "#{base_url}!page_#{page_num}"

      case scrape_page(url, seen_acc) do
        {:ok, [], _has_next, seen_after} -> {:halt, {acc, seen_after}}
        {:ok, list, false, seen_after} -> {:halt, {acc ++ list, seen_after}}
        {:ok, list, true, seen_after} -> {:cont, {acc ++ list, seen_after}}
        {:error, _} -> {:halt, {acc, seen_acc}}
      end
    end)
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 40_000) do
      products =
        doc
        |> Floki.find(".product-holder")
        |> Enum.map(&extract_product(&1, extract_category(url)))
        |> Enum.reject(&is_nil/1)

      has_next =
        doc
        |> Floki.find("a")
        |> Enum.any?(fn node ->
          node
          |> Floki.text()
          |> String.contains?(">")
        end)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, has_next, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".aaa") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, "h2")

      if title == "" do
        nil
      else
        price_raw = Http.text(node, ".price")
        link = Http.attr(node, ".product-img > a", "href") |> Http.absolute_url(@site_base)

        image =
          Http.attr(node, "a > img", "data-src") ||
            Http.attr(node, "a > img", "src") ||
            Http.attr(node, "a > img", "data-original")

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

  defp extract_category(url) do
    case Regex.run(~r/category_(.+?)(?:!|$)/u, url, capture: :all_but_first) do
      [category] -> category
      _ -> "unknown"
    end
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
