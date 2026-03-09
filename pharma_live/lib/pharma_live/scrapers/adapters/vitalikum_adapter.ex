defmodule PharmaLive.Scrapers.Adapters.VitalikumAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.vitalikum.rs/amino-kiseline",
    "https://www.vitalikum.rs/antioksidanti",
    "https://www.vitalikum.rs/biljni-ekstrakti",
    "https://www.vitalikum.rs/esencijalne-masne-kiseline",
    "https://www.vitalikum.rs/kreatin",
    "https://www.vitalikum.rs/minerali",
    "https://www.vitalikum.rs/oporavak-i-regeneracija",
    "https://www.vitalikum.rs/ostalo",
    "https://www.vitalikum.rs/povecanje-performansi",
    "https://www.vitalikum.rs/povecanje-telesne-tezine-misicne-mase",
    "https://www.vitalikum.rs/povecanje-testosterona-i-hormona-rasta",
    "https://www.vitalikum.rs/proteini",
    "https://www.vitalikum.rs/proteinske-cokoladice",
    "https://www.vitalikum.rs/sagorevaci-masti",
    "https://www.vitalikum.rs/sportska-oprema",
    "https://www.vitalikum.rs/transportni-sistemi-i-no-reaktori",
    "https://www.vitalikum.rs/vitamini",
    "https://www.vitalikum.rs/vitaminsko-mineralni-kompleksi",
    "https://www.vitalikum.rs/zamene-za-obrok-i-proteinski-napici",
    "https://www.vitalikum.rs/zastita-zglobova",
    "https://www.vitalikum.rs/zenski-kutak"
  ]
  @site_base "https://www.vitalikum.rs"

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@base_urls, {[], MapSet.new()}, fn base_url, {acc, seen} ->
        category = base_url |> String.split("/") |> List.last() |> Kernel.||("")
        {collected, seen_after} = scrape_category(base_url, category, seen)
        {acc ++ collected, seen_after}
      end)

    {:ok, products}
  end

  defp scrape_category(base_url, category, seen) do
    Stream.iterate(1, &(&1 + 1))
    |> Enum.reduce_while({[], seen}, fn page_num, {acc, seen_acc} ->
      url = "#{base_url}?page=#{page_num}"

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
        |> Floki.find(".product-teaser")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock =
      node
      |> Floki.find("input[value=\"Nema na lageru\"]")
      |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".node__title a")
      price_raw = Http.text(node, ".price-amount")

      if title == "" or price_raw == "" do
        nil
      else
        link = Http.attr(node, ".node__title a", "href") |> Http.absolute_url(@site_base)
        image = Http.attr(node, ".teaser-image img", "src")

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
