defmodule PharmaLive.Catalog do
  import Ecto.Query, warn: false

  alias PharmaLive.Catalog.CatalogProduct
  alias PharmaLive.Catalog.PriceSnapshot
  alias PharmaLive.Catalog.Vendor
  alias PharmaLive.Catalog.VendorProduct
  alias PharmaLive.Repo
  alias PharmaLive.Scrapers.Product
  alias PharmaLive.Scrapers.ScraperSource

  @default_limit 24

  def upsert_vendor(attrs) do
    Repo.insert(
      Vendor.changeset(%Vendor{}, attrs),
      on_conflict: [set: [name: attrs.name, website: attrs[:website], active: true]],
      conflict_target: :key,
      returning: true
    )
  end

  def ingest_products(%ScraperSource{vendor_id: vendor_id}, run_id, products) when is_list(products) do
    now = DateTime.utc_now()

    Enum.reduce(products, 0, fn product, acc ->
      source_key = source_key(product)
      catalog_product = upsert_catalog_product(product)

      vendor_product =
        Repo.insert!(
          VendorProduct.changeset(%VendorProduct{}, %{
            vendor_id: vendor_id,
            catalog_product_id: catalog_product.id,
            source_product_key: source_key,
            title: product.title,
            product_url: product.url,
            currency: product.currency,
            last_seen_at: now,
            raw_payload: product.raw_payload
          }),
          on_conflict: [
            set: [
              title: product.title,
              catalog_product_id: catalog_product.id,
              product_url: product.url,
              currency: product.currency,
              last_seen_at: now,
              raw_payload: product.raw_payload,
              active: true,
              updated_at: now
            ]
          ],
          conflict_target: [:vendor_id, :source_product_key],
          returning: true
        )

      Repo.insert!(
        PriceSnapshot.changeset(%PriceSnapshot{}, %{
          vendor_product_id: vendor_product.id,
          scrape_run_id: run_id,
          price_cents: product.price_cents,
          currency: product.currency,
          in_stock: product.in_stock,
          captured_at: now
        })
      )

      acc + 1
    end)
  end

  def featured_groups(limit \\ @default_limit) do
    search_groups("", limit: limit, offset: 0, include_facets: false)
  end

  def autocomplete(query, limit \\ 8) do
    q = String.trim(query || "")

    if q == "" do
      []
    else
      term = "%" <> q <> "%"

      latest = latest_snapshots_subquery()

      from(vp in VendorProduct,
        join: v in Vendor,
        on: v.id == vp.vendor_id and v.active == true,
        join: lp in subquery(latest),
        on: lp.vendor_product_id == vp.id,
        join: ps in PriceSnapshot,
        on: ps.vendor_product_id == vp.id and ps.captured_at == lp.captured_at,
        where: vp.active == true and ilike(vp.title, ^term),
        order_by: [asc: ps.price_cents, asc: vp.title],
        limit: ^limit,
        select: %{
          id: vp.id,
          title: vp.title,
          price: ps.price_cents,
          vendor_name: v.name
        }
      )
      |> Repo.all()
    end
  end

  def search_groups(query, opts \\ []) do
    limit = Keyword.get(opts, :limit, @default_limit)
    offset = Keyword.get(opts, :offset, 0)
    min_price = Keyword.get(opts, :min_price)
    max_price = Keyword.get(opts, :max_price)
    brands = Keyword.get(opts, :brands, [])
    vendors = Keyword.get(opts, :vendors, [])
    dosages = Keyword.get(opts, :dosages, [])
    include_facets = Keyword.get(opts, :include_facets, true)

    scoped = scoped_offers_query(query, min_price, max_price, brands, vendors, dosages)

    total_groups =
      scoped
      |> select([_cp, vp, _v, _last, _ps], vp.catalog_product_id)
      |> distinct(true)
      |> Repo.aggregate(:count)

    total_products =
      scoped
      |> select([_cp, vp, _v, _last, _ps], count(vp.id))
      |> Repo.one() || 0

    group_rows =
      scoped
      |> group_by([cp, _vp, _v, _last, _ps], [cp.id, cp.display_name, cp.normalized_name, cp.brand, cp.dosage_unit])
      |> select([cp, vp, _v, _last, ps], %{
        id: cp.id,
        display_name: cp.display_name,
        normalized_name: cp.normalized_name,
        brand: cp.brand,
        dosage_unit: cp.dosage_unit,
        product_count: count(vp.id),
        vendor_count: count(fragment("distinct ?", vp.vendor_id)),
        min_price: min(ps.price_cents),
        max_price: max(ps.price_cents),
        avg_price: avg(ps.price_cents)
      })
      |> order_by([cp, _vp, _v, _last, ps], asc: min(ps.price_cents), asc: fragment("lower(?)", cp.display_name))
      |> limit(^limit)
      |> offset(^offset)
      |> Repo.all()

    group_ids = Enum.map(group_rows, & &1.id)

    offers =
      if group_ids == [] do
        []
      else
        scoped
        |> where([cp, _vp, _v, _last, _ps], cp.id in ^group_ids)
        |> select([cp, vp, v, _last, ps], %{
          catalog_product_id: cp.id,
          id: vp.id,
          title: vp.title,
          price: ps.price_cents,
          vendor_name: v.name,
          vendor_id: v.id,
          link: vp.product_url,
          thumbnail: vp.thumbnail_url
        })
        |> order_by([_cp, _vp, v, _last, ps], asc: ps.price_cents, asc: v.name)
        |> Repo.all()
      end

    offers_by_group = Enum.group_by(offers, & &1.catalog_product_id)

    groups =
      group_rows
      |> Enum.map(fn row ->
        products = Map.get(offers_by_group, row.id, [])

        %{
          id: to_string(row.id),
          catalog_product_ids: [row.id],
          normalized_name: row.normalized_name,
          display_name: row.display_name,
          brand: row.brand,
          dosage_unit: row.dosage_unit,
          products: products,
          product_count: row.product_count,
          vendor_count: row.vendor_count,
          price_range: %{
            min: row.min_price || 0,
            max: row.max_price || 0,
            avg: to_int(row.avg_price)
          }
        }
      end)
      |> merge_groups_by_signature()

    facets =
      if include_facets do
        build_facets(scoped)
      else
        %{}
      end

    %{
      groups: groups,
      total_groups: total_groups,
      total_products: total_products,
      offset: offset,
      limit: limit,
      facets: facets
    }
  end

  defp build_facets(scoped) do
    vendor_name =
      scoped
      |> group_by([_cp, _vp, v, _last, _ps], v.name)
      |> select([_cp, _vp, v, _last, _ps], {v.name, count(v.id)})
      |> Repo.all()
      |> Enum.into(%{})

    brand =
      scoped
      |> where([cp, _vp, _v, _last, _ps], not is_nil(cp.brand) and cp.brand != "")
      |> group_by([cp, _vp, _v, _last, _ps], cp.brand)
      |> select([cp, _vp, _v, _last, _ps], {cp.brand, count(cp.id)})
      |> Repo.all()
      |> Enum.into(%{})

    dosage_unit =
      scoped
      |> where([cp, _vp, _v, _last, _ps], not is_nil(cp.dosage_unit) and cp.dosage_unit != "")
      |> group_by([cp, _vp, _v, _last, _ps], cp.dosage_unit)
      |> select([cp, _vp, _v, _last, _ps], {cp.dosage_unit, count(cp.id)})
      |> Repo.all()
      |> Enum.into(%{})

    %{vendor_name: vendor_name, brand: brand, dosage_unit: dosage_unit}
  end

  defp scoped_offers_query(query, min_price, max_price, brands, vendors, dosages) do
    latest = latest_snapshots_subquery()

    base =
      from cp in CatalogProduct,
        join: vp in VendorProduct,
        on: vp.catalog_product_id == cp.id and vp.active == true,
        join: v in Vendor,
        on: v.id == vp.vendor_id and v.active == true,
        join: lp in subquery(latest),
        on: lp.vendor_product_id == vp.id,
        join: ps in PriceSnapshot,
        on: ps.vendor_product_id == vp.id and ps.captured_at == lp.captured_at

    base =
      if is_binary(query) and String.trim(query) != "" do
        term = "%" <> String.trim(query) <> "%"
        where(base, [cp, vp, _v, _lp, _ps], ilike(cp.display_name, ^term) or ilike(vp.title, ^term))
      else
        base
      end

    base =
      if is_integer(min_price) do
        where(base, [_cp, _vp, _v, _lp, ps], ps.price_cents >= ^min_price)
      else
        base
      end

    base =
      if is_integer(max_price) and max_price > 0 do
        where(base, [_cp, _vp, _v, _lp, ps], ps.price_cents <= ^max_price)
      else
        base
      end

    base =
      if is_list(brands) and brands != [] do
        where(base, [cp, _vp, _v, _lp, _ps], cp.brand in ^brands)
      else
        base
      end

    base =
      if is_list(vendors) and vendors != [] do
        where(base, [_cp, _vp, v, _lp, _ps], v.name in ^vendors)
      else
        base
      end

    if is_list(dosages) and dosages != [] do
      where(base, [cp, _vp, _v, _lp, _ps], cp.dosage_unit in ^dosages)
    else
      base
    end
  end

  defp latest_snapshots_subquery do
    from ps in PriceSnapshot,
      where: ps.in_stock == true and not is_nil(ps.price_cents),
      group_by: ps.vendor_product_id,
      select: %{vendor_product_id: ps.vendor_product_id, captured_at: max(ps.captured_at)}
  end

  defp merge_groups_by_signature(groups) do
    groups
    |> Enum.group_by(&group_signature/1)
    |> Enum.map(fn {_signature, merged_groups} ->
      Enum.reduce(merged_groups, nil, fn group, acc ->
        if is_nil(acc) do
          group
        else
          merged_products = dedupe_products(acc.products ++ group.products)
          min_price = min(acc.price_range.min, group.price_range.min)
          max_price = max(acc.price_range.max, group.price_range.max)
          avg_price = average_price(merged_products)
          vendor_count = merged_products |> Enum.map(& &1.vendor_id) |> Enum.uniq() |> length()

          %{
            acc
            | catalog_product_ids: Enum.uniq(acc.catalog_product_ids ++ group.catalog_product_ids),
              products: Enum.sort_by(merged_products, fn p -> {p.price || 0, p.vendor_name || ""} end),
              product_count: length(merged_products),
              vendor_count: vendor_count,
              price_range: %{min: min_price, max: max_price, avg: avg_price}
          }
        end
      end)
    end)
    |> Enum.sort_by(fn group ->
      {group.price_range.min || 0, String.downcase(group.display_name || "")}
    end)
  end

  defp group_signature(group) do
    base =
      group.display_name
      |> normalize_for_grouping()
      |> remove_stop_words()
      |> String.replace(~r/\s+/u, " ")
      |> String.trim()

    [brand_token(group.brand), dosage_token(group.dosage_unit), base]
    |> Enum.reject(&(&1 in [nil, ""]))
    |> Enum.join("|")
  end

  defp normalize_for_grouping(value) do
    value
    |> to_string()
    |> String.downcase()
    |> String.replace(~r/[^\p{L}\p{N}\s]/u, " ")
    |> String.replace(~r/\s+/u, " ")
    |> String.trim()
  end

  defp remove_stop_words(value) do
    value
    |> String.split(" ", trim: true)
    |> Enum.reject(fn token ->
      token in ~w(tablete tableta kapsule kapsula sirup krema gel rastvor sprej kom a na za sa od u i)
    end)
    |> Enum.join(" ")
  end

  defp brand_token(nil), do: nil
  defp brand_token(""), do: nil
  defp brand_token(brand), do: normalize_for_grouping(brand)

  defp dosage_token(nil), do: nil
  defp dosage_token(""), do: nil
  defp dosage_token(dosage), do: normalize_for_grouping(dosage)

  defp dedupe_products(products) do
    products
    |> Enum.uniq_by(fn p -> {p.vendor_id, p.link} end)
  end

  defp average_price([]), do: 0

  defp average_price(products) do
    prices = Enum.map(products, &(&1.price || 0))
    Enum.sum(prices) / max(length(prices), 1) |> round()
  end

  defp to_int(nil), do: 0
  defp to_int(%Decimal{} = val), do: val |> Decimal.to_float() |> round()
  defp to_int(val) when is_float(val), do: round(val)
  defp to_int(val) when is_integer(val), do: val

  defp upsert_catalog_product(%Product{} = product) do
    normalized = normalize_title(product.title)

    Repo.insert!(
      CatalogProduct.changeset(%CatalogProduct{}, %{
        normalized_name: normalized,
        display_name: product.title
      }),
      on_conflict: [set: [display_name: product.title]],
      conflict_target: :normalized_name,
      returning: true
    )
  end

  defp source_key(%Product{external_id: external_id, url: url, title: title}) do
    cond do
      is_binary(external_id) and external_id != "" -> external_id
      is_binary(url) and url != "" -> url
      true -> "title:" <> normalize_title(title)
    end
  end

  defp normalize_title(value) do
    value
    |> String.downcase()
    |> String.replace(~r/[^\p{L}\p{N}\s]/u, " ")
    |> String.replace(~r/\s+/u, " ")
    |> String.trim()
  end
end
