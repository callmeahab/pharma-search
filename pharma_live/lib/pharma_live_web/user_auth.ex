defmodule PharmaLiveWeb.UserAuth do
  use PharmaLiveWeb, :controller

  import Plug.Conn

  alias PharmaLive.Accounts

  @user_session_key "user_id"

  def fetch_current_user(conn, _opts) do
    user =
      conn
      |> get_session(@user_session_key)
      |> fetch_user_from_session()

    assign(conn, :current_user, user)
  end

  def log_in_user(conn, user) do
    conn
    |> renew_session()
    |> put_session(@user_session_key, user.id)
  end

  def log_out_user(conn) do
    configure_session(conn, drop: true)
  end

  def on_mount(:mount_current_user, _params, session, socket) do
    user = fetch_user_from_session(session[@user_session_key])
    {:cont, Phoenix.Component.assign_new(socket, :current_user, fn -> user end)}
  end

  def on_mount(:ensure_authenticated, _params, session, socket) do
    user = fetch_user_from_session(session[@user_session_key])
    socket = Phoenix.Component.assign_new(socket, :current_user, fn -> user end)

    if socket.assigns.current_user do
      {:cont, socket}
    else
      {:halt,
       socket
       |> Phoenix.LiveView.put_flash(:error, "Morate biti prijavljeni.")
       |> Phoenix.LiveView.redirect(to: ~p"/prijava")}
    end
  end

  defp renew_session(conn) do
    conn
    |> configure_session(renew: true)
    |> clear_session()
  end

  defp fetch_user_from_session(user_id) when is_integer(user_id), do: Accounts.get_user(user_id)

  defp fetch_user_from_session(user_id) when is_binary(user_id) do
    case Integer.parse(user_id) do
      {id, ""} -> Accounts.get_user(id)
      _ -> nil
    end
  end

  defp fetch_user_from_session(_), do: nil
end
