defmodule PharmaLive.Scrapers.Adapters.AnanasAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_host "https://www.ananas.rs"

  @impl true
  def scrape(source) do
    urls = category_urls(source)

    if urls == [] do
      {:error, "no category URLs found for #{source.key}"}
    else
      {products, _seen} =
        Enum.reduce(urls, {[], MapSet.new()}, fn category_url, {acc, seen} ->
          {collected, seen_after} = scrape_category(category_url, seen)
          {acc ++ collected, seen_after}
        end)

      {:ok, products}
    end
  end

  defp scrape_category(category_url, seen) do
    Stream.iterate(1, &(&1 + 1))
    |> Enum.reduce_while({[], seen, 0}, fn page_num, {acc, seen_acc, empty_count} ->
      url = "#{category_url}?page=#{page_num}"

      case scrape_page(url, seen_acc) do
        {:ok, [], seen_after} ->
          next_empty = empty_count + 1
          if next_empty >= 1, do: {:halt, {acc, seen_after, next_empty}}, else: {:cont, {acc, seen_after, next_empty}}

        {:ok, page_products, seen_after} ->
          {:cont, {acc ++ page_products, seen_after, 0}}

        {:error, _} ->
          next_empty = empty_count + 1
          if next_empty >= 1, do: {:halt, {acc, seen_acc, next_empty}}, else: {:cont, {acc, seen_acc, next_empty}}
      end
    end)
    |> then(fn {list, seen_after, _} -> {list, seen_after} end)
  end

  defp scrape_page(url, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 45_000) do
      products =
        doc
        |> Floki.find(".ais-Hits-item")
        |> Enum.map(&extract_product/1)
        |> Enum.reject(&is_nil/1)

      {unique, seen_after} = dedupe(products, seen)
      {:ok, unique, seen_after}
    end
  end

  defp extract_product(node) do
    out_of_stock = node |> Floki.find(".sc-492kdg-11") |> Enum.any?()

    if out_of_stock do
      nil
    else
      title = Http.text(node, "h3")

      if title == "" do
        nil
      else
        link = Http.attr(node, "a", "href") |> Http.absolute_url(@base_host)
        spans = node |> Floki.find("span") |> Enum.map(&Floki.text/1)
        price_raw = Enum.at(spans, 1) || Enum.at(spans, 0) || ""

        image =
          Http.attr(node, "img", "src") ||
            Http.attr(node, "img", "data-src") ||
            Http.attr(node, "img", "data-lazy") ||
            (Http.attr(node, "img", "srcset") |> pick_largest_srcset())

        image = decode_nextjs_image_url(image)

        %Product{
          external_id: link,
          title: title,
          url: link,
          price_cents: Price.parse_cents(price_raw),
          currency: "RSD",
          in_stock: true,
          raw_payload: %{price_raw: price_raw, image: image}
        }
      end
    end
  end

  defp pick_largest_srcset(nil), do: nil

  defp pick_largest_srcset(srcset) do
    srcset
    |> String.split(",")
    |> Enum.map(&String.trim/1)
    |> Enum.map(&String.split(&1, " "))
    |> Enum.map(&List.first/1)
    |> Enum.reject(&is_nil/1)
    |> List.last()
  end

  defp decode_nextjs_image_url(nil), do: nil

  defp decode_nextjs_image_url(src) do
    case Regex.run(~r/url=([^&]+)/u, src, capture: :all_but_first) do
      [encoded] -> URI.decode(encoded)
      _ -> src
    end
  rescue
    _ -> src
  end

  defp dedupe(products, seen) do
    Enum.reduce(products, {[], seen}, fn product, {acc, seen_acc} ->
      key = {product.title, product.url}
      if MapSet.member?(seen_acc, key), do: {acc, seen_acc}, else: {[product | acc], MapSet.put(seen_acc, key)}
    end)
    |> then(fn {list, set} -> {Enum.reverse(list), set} end)
  end

  defp category_urls(source) do
    script = get_in(source.settings, ["script"]) || default_script_for_key(source.key)

    script_path =
      Application.get_env(:pharma_live, :legacy_scrapers_dir, Path.expand("../scrapers", File.cwd!()))
      |> Path.join(script || "")

    case File.read(script_path) do
      {:ok, content} ->
        Regex.scan(~r/https:\/\/ananas\.rs\/kategorije\/[\w\-\/]+/u, content)
        |> List.flatten()
        |> Enum.uniq()

      {:error, _} ->
        []
    end
  end

  defp default_script_for_key("ananas"), do: "ananas.ts"
  defp default_script_for_key("ananas1"), do: "ananas1.ts"
  defp default_script_for_key("ananas2"), do: "ananas2.ts"
  defp default_script_for_key("ananas3"), do: "ananas3.ts"
  defp default_script_for_key("ananas4"), do: "ananas4.ts"
  defp default_script_for_key("ananas5"), do: "ananas5.ts"
  defp default_script_for_key("ananas6"), do: "ananas6.ts"
  defp default_script_for_key(_), do: nil
end
