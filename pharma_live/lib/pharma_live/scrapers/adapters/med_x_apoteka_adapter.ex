defmodule PharmaLive.Scrapers.Adapters.MedXApotekaAdapter do
  @behaviour PharmaLive.Scrapers.Adapter

  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.Support.Http
  alias PharmaLive.Scrapers.Support.Price

  @base_urls [
    "https://medxapoteka.rs/product-category/prehlada-imunitet/prehlada/praskovi/",
    "https://medxapoteka.rs/product-category/prehlada-imunitet/prehlada/tablete-i-kapsule/",
    "https://medxapoteka.rs/product-category/prehlada-imunitet/prehlada/nazalni-sprejevi/",
    "https://medxapoteka.rs/product-category/prehlada-imunitet/prehlada/oralni-sprejevi/",
    "https://medxapoteka.rs/product-category/prehlada-imunitet/prehlada/pastile-i-oriblete/",
    "https://medxapoteka.rs/product-category/prehlada-imunitet/prehlada/kasalj/",
    "https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/omega-3/",
    "https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/polifenoli/",
    "https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/alkilgliceroli/",
    "https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/vitamini-i-minerali/",
    "https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/antioksidansi/",
    "https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/bioflavonoidi/",
    "https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/aminokiseline/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/specijalna-hrana/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/probiotici/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/varenje/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/nadutost/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/zatvor/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/dijareja/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/hemoroidi/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/bolovi/kosti/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/bolovi/misici/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/cirkulacija/jetra/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/cirkulacija/kardioprotektori/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/cirkulacija/visok-holesterol/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/cirkulacija/mozdana-cirkulacija/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/cirkulacija/vene/",
    "https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/cirkulacija/periferna-cirkulacija/",
    "https://medxapoteka.rs/product-category/nega-i-lepota/a-derma/",
    "https://medxapoteka.rs/product-category/nega-i-lepota/avene/",
    "https://medxapoteka.rs/product-category/nega-i-lepota/couvrance/",
    "https://medxapoteka.rs/product-category/nega-i-lepota/ducray/",
    "https://medxapoteka.rs/product-category/nega-i-lepota/klorane/",
    "https://medxapoteka.rs/product-category/nega-i-lepota/noreva/",
    "https://medxapoteka.rs/product-category/nega-i-lepota/ziaja-med/",
    "https://medxapoteka.rs/product-category/nega-i-lepota/bioderma/",
    "https://medxapoteka.rs/product-category/nega-i-lepota/nega-lica/",
    "https://medxapoteka.rs/product-category/nega-i-lepota/nega-tela/",
    "https://medxapoteka.rs/product-category/nega-i-lepota/nega-kose/",
    "https://medxapoteka.rs/product-category/nega-i-lepota/pranje-tela/",
    "https://medxapoteka.rs/product-category/nega-i-lepota/parfemi-i-dezodoransi/",
    "https://medxapoteka.rs/product-category/sezonski-proizvodi/suncanje/",
    "https://medxapoteka.rs/product-category/sezonski-proizvodi/alergija/",
    "https://medxapoteka.rs/product-category/sezonski-proizvodi/putna-apoteka/",
    "https://medxapoteka.rs/product-category/sezonski-proizvodi/komarci/",
    "https://medxapoteka.rs/product-category/sezonski-proizvodi/znojenje-koze/",
    "https://medxapoteka.rs/product-category/sezonski-proizvodi/cajevi/",
    "https://medxapoteka.rs/product-category/mama-bebe/baby-kozmetika/",
    "https://medxapoteka.rs/product-category/mama-bebe/bebine-tegobe/",
    "https://medxapoteka.rs/product-category/mama-bebe/hrana-za-bebe/",
    "https://medxapoteka.rs/product-category/mama-bebe/previjanje-beba/",
    "https://medxapoteka.rs/product-category/mama-bebe/oprema-za-bebe/",
    "https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/osteoporoza/",
    "https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/prostata/",
    "https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/mrsavljenje/",
    "https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/detoksikacija/",
    "https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/anemija/",
    "https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/dijabetes/",
    "https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/urinarna-infekcija/",
    "https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/biljna-ulja-i-tinkture/",
    "https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/inkontinecija/",
    "https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/zenski-prirodni-hormoni/",
    "https://medxapoteka.rs/product-category/zdravlje/seksualno-zdravlje/impotencija/",
    "https://medxapoteka.rs/product-category/zdravlje/seksualno-zdravlje/povecanje-plodnosti/",
    "https://medxapoteka.rs/product-category/zdravlje/seksualno-zdravlje/prezervativi-i-lubrikanti/",
    "https://medxapoteka.rs/product-category/zdravlje/seksualno-zdravlje/utvrdjivanje-trudnoce-i-ovulacije/",
    "https://medxapoteka.rs/product-category/zdravlje/seksualno-zdravlje/vitamini-za-trudnice/",
    "https://medxapoteka.rs/product-category/zdravlje/seksualno-zdravlje/zenska-intimna-nega/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/koenzim-q10/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/kostano-misicni-sistem/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/d3-vitamin/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/b-kompleks/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/cink/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/kalcijum/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/kompleksi/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/magnezijum/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/multivitamini/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/selen/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/vitamin-c/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/vitamin-e/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/nervni-sistem/neuroprotektori/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/nervni-sistem/anksioznost/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/nervni-sistem/koncentracija/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/nervni-sistem/spavanje/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/uho/buka/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/uho/infekcija-uha/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/uho/masnoca/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-kose/svrab-zdravlje-kose/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-kose/opadanje/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-kose/perut/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-kose/vaske/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-oka/vitamin-i-minerali/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-oka/vestacke-suze/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-oka/proizvodi-za-sociva/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-oka/infekcija-oka/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-stopala/znojenje-nogu/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-stopala/suva-stopala/",
    "https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-stopala/bradavice-i-kurje-oko/",
    "https://medxapoteka.rs/product-category/zastita/medicinski-uredjaji/pulsni-oksimetar/",
    "https://medxapoteka.rs/product-category/zastita/medicinski-uredjaji/meraci-krvnog-pritiska/",
    "https://medxapoteka.rs/product-category/zastita/medicinski-uredjaji/inhalator/",
    "https://medxapoteka.rs/product-category/zastita/medicinski-uredjaji/merenje-glukoze-u-krvi/",
    "https://medxapoteka.rs/product-category/zastita/medicinski-uredjaji/toplomeri/",
    "https://medxapoteka.rs/product-category/zastita/prva-pomoc/medicinski-potrosni-materijal/",
    "https://medxapoteka.rs/product-category/zastita/prva-pomoc/zastitne-maske/",
    "https://medxapoteka.rs/product-category/zastita/prva-pomoc/pomagala/",
    "https://medxapoteka.rs/product-category/zastita/prva-pomoc/antiseptici/",
    "https://medxapoteka.rs/product-category/zastita/prva-pomoc/gaze-i-komprese/",
    "https://medxapoteka.rs/product-category/zastita/prva-pomoc/flasteri/",
    "https://medxapoteka.rs/product-category/zastita/prva-pomoc/rukavice/",
    "https://medxapoteka.rs/product-category/zastita/prva-pomoc/zavoji/",
    "https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/hrkanje/",
    "https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/proteze/",
    "https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/paste/",
    "https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/cetkice/",
    "https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/rastvori/",
    "https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/konac/",
    "https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/oralna-infekcija/",
    "https://medxapoteka.rs/product-category/zastita/zdravlje-koze/povrede-koze-i-rane/",
    "https://medxapoteka.rs/product-category/zastita/zdravlje-koze/rehidratacija-zdravlje-koze/",
    "https://medxapoteka.rs/product-category/zastita/zdravlje-koze/svrab/",
    "https://medxapoteka.rs/product-category/zastita/zdravlje-koze/osip/",
    "https://medxapoteka.rs/product-category/zastita/zdravlje-koze/ekcem/",
    "https://medxapoteka.rs/product-category/zastita/zdravlje-koze/akne/",
    "https://medxapoteka.rs/product-category/zastita/zdravlje-koze/oziljci/",
    "https://medxapoteka.rs/product-category/zastita/zdravlje-koze/fleke/",
    "https://medxapoteka.rs/product-category/zastita/zdravlje-koze/boginje/",
    "https://medxapoteka.rs/product-category/zastita/zdravlje-koze/bradavice/",
    "https://medxapoteka.rs/product-category/zastita/zdravlje-koze/ujedi-insekata/"
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
      url = "#{base_url}page/#{page_num}"

      case scrape_page(url, category, seen_acc) do
        {:ok, [], _has_next, seen_after} ->
          {:halt, {acc, seen_after}}

        {:ok, list, false, seen_after} ->
          {:halt, {acc ++ list, seen_after}}

        {:ok, list, true, seen_after} ->
          {:cont, {acc ++ list, seen_after}}

        {:error, _} ->
          {:halt, {acc, seen_acc}}
      end
    end)
  end

  defp scrape_page(url, category, seen) do
    with {:ok, doc} <- Http.fetch_html(url, receive_timeout: 45_000) do
      products =
        doc
        |> Floki.find("ul > .product")
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
      title = Http.text(node, "h2") |> String.replace(",", ".")

      if title == "" do
        nil
      else
        price_raw =
          case Http.text(node, ".price ins .woocommerce-Price-amount") do
            "" -> Http.text(node, ".price .woocommerce-Price-amount")
            discounted -> discounted
          end

        link = Http.attr(node, "a", "href")
        image = Http.attr(node, "img", "src")

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
    |> String.trim_trailing("/")
    |> String.split("/")
    |> case do
      parts ->
        case Enum.find_index(parts, &(&1 == "product-category")) do
          nil -> "unknown-category"
          idx -> Enum.at(parts, idx + 1, "unknown-category")
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
