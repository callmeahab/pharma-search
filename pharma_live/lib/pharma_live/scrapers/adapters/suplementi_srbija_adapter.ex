defmodule PharmaLive.Scrapers.Adapters.SuplementiSrbijaAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://www.suplementisrbija.rs/proteini-3",
    "https://www.suplementisrbija.rs/amino-kiseline-4",
    "https://www.suplementisrbija.rs/kreatini-5",
    "https://www.suplementisrbija.rs/no-i-pretrenazni-proizvodi-6",
    "https://www.suplementisrbija.rs/sagorevaci-7",
    "https://www.suplementisrbija.rs/vitamini-i-minerali-8",
    "https://www.suplementisrbija.rs/imunitet-i-zastita-organizma-9",
    "https://www.suplementisrbija.rs/obnova-i-zastita-zglobova-i-tetiva-10",
    "https://www.suplementisrbija.rs/prostata-zastita-i-prevencija-11",
    "https://www.suplementisrbija.rs/prirodni-stimulatori-hormona-12",
    "https://www.suplementisrbija.rs/omega-3-i-druge-esencijalne-masne-kiseline-13",
    "https://www.suplementisrbija.rs/energija-izdrzljivost-i-ugljeni-hidrat-14",
    "https://www.suplementisrbija.rs/oprema-za-vezbanje-15"
  ]

  @impl true
  def scrape(_source) do
    {products, _seen} =
      Enum.reduce(@base_urls, {[], MapSet.new()}, fn base_url, {acc, seen} ->
        category = extract_category(base_url)
        {collected, seen_after} = scrape_category(base_url, category, seen)
        {acc ++ collected, seen_after}
      end)

    {:ok, products}
  end

  defp scrape_category(base_url, category, seen) do
    Stream.iterate(0, &(&1 + 12))
    |> Enum.reduce_while({[], seen}, fn offset, {acc, seen_acc} ->
      url = if offset == 0, do: base_url, else: "#{base_url}/#{offset}"

      case scrape_page(url, category, seen_acc) do
        {:ok, [], seen_after} -> {:halt, {acc, seen_after}}
        {:ok, list, false, seen_after} -> {:halt, {acc ++ list, seen_after}}
        {:ok, list, true, seen_after} -> {:cont, {acc ++ list, seen_after}}
        {:error, _} -> {:halt, {acc, seen_acc}}
      end
    end)
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 40_000) do
      products =
        doc
        |> Floki.find(".single-product")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      # Original scraper considered <12 products as terminal page.
      has_more = length(products) >= 12
      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, has_more, seen_after}
    end
  end

  defp extract_product(node, category) do
    title = Http.text(node, "h3")

    if title == "" do
      nil
    else
      price_raw = Http.text(node, ".sale-price")
      link = Http.attr(node, ".product-img > a", "href")
      image = Http.attr(node, ".product-img > a img", "src")

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

  defp extract_category(url) do
    url
    |> String.split("/")
    |> List.last()
    |> Kernel.||("")
    |> String.replace(~r/-\d+$/u, "")
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
