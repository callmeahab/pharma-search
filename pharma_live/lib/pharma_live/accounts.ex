defmodule PharmaLive.Accounts do
  import Ecto.Query, warn: false

  alias PharmaLive.Accounts.Password
  alias PharmaLive.Accounts.User
  alias PharmaLive.Accounts.UserWishlistItem
  alias PharmaLive.Catalog.CatalogProduct
  alias PharmaLive.Catalog.PriceSnapshot
  alias PharmaLive.Catalog.VendorProduct
  alias PharmaLive.Repo

  def get_user(id) when is_integer(id), do: Repo.get(User, id)
  def get_user(_), do: nil

  def get_user_by_email(email) when is_binary(email) do
    Repo.get_by(User, email: String.downcase(String.trim(email)))
  end

  def get_user_by_email(_), do: nil

  def register_user(attrs) do
    attrs = normalize_user_attrs(attrs)
    %User{} |> User.registration_changeset(attrs) |> Repo.insert()
  end

  def authenticate_user(email, password) do
    user = get_user_by_email(email)

    cond do
      is_nil(user) -> {:error, :invalid_credentials}
      Password.verify(password, user.password_hash) -> {:ok, user}
      true -> {:error, :invalid_credentials}
    end
  end

  def update_user_profile(%User{} = user, attrs) do
    attrs = normalize_user_attrs(attrs)
    user |> User.update_profile_changeset(attrs) |> Repo.update()
  end

  def update_user_password(%User{} = user, attrs) do
    user |> User.password_changeset(attrs) |> Repo.update()
  end

  def wishlist_ids(%User{id: user_id}) do
    from(w in UserWishlistItem, where: w.user_id == ^user_id, select: w.catalog_product_id)
    |> Repo.all()
    |> MapSet.new()
  end

  def wishlist_ids(_), do: MapSet.new()

  def toggle_wishlist(%User{id: user_id}, catalog_product_id) when is_integer(catalog_product_id) do
    existing =
      Repo.get_by(UserWishlistItem,
        user_id: user_id,
        catalog_product_id: catalog_product_id
      )

    if existing do
      {:ok, _} = Repo.delete(existing)
      :removed
    else
      {:ok, _} =
        %UserWishlistItem{}
        |> UserWishlistItem.changeset(%{user_id: user_id, catalog_product_id: catalog_product_id})
        |> Repo.insert()

      :added
    end
  end

  def list_wishlist_groups(%User{id: user_id}) do
    latest =
      from ps in PriceSnapshot,
        where: ps.in_stock == true and not is_nil(ps.price_cents),
        group_by: ps.vendor_product_id,
        select: %{vendor_product_id: ps.vendor_product_id, captured_at: max(ps.captured_at)}

    from(w in UserWishlistItem,
      where: w.user_id == ^user_id,
      join: cp in CatalogProduct,
      on: cp.id == w.catalog_product_id,
      join: vp in VendorProduct,
      on: vp.catalog_product_id == cp.id and vp.active == true,
      join: lp in subquery(latest),
      on: lp.vendor_product_id == vp.id,
      join: ps in PriceSnapshot,
      on: ps.vendor_product_id == vp.id and ps.captured_at == lp.captured_at,
      group_by: [cp.id, cp.display_name, cp.normalized_name],
      select: %{
        id: cp.id,
        display_name: cp.display_name,
        normalized_name: cp.normalized_name,
        vendor_count: count(fragment("distinct ?", vp.vendor_id)),
        min_price: min(ps.price_cents),
        max_price: max(ps.price_cents)
      },
      order_by: [asc: min(ps.price_cents), asc: cp.display_name]
    )
    |> Repo.all()
  end

  def list_wishlist_groups(_), do: []

  defp normalize_user_attrs(attrs) do
    attrs = Map.new(attrs)

    attrs
    |> update_string("email", &String.downcase(String.trim(&1)))
    |> update_string(:email, &String.downcase(String.trim(&1)))
    |> update_string("name", &String.trim/1)
    |> update_string(:name, &String.trim/1)
  end

  defp update_string(map, key, fun) do
    case Map.get(map, key) do
      value when is_binary(value) -> Map.put(map, key, fun.(value))
      _ -> map
    end
  end
end
