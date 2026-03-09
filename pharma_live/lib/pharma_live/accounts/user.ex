defmodule PharmaLive.Accounts.User do
  use Ecto.Schema
  import Ecto.Changeset

  schema "users" do
    field :email, :string
    field :name, :string
    field :password, :string, virtual: true
    field :password_hash, :string

    has_many :wishlist_items, PharmaLive.Accounts.UserWishlistItem

    timestamps(type: :utc_datetime_usec)
  end

  def registration_changeset(user, attrs) do
    user
    |> cast(attrs, [:email, :name, :password])
    |> validate_required([:email, :name, :password])
    |> validate_length(:password, min: 6, max: 128)
    |> validate_format(:email, ~r/^[^\s]+@[^\s]+$/)
    |> unique_constraint(:email)
    |> put_password_hash()
  end

  def update_profile_changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :email])
    |> validate_required([:name, :email])
    |> validate_format(:email, ~r/^[^\s]+@[^\s]+$/)
    |> unique_constraint(:email)
  end

  def password_changeset(user, attrs) do
    user
    |> cast(attrs, [:password])
    |> validate_required([:password])
    |> validate_length(:password, min: 6, max: 128)
    |> put_password_hash()
  end

  defp put_password_hash(changeset) do
    password = get_change(changeset, :password)

    if is_binary(password) do
      put_change(changeset, :password_hash, PharmaLive.Accounts.Password.hash(password))
    else
      changeset
    end
  end
end
