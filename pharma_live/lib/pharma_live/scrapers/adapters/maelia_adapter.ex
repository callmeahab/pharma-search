defmodule PharmaLive.Scrapers.Adapters.MaeliaAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://maelia.rs/sr/catalog/suplementi-1483?page=",
    "https://maelia.rs/sr/catalog/ostalo-1481?page=",
    "https://maelia.rs/sr/catalog/pankreasni-hormoni-708?page=",
    "https://maelia.rs/sr/catalog/obu-a-1480?page=",
    "https://maelia.rs/sr/catalog/kozmetika-1478?page=",
    "https://maelia.rs/sr/catalog/medicinska-oprema-i-1479?page=",
    "https://maelia.rs/sr/catalog/pankreasni-hormoni-708?page="
  ]
  @base_link "https://maelia.rs"

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
      products =
        doc
        |> Floki.find(".c-card-item-default")
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
      title = Http.text(node, ".card-item-name")

      if title == "" do
        nil
      else
        price_raw =
          node
          |> Http.text(".card-item-price")
          |> String.replace(~r/^Od\s*/u, "")
          |> String.replace(" RSD", "")
          |> String.trim()
          |> normalize_thousand_decimal()

        link = Http.attr(node, ".card-item-img", "href") |> Http.absolute_url(@base_link)

        image =
          Http.attr(node, ".card-item-img > img", "data-src") ||
            Http.attr(node, ".card-item-img > img", "src") ||
            Http.attr(node, ".card-item-img > img", "data-original")

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
    |> String.split("/catalog/")
    |> Enum.at(1, "")
    |> String.split("-")
    |> Enum.drop(-1)
    |> Enum.join("-")
    |> String.trim()
  end

  defp normalize_thousand_decimal(price) do
    if Regex.match?(~r/^\d+\.\d{3}$/u, price) do
      String.replace(price, ".", "")
    else
      price
    end
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
