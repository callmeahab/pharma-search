defmodule PharmaLiveWeb.AuthController do
  use PharmaLiveWeb, :controller

  alias PharmaLive.Accounts
  alias PharmaLiveWeb.UserAuth

  def register(conn, %{"user" => user_params}) do
    with :ok <- validate_password_confirmation(user_params),
         {:ok, user} <- Accounts.register_user(user_params) do
      conn
      |> UserAuth.log_in_user(user)
      |> put_flash(:info, "Nalog je kreiran.")
      |> redirect(to: ~p"/profil")
    else
      {:error, %Ecto.Changeset{} = changeset} ->
        conn
        |> put_flash(:error, changeset_error(changeset))
        |> redirect(to: ~p"/registracija")

      {:error, :password_confirmation} ->
        conn
        |> put_flash(:error, "Lozinke se ne poklapaju.")
        |> redirect(to: ~p"/registracija")
    end
  end

  def register(conn, _params) do
    conn
    |> put_flash(:error, "Neispravni podaci.")
    |> redirect(to: ~p"/registracija")
  end

  def login(conn, %{"user" => %{"email" => email, "password" => password}}) do
    case Accounts.authenticate_user(email, password) do
      {:ok, user} ->
        conn
        |> UserAuth.log_in_user(user)
        |> put_flash(:info, "Uspesna prijava.")
        |> redirect(to: ~p"/")

      {:error, :invalid_credentials} ->
        conn
        |> put_flash(:error, "Pogresan email ili lozinka.")
        |> redirect(to: ~p"/prijava")
    end
  end

  def login(conn, _params) do
    conn
    |> put_flash(:error, "Neispravni podaci za prijavu.")
    |> redirect(to: ~p"/prijava")
  end

  def logout(conn, _params) do
    conn
    |> UserAuth.log_out_user()
    |> put_flash(:info, "Odjavljeni ste.")
    |> redirect(to: ~p"/")
  end

  defp validate_password_confirmation(%{"password" => password, "password_confirmation" => confirmation})
       when is_binary(password) and is_binary(confirmation) do
    if password == confirmation, do: :ok, else: {:error, :password_confirmation}
  end

  defp validate_password_confirmation(_), do: {:error, :password_confirmation}

  defp changeset_error(changeset) do
    case changeset.errors do
      [{field, {message, _opts}} | _] -> "#{Phoenix.Naming.humanize(field)} #{message}"
      _ -> "Neuspesno cuvanje naloga."
    end
  end
end
