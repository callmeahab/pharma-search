defmodule PharmaLive.Scrapers.Adapters.ProteinboxAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://proteinbox.rs/c/proteini",
    "https://proteinbox.rs/c/proteini/whey-protein",
    "https://proteinbox.rs/c/proteini/isolate-protein",
    "https://proteinbox.rs/c/aminokiseline",
    "https://proteinbox.rs/c/aminokiseline/arginin",
    "https://proteinbox.rs/c/aminokiseline/bcaa",
    "https://proteinbox.rs/c/aminokiseline/glutamin",
    "https://proteinbox.rs/c/kreatin",
    "https://proteinbox.rs/c/kreatin/kreatin-monohidrat",
    "https://proteinbox.rs/c/vitamini",
    "https://proteinbox.rs/c/minerali",
    "https://proteinbox.rs/c/minerali/magnezijum",
    "https://proteinbox.rs/c/fitnes-oprema",
    "https://proteinbox.rs/c/gejneri",
    "https://proteinbox.rs/c/zastita-zglobova-tetiva-i-ligamenata",
    "https://proteinbox.rs/c/pre-workout",
    "https://proteinbox.rs/c/sagorevaci-masti",
    "https://proteinbox.rs/c/tribulus"
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
      url = if page_num == 1, do: base_url, else: "#{base_url}/page/#{page_num}"

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
        |> Floki.find(".products.elementor-grid li.product")
        |> Enum.map(&extract_product(&1, category))
        |> Enum.reject(&is_nil/1)

      has_next = doc |> Floki.find(".next.page-numbers") |> Enum.any?()
      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, has_next, seen_after}
    end
  end

  defp extract_product(node, category) do
    out_of_stock = node |> Floki.find(".out-of-stock-text") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, ".woocommerce-loop-product__title")

      if title == "" do
        nil
      else
        price_raw =
          case Http.text(node, ".price ins .woocommerce-Price-amount") do
            "" -> Http.text(node, ".price del .woocommerce-Price-amount, .price > .woocommerce-Price-amount")
            discounted -> discounted
          end

        link = Http.attr(node, ".woocommerce-LoopProduct-link", "href")

        image =
          Http.attr(node, ".attachment-woocommerce_thumbnail", "data-lazy-src") ||
            Http.attr(node, ".attachment-woocommerce_thumbnail", "src")

        image =
          cond do
            is_nil(image) -> nil
            String.starts_with?(image, "data:image") -> nil
            String.contains?(image, "svg") -> nil
            true -> image
          end

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
    |> String.split("/c/")
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
