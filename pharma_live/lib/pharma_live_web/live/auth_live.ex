defmodule PharmaLiveWeb.AuthLive do
  use PharmaLiveWeb, :live_view

  alias PharmaLive.Accounts

  @impl true
  def mount(_params, _session, socket) do
    user = socket.assigns[:current_user]

    socket =
      socket
      |> assign(:page_title, "Aposteka")
      |> assign(:active_tab, :settings)
      |> assign(:wishlist_groups, wishlist_groups(user))

    if user && socket.assigns.live_action in [:login, :register] do
      {:ok, push_navigate(socket, to: ~p"/profil")}
    else
      {:ok, socket}
    end
  end

  @impl true
  def handle_event("profile_tab", %{"tab" => tab}, socket) do
    next = if tab == "wishlist", do: :wishlist, else: :settings
    {:noreply, assign(socket, :active_tab, next)}
  end

  def handle_event("save_profile", %{"user" => params}, socket) do
    case Accounts.update_user_profile(socket.assigns.current_user, params) do
      {:ok, user} ->
        {:noreply, socket |> assign(:current_user, user) |> put_flash(:info, "Profil je sacuvan.")}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, put_flash(socket, :error, first_error(changeset))}
    end
  end

  def handle_event("change_password", %{"user" => params}, socket) do
    password = Map.get(params, "password", "")
    confirmation = Map.get(params, "password_confirmation", "")

    if password == confirmation do
      case Accounts.update_user_password(socket.assigns.current_user, %{"password" => password}) do
        {:ok, _user} -> {:noreply, put_flash(socket, :info, "Lozinka je promenjena.")}
        {:error, %Ecto.Changeset{} = changeset} -> {:noreply, put_flash(socket, :error, first_error(changeset))}
      end
    else
      {:noreply, put_flash(socket, :error, "Lozinke se ne poklapaju.")}
    end
  end

  def handle_event("remove_wishlist", %{"id" => id}, socket) do
    with {catalog_product_id, ""} <- Integer.parse(to_string(id)),
         :removed <- Accounts.toggle_wishlist(socket.assigns.current_user, catalog_product_id) do
      {:noreply, socket |> assign(:wishlist_groups, wishlist_groups(socket.assigns.current_user)) |> put_flash(:info, "Proizvod je uklonjen iz wishlist-e.")}
    else
      _ -> {:noreply, socket}
    end
  end

  @impl true
  def render(assigns) do
    ~H"""
    <div class="min-h-screen bg-base-100">
      <.flash kind={:info} flash={@flash} />
      <.flash kind={:error} flash={@flash} />

      <nav class="border-b border-base-300 bg-base-100">
        <div class="container mx-auto flex items-center justify-between px-4 py-4">
          <a href={~p"/"} class="text-2xl font-bold text-green-600">Aposteka</a>
          <a class="btn btn-ghost btn-sm" href={~p"/"}>Nazad na pocetnu</a>
        </div>
      </nav>

      <main class="container mx-auto px-4 py-12">
        <%= case @live_action do %>
          <% :login -> %>
            <div class="mx-auto max-w-md rounded-box border border-base-300 p-6">
              <h1 class="mb-4 text-3xl font-bold">Prijava</h1>
              <form method="post" action={~p"/auth/login"} class="space-y-3">
                <input type="hidden" name="_csrf_token" value={Plug.CSRFProtection.get_csrf_token()} />
                <input type="email" name="user[email]" required class="input input-bordered w-full" placeholder="Email adresa" />
                <input type="password" name="user[password]" required class="input input-bordered w-full" placeholder="Lozinka" />
                <button class="btn btn-primary w-full">Prijavite se</button>
              </form>
              <div class="mt-3 text-sm">
                <a class="link" href={~p"/registracija"}>Registracija</a>
                <span class="mx-2">.</span>
                <a class="link" href={~p"/reset-lozinke"}>Reset lozinke</a>
              </div>
            </div>

          <% :register -> %>
            <div class="mx-auto max-w-md rounded-box border border-base-300 p-6">
              <h1 class="mb-4 text-3xl font-bold">Registracija</h1>
              <form method="post" action={~p"/auth/register"} class="space-y-3">
                <input type="hidden" name="_csrf_token" value={Plug.CSRFProtection.get_csrf_token()} />
                <input name="user[name]" required class="input input-bordered w-full" placeholder="Ime i prezime" />
                <input type="email" name="user[email]" required class="input input-bordered w-full" placeholder="Email adresa" />
                <input type="password" name="user[password]" required class="input input-bordered w-full" placeholder="Lozinka" />
                <input type="password" name="user[password_confirmation]" required class="input input-bordered w-full" placeholder="Potvrdite lozinku" />
                <button class="btn btn-primary w-full">Registrujte se</button>
              </form>
            </div>

          <% :reset_password -> %>
            <div class="mx-auto max-w-md rounded-box border border-base-300 p-6">
              <h1 class="mb-4 text-3xl font-bold">Reset lozinke</h1>
              <p class="text-sm text-base-content/70">
                Reset tok jos nije implementiran. Koristite profil stranicu nakon prijave za promenu lozinke.
              </p>
            </div>

          <% :profile -> %>
            <div class="mx-auto max-w-4xl">
              <h1 class="mb-4 text-3xl font-bold">Profil</h1>
              <div class="mb-4 flex gap-2">
                <button class={["btn btn-sm", if(@active_tab == :settings, do: "btn-primary", else: "btn-outline")]} phx-click="profile_tab" phx-value-tab="settings">Podesavanja</button>
                <button class={["btn btn-sm", if(@active_tab == :wishlist, do: "btn-primary", else: "btn-outline")]} phx-click="profile_tab" phx-value-tab="wishlist">Wishlist</button>
              </div>

              <div class="rounded-box border border-base-300 p-4">
                <%= if @active_tab == :settings do %>
                  <div class="grid gap-6 md:grid-cols-2">
                    <form phx-submit="save_profile" class="space-y-3">
                      <h2 class="text-lg font-semibold">Osnovni podaci</h2>
                      <input name="user[name]" value={@current_user.name} required class="input input-bordered w-full" placeholder="Ime i prezime" />
                      <input type="email" name="user[email]" value={@current_user.email} required class="input input-bordered w-full" placeholder="Email adresa" />
                      <button class="btn btn-primary">Sacuvaj podatke</button>
                    </form>

                    <form phx-submit="change_password" class="space-y-3">
                      <h2 class="text-lg font-semibold">Promena lozinke</h2>
                      <input type="password" name="user[password]" required class="input input-bordered w-full" placeholder="Nova lozinka" />
                      <input type="password" name="user[password_confirmation]" required class="input input-bordered w-full" placeholder="Potvrdite novu lozinku" />
                      <button class="btn btn-outline">Promeni lozinku</button>
                    </form>
                  </div>
                <% else %>
                  <%= if @wishlist_groups == [] do %>
                    <p class="text-base-content/70">Wishlist je prazna.</p>
                  <% else %>
                    <div class="space-y-2">
                      <%= for group <- @wishlist_groups do %>
                        <div class="flex items-center justify-between rounded border border-base-300 p-3">
                          <div>
                            <div class="font-medium">{group.display_name}</div>
                            <div class="text-sm text-base-content/70">
                              {group.vendor_count} apoteka · {format_price(group.min_price)} - {format_price(group.max_price)}
                            </div>
                          </div>
                          <button class="btn btn-xs btn-outline" phx-click="remove_wishlist" phx-value-id={group.id}>Ukloni</button>
                        </div>
                      <% end %>
                    </div>
                  <% end %>
                <% end %>
              </div>
            </div>
        <% end %>
      </main>
    </div>
    """
  end

  defp wishlist_groups(user), do: Accounts.list_wishlist_groups(user)

  defp first_error(%Ecto.Changeset{} = changeset) do
    case changeset.errors do
      [{field, {msg, _opts}} | _] -> "#{Phoenix.Naming.humanize(field)} #{msg}"
      _ -> "Neuspelo cuvanje."
    end
  end

  defp format_price(nil), do: "N/A"
  defp format_price(cents), do: "#{:erlang.float_to_binary(cents / 100, decimals: 2)} RSD"
end
