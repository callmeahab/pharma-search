defmodule PharmaLive.Scrapers.Adapters.SopAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://sop.rs/kategorija/amino-kiseline",
    "https://sop.rs/kategorija/bcaa",
    "https://sop.rs/kategorija/gainer",
    "https://sop.rs/kategorija/glutamin",
    "https://sop.rs/kategorija/kreatin",
    "https://sop.rs/kategorija/no-reaktori",
    "https://sop.rs/kategorija/pojacivaci-hormona",
    "https://sop.rs/kategorija/protein",
    "https://sop.rs/kategorija/minerali",
    "https://sop.rs/kategorija/preworkout",
    "https://sop.rs/kategorija/sagorevaci",
    "https://sop.rs/kategorija/vitamini",
    "https://sop.rs/kategorija/kofein",
    "https://sop.rs/kategorija/cistaci-organizma",
    "https://sop.rs/kategorija/arginin",
    "https://sop.rs/kategorija/dijetetski-suplement",
    "https://sop.rs/kategorija/pica-za-oporavak-i-hidrataciju",
    "https://sop.rs/kategorija/opste-poboljsanje",
    "https://sop.rs/kategorija/preparati-za-poboljsanje-memorije",
    "https://sop.rs/kategorija/cregaatine",
    "https://sop.rs/kategorija/preparati-za-zastitu-zglobova",
    "https://sop.rs/kategorija/prevencija-dijabetesa",
    "https://sop.rs/kategorija/smrznuto-voce",
    "https://sop.rs/kategorija/ulje-za-pripremu-jela",
    "https://sop.rs/kategorija/ugljeni-hidrati"
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
      url = if page_num == 1, do: "#{base_url}?count=36", else: "#{base_url}/page/#{page_num}?count=36"

      case scrape_page(url, category, seen_acc) do
        {:ok, [], _has_next, seen_after} -> {:halt, {acc, seen_after}}
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
        |> Floki.find(".porto-tb-item.product")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      has_next = doc |> Floki.find(".next.page-numbers") |> Enum.any?()
      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, has_next, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".stock.out-of-stock") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".post-title a")

      if title == "" do
        nil
      else
        price_raw =
          case Http.text(node, ".price ins .woocommerce-Price-amount") do
            "" -> Http.text(node, ".price .woocommerce-Price-amount")
            discounted -> discounted
          end

        link = Http.attr(node, ".post-title a", "href")
        image = Http.attr(node, ".img-responsive", "src")

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
    |> String.split("/kategorija/")
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
