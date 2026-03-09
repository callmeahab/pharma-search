defmodule PharmaLive.Scrapers.Adapters.SpartanSuplementiAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://suplementi-spartanshop.rs/shop/brend/dy-nutrition",
    "https://suplementi-spartanshop.rs/shop/brend/ultimate-nutrition",
    "https://suplementi-spartanshop.rs/shop/brend/yamamoto",
    "https://suplementi-spartanshop.rs/shop/brend/the-nutrition",
    "https://suplementi-spartanshop.rs/shop/brend/basic-supplements",
    "https://suplementi-spartanshop.rs/shop/brend/maximalium",
    "https://suplementi-spartanshop.rs/shop/brend/qnt",
    "https://suplementi-spartanshop.rs/shop/brend/twinlab",
    "https://suplementi-spartanshop.rs/shop/brend/maxler",
    "https://suplementi-spartanshop.rs/shop/brend/labrada",
    "https://suplementi-spartanshop.rs/shop/brend/haya",
    "https://suplementi-spartanshop.rs/shop/brend/extrifit",
    "https://suplementi-spartanshop.rs/shop/brend/musclepharm",
    "https://suplementi-spartanshop.rs/shop/brend/nutrex",
    "https://suplementi-spartanshop.rs/shop/brend/blastex",
    "https://suplementi-spartanshop.rs/shop/brend/power-system",
    "https://suplementi-spartanshop.rs/kategorija/proteini",
    "https://suplementi-spartanshop.rs/kategorija/proteini/vegan-protein",
    "https://suplementi-spartanshop.rs/kategorija/proteini/blend-protein",
    "https://suplementi-spartanshop.rs/kategorija/proteini/kazein",
    "https://suplementi-spartanshop.rs/kategorija/proteini/protein-izolat",
    "https://suplementi-spartanshop.rs/kategorija/proteini/whey-protein",
    "https://suplementi-spartanshop.rs/kategorija/aminokiseline",
    "https://suplementi-spartanshop.rs/kategorija/aminokiseline/arginin",
    "https://suplementi-spartanshop.rs/kategorija/aminokiseline/bcaa",
    "https://suplementi-spartanshop.rs/kategorija/aminokiseline/beta-alanin",
    "https://suplementi-spartanshop.rs/kategorija/aminokiseline/citrulin",
    "https://suplementi-spartanshop.rs/kategorija/aminokiseline/glutamin",
    "https://suplementi-spartanshop.rs/kategorija/pre-workout",
    "https://suplementi-spartanshop.rs/kategorija/kreatin",
    "https://suplementi-spartanshop.rs/kategorija/kreatin/kreatin-monohidrat",
    "https://suplementi-spartanshop.rs/kategorija/vitamini",
    "https://suplementi-spartanshop.rs/kategorija/vitamini/vitamin-b",
    "https://suplementi-spartanshop.rs/kategorija/vitamini/vitamin-c",
    "https://suplementi-spartanshop.rs/kategorija/minerali",
    "https://suplementi-spartanshop.rs/kategorija/minerali/magnezijum",
    "https://suplementi-spartanshop.rs/kategorija/minerali/cink",
    "https://suplementi-spartanshop.rs/kategorija/minerali/omega-3",
    "https://suplementi-spartanshop.rs/kategorija/sagorevaci",
    "https://suplementi-spartanshop.rs/kategorija/sagorevaci/l-carnitine",
    "https://suplementi-spartanshop.rs/kategorija/tribulus",
    "https://suplementi-spartanshop.rs/kategorija/gejneri",
    "https://suplementi-spartanshop.rs/kategorija/zastita-zglobova-tetiva-i-ligamenata",
    "https://suplementi-spartanshop.rs/kategorija/protein-bar",
    "https://suplementi-spartanshop.rs/kategorija/energetska-pica",
    "https://suplementi-spartanshop.rs/kategorija/zdrava-hrana",
    "https://suplementi-spartanshop.rs/kategorija/zdrava-hrana/proteinske-palacinke",
    "https://suplementi-spartanshop.rs/kategorija/zdrava-hrana/puter",
    "https://suplementi-spartanshop.rs/kategorija/protein-bar",
    "https://suplementi-spartanshop.rs/kategorija/fitnes-oprema",
    "https://suplementi-spartanshop.rs/kategorija/fitnes-oprema/pojas-za-teretanu",
    "https://suplementi-spartanshop.rs/kategorija/fitnes-oprema/sejkeri",
    "https://suplementi-spartanshop.rs/kategorija/fitnes-oprema/rukavice-za-trening",
    "https://suplementi-spartanshop.rs/kategorija/fitnes-oprema/gurtne"
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
      url = "#{base_url}/page/#{page_num}"

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
        |> Floki.find(".products li")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".ty-qty-out-of-stock") |> Enum.any?()

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

        link = Http.attr(node, ".product > a", "href")
        image = Http.attr(node, ".product > a img", "src")

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
    |> String.split("/")
    |> Enum.reject(&(&1 == ""))
    |> List.last()
    |> Kernel.||("unknown")
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      if MapSet.member?(seen_acc, product.title), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, product.title)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end
end
