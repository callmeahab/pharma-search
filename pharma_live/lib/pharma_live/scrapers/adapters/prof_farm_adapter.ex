defmodule PharmaLive.Scrapers.Adapters.ProfFarmAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://apotekaproffarm.com/product-category/kozmetika/page/",
    "https://apotekaproffarm.com/product-category/dekorativa/page/",
    "https://apotekaproffarm.com/product-category/higijena/page/",
    "https://apotekaproffarm.com/product-category/dijetetika/page/",
    "https://apotekaproffarm.com/product-category/bebi-program/page/",
    "https://apotekaproffarm.com/product-category/medicinska-kozmetika/page/",
    "https://apotekaproffarm.com/product-category/lokalna-primena/page/",
    "https://apotekaproffarm.com/product-category/medicinska-sredstva/page/",
    "https://apotekaproffarm.com/product-category/ostalo/page/"
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
      empty_page = doc |> Floki.find(".message.info.empty") |> Enum.any?()

      if empty_page do
        {:ok, [], seen}
      else
        products =
          doc
          |> Floki.find(".product-block")
          |> Enum.map(&extract_product(&1, category))
          |> Enum.reject(&is_nil/1)

        {unique, seen_after} = dedupe(products, seen)
        {:ok, unique, seen_after}
      end
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".prod-price-on-request") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, "h3")

      if title == "" do
        nil
      else
        price_raw =
          case Http.text(node, ".price ins .woocommerce-Price-amount") do
            "" -> Http.text(node, ".price .woocommerce-Price-amount")
            discounted -> discounted
          end

        link = Http.attr(node, "h3 > a", "href")
        image = Http.attr(node, ".product-image > img", "data-src") || Http.attr(node, ".product-image > img", "src")

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
    |> String.split("/")
    |> Enum.reject(&(&1 == ""))
    |> Enum.slice(-2, 1)
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
