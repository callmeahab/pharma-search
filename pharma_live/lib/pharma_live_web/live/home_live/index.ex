defmodule PharmaLiveWeb.HomeLive.Index do
  use PharmaLiveWeb, :live_view

  alias PharmaLive.Accounts
  alias PharmaLive.Catalog

  @page_size 24

  @impl true
  def mount(_params, _session, socket) do
    current_user = socket.assigns[:current_user]

    filters = %{
      min_price: nil,
      max_price: nil,
      brands: [],
      vendors: [],
      dosages: [],
      group_similar: true
    }

    socket =
      socket
      |> assign(:page_title, "Aposteka")
      |> assign(:search_term, "")
      |> assign(:suggestions, [])
      |> assign(:show_suggestions, false)
      |> assign(:filters, filters)
      |> assign(:groups, [])
      |> assign(:total_groups, 0)
      |> assign(:total_products, 0)
      |> assign(:facets, %{})
      |> assign(:offset, 0)
      |> assign(:has_more, false)
      |> assign(:mode, :featured)
      |> assign(:selected_group, nil)
      |> assign(:current_user, current_user)
      |> assign(:wishlist_ids, Accounts.wishlist_ids(current_user))

    {:ok, socket}
  end

  @impl true
  def handle_params(params, _uri, socket) do
    term = params |> Map.get("q", "") |> String.trim()
    {:noreply, socket |> assign(:show_suggestions, false) |> reload(term, 0)}
  end

  @impl true
  def handle_event("search_input", %{"q" => term}, socket) do
    term = String.trim(term || "")
    suggestions = if String.length(term) >= 2, do: Catalog.autocomplete(term, 8), else: []
    {:noreply, assign(socket, search_term: term, suggestions: suggestions, show_suggestions: suggestions != [])}
  end

  def handle_event("pick_suggestion", %{"title" => title}, socket) do
    term = String.trim(title || "")
    {:noreply, push_patch(socket, to: ~p"/?q=#{term}")}
  end

  def handle_event("search", %{"q" => term}, socket) do
    term = String.trim(term || "")

    if term == "" do
      {:noreply, push_patch(socket, to: ~p"/")}
    else
      {:noreply, push_patch(socket, to: ~p"/?q=#{term}")}
    end
  end

  def handle_event("clear_search", _params, socket) do
    {:noreply, push_patch(socket, to: ~p"/")}
  end

  def handle_event("toggle_grouping", _params, socket) do
    {:noreply, update(socket, :filters, &Map.update!(&1, :group_similar, fn v -> not v end))}
  end

  def handle_event("toggle_brand", %{"value" => value}, socket) do
    {:noreply, socket |> toggle_filter(:brands, value) |> reload(socket.assigns.search_term, 0)}
  end

  def handle_event("toggle_vendor", %{"value" => value}, socket) do
    {:noreply, socket |> toggle_filter(:vendors, value) |> reload(socket.assigns.search_term, 0)}
  end

  def handle_event("toggle_dosage", %{"value" => value}, socket) do
    {:noreply, socket |> toggle_filter(:dosages, value) |> reload(socket.assigns.search_term, 0)}
  end

  def handle_event("set_price", %{"min" => min, "max" => max}, socket) do
    filters =
      socket.assigns.filters
      |> Map.put(:min_price, parse_optional_int(min))
      |> Map.put(:max_price, parse_optional_int(max))

    {:noreply, socket |> assign(:filters, filters) |> reload(socket.assigns.search_term, 0)}
  end

  def handle_event("clear_filters", _params, socket) do
    filters = %{socket.assigns.filters | min_price: nil, max_price: nil, brands: [], vendors: [], dosages: []}
    {:noreply, socket |> assign(:filters, filters) |> reload(socket.assigns.search_term, 0)}
  end

  def handle_event("load_more", _params, socket) do
    if socket.assigns.has_more and socket.assigns.mode == :search do
      {:noreply, reload(socket, socket.assigns.search_term, socket.assigns.offset)}
    else
      {:noreply, socket}
    end
  end

  def handle_event("open_group", %{"id" => id}, socket) do
    selected = Enum.find(socket.assigns.groups, fn g -> g.id == id end)
    {:noreply, assign(socket, :selected_group, selected)}
  end

  def handle_event("toggle_wishlist", %{"id" => id}, socket) do
    user = socket.assigns.current_user

    if user do
      with {catalog_product_id, ""} <- Integer.parse(to_string(id)) do
        _ = Accounts.toggle_wishlist(user, catalog_product_id)
        wishlist_ids = Accounts.wishlist_ids(user)
        {:noreply, assign(socket, :wishlist_ids, wishlist_ids)}
      else
        _ -> {:noreply, socket}
      end
    else
      {:noreply, socket |> put_flash(:info, "Prijavite se da sacuvate proizvod.") |> push_navigate(to: ~p"/prijava")}
    end
  end

  def handle_event("close_modal", _params, socket) do
    {:noreply, assign(socket, :selected_group, nil)}
  end

  defp reload(socket, term, offset) do
    filters = socket.assigns.filters

    result =
      if term == "" do
        Catalog.featured_groups(@page_size)
      else
        Catalog.search_groups(term,
          limit: @page_size,
          offset: offset,
          min_price: filters.min_price,
          max_price: filters.max_price,
          brands: filters.brands,
          vendors: filters.vendors,
          dosages: filters.dosages,
          include_facets: true
        )
      end

    mode = if term == "", do: :featured, else: :search
    new_groups = if offset > 0 and mode == :search, do: socket.assigns.groups ++ result.groups, else: result.groups
    next_offset = offset + length(result.groups)

    socket
    |> assign(:search_term, term)
    |> assign(:mode, mode)
    |> assign(:groups, new_groups)
    |> assign(:total_groups, result.total_groups)
    |> assign(:total_products, result.total_products)
    |> assign(:facets, result.facets || %{})
    |> assign(:offset, next_offset)
    |> assign(:has_more, next_offset < result.total_groups)
  end

  defp toggle_filter(socket, key, value) do
    filters = socket.assigns.filters
    items = Map.get(filters, key, [])
    updated = if value in items, do: List.delete(items, value), else: [value | items]
    assign(socket, :filters, Map.put(filters, key, updated))
  end

  defp parse_optional_int(nil), do: nil
  defp parse_optional_int(""), do: nil

  defp parse_optional_int(value) do
    case Integer.parse(to_string(value)) do
      {int, _} when int >= 0 -> int
      _ -> nil
    end
  end

  defp format_price(nil), do: "N/A"

  defp format_price(cents) do
    "#{:erlang.float_to_binary(cents / 100, decimals: 2)} RSD"
  end

  defp filter_selected?(list, value), do: value in list

  @impl true
  def render(assigns) do
    ~H"""
    <div class="min-h-screen bg-base-100">
      <.flash kind={:info} flash={@flash} />
      <.flash kind={:error} flash={@flash} />

      <.site_nav search_term={@search_term} suggestions={@suggestions} show_suggestions={@show_suggestions} current_user={@current_user} />

      <main class="container mx-auto px-4 py-8">
        <%= if @search_term == "" do %>
          <section class="mb-8 rounded-box bg-gradient-to-r from-green-500 to-emerald-700 p-8 text-white">
            <h1 class="text-3xl font-bold">Aposteka</h1>
            <p class="mt-2 max-w-3xl text-white/90">
              Najbolji izbor farmaceutskih proizvoda, suplemenata i opreme na jednom mestu.
            </p>
          </section>
        <% end %>

        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-2xl font-semibold">
            <%= if @search_term == "", do: "Popularni proizvodi", else: "Rezultati za \"#{@search_term}\"" %>
          </h2>

          <%= if @mode == :search do %>
            <button class="btn btn-sm" phx-click="toggle_grouping">
              <%= if @filters.group_similar, do: "Grupisano", else: "Lista" %>
            </button>
          <% end %>
        </div>

        <%= if @mode == :search do %>
          <div class="mb-4 text-sm text-base-content/70">
            {@total_groups} grupa ({@total_products} proizvoda)
          </div>
        <% end %>

        <div class="flex flex-col gap-6 lg:flex-row">
          <%= if @mode == :search do %>
            <aside class="lg:w-72">
              <div class="rounded-box border border-base-300 p-4">
                <div class="mb-3 font-semibold">Filteri</div>

                <form phx-submit="set_price" class="mb-4 grid grid-cols-2 gap-2">
                  <input name="min" type="number" placeholder="Min" value={@filters.min_price} class="input input-bordered input-sm w-full" />
                  <input name="max" type="number" placeholder="Max" value={@filters.max_price} class="input input-bordered input-sm w-full" />
                  <button class="btn btn-sm col-span-2">Primeni cenu</button>
                </form>

                <button class="btn btn-ghost btn-xs mb-4" phx-click="clear_filters">Obrisi filtere</button>

                <%= if map_size(@facets) > 0 do %>
                  <.facet_list title="Brend" name="toggle_brand" selected={@filters.brands} values={Map.get(@facets, :brand, %{})} />
                  <.facet_list title="Apoteka" name="toggle_vendor" selected={@filters.vendors} values={Map.get(@facets, :vendor_name, %{})} />
                  <.facet_list title="Doza" name="toggle_dosage" selected={@filters.dosages} values={Map.get(@facets, :dosage_unit, %{})} />
                <% end %>
              </div>
            </aside>
          <% end %>

          <section class="flex-1">
            <%= if @groups == [] do %>
              <div class="rounded-box border border-base-300 p-8 text-center text-base-content/70">
                Nema rezultata.
              </div>
            <% else %>
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <%= if @filters.group_similar do %>
                  <%= for group <- @groups do %>
                    <article class="rounded-box border border-base-300 p-4">
                      <h3 class="line-clamp-2 font-semibold">{group.display_name}</h3>
                      <p class="mt-1 text-sm text-base-content/60">Dostupno u {group.vendor_count} apoteka</p>
                      <p class="mt-2 text-lg font-bold text-success">{format_price(group.price_range.min)}</p>
                      <div class="mt-3 space-y-1">
                        <%= for product <- Enum.take(group.products, 3) do %>
                          <a href={product.link} target="_blank" class="block text-sm hover:underline">
                            {product.vendor_name}: {format_price(product.price)}
                          </a>
                        <% end %>
                      </div>
                      <div class="mt-3 flex gap-2">
                        <button class="btn btn-sm btn-outline" phx-click="open_group" phx-value-id={group.id}>Uporedi cene</button>
                        <button class={["btn btn-sm", if(wishlisted?(@wishlist_ids, group.id), do: "btn-secondary", else: "btn-ghost")]} phx-click="toggle_wishlist" phx-value-id={group.id}>
                          <%= if wishlisted?(@wishlist_ids, group.id), do: "U wishlist-i", else: "Dodaj u wishlist" %>
                        </button>
                      </div>
                    </article>
                  <% end %>
                <% else %>
                  <%= for group <- standalone_groups(@groups), product <- group.products do %>
                    <article class="rounded-box border border-base-300 p-4">
                      <h3 class="line-clamp-2 font-semibold">{product.title}</h3>
                      <p class="mt-1 text-sm text-base-content/60">{product.vendor_name}</p>
                      <p class="mt-2 text-lg font-bold text-success">{format_price(product.price)}</p>
                      <div class="mt-3 flex gap-2">
                        <a href={product.link} target="_blank" class="btn btn-sm btn-outline">Otvori ponudu</a>
                        <button class={["btn btn-sm", if(wishlisted?(@wishlist_ids, group.id), do: "btn-secondary", else: "btn-ghost")]} phx-click="toggle_wishlist" phx-value-id={group.id}>
                          <%= if wishlisted?(@wishlist_ids, group.id), do: "U wishlist-i", else: "Dodaj" %>
                        </button>
                      </div>
                    </article>
                  <% end %>
                <% end %>
              </div>

              <%= if @has_more and @mode == :search do %>
                <div class="mt-6 text-center">
                  <button id="load-more-btn" class="btn" phx-click="load_more">Ucitaj jos</button>
                  <div id="load-more-sentinel" phx-hook="InfiniteScroll" data-target-id="load-more-btn"></div>
                </div>
              <% end %>
            <% end %>
          </section>
        </div>
      </main>

      <.price_modal selected_group={@selected_group} />
      <.site_footer />
    </div>
    """
  end

  attr :selected_group, :map, default: nil

  defp price_modal(assigns) do
    ~H"""
    <%= if @selected_group do %>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" phx-click="close_modal">
        <div class="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-box bg-base-100 p-5" phx-click-away="close_modal">
          <div class="mb-3 flex items-start justify-between gap-3">
            <h3 class="text-xl font-bold">{@selected_group.display_name}</h3>
            <button class="btn btn-sm btn-ghost" phx-click="close_modal">X</button>
          </div>
          <p class="mb-3 text-sm text-base-content/70">Poredjenje cena po apotekama</p>
          <div class="space-y-2">
            <%= for product <- Enum.sort_by(@selected_group.products, & &1.price) do %>
              <a href={product.link} target="_blank" class="flex items-center justify-between rounded border border-base-300 px-3 py-2 hover:bg-base-200">
                <div>
                  <div class="font-medium">{product.vendor_name}</div>
                  <div class="text-xs text-base-content/60">{product.title}</div>
                </div>
                <div class="font-semibold text-success">{format_price(product.price)}</div>
              </a>
            <% end %>
          </div>
        </div>
      </div>
    <% end %>
    """
  end

  attr :search_term, :string, required: true
  attr :suggestions, :list, required: true
  attr :show_suggestions, :boolean, required: true
  attr :current_user, :map, default: nil

  defp site_nav(assigns) do
    ~H"""
    <nav class="border-b border-base-300 bg-base-100">
      <div class="container mx-auto flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center">
        <a href={~p"/"} class="text-2xl font-bold">
          <span class="text-green-400">Apo</span><span class="text-yellow-500">$</span><span class="text-green-700">teka</span>
        </a>
        <div class="relative w-full max-w-3xl">
          <form phx-submit="search" phx-change="search_input" class="flex gap-2">
            <input type="text" name="q" value={@search_term} placeholder="Pretrazite proizvode..." class="input input-bordered w-full" autocomplete="off" />
            <button class="btn btn-primary">Pretrazi</button>
            <%= if @search_term != "" do %>
              <button type="button" class="btn btn-ghost" phx-click="clear_search">X</button>
            <% end %>
          </form>
          <%= if @show_suggestions do %>
            <div class="absolute z-20 mt-1 w-full rounded-box border border-base-300 bg-base-100 shadow-lg">
              <%= for suggestion <- @suggestions do %>
                <button class="block w-full px-3 py-2 text-left hover:bg-base-200" phx-click="pick_suggestion" phx-value-title={suggestion.title}>
                  <div class="text-sm font-medium">{suggestion.title}</div>
                  <div class="text-xs text-base-content/60">{suggestion.vendor_name} - {format_price(suggestion.price)}</div>
                </button>
              <% end %>
            </div>
          <% end %>
        </div>
        <div class="ml-auto flex gap-2">
          <a class="btn btn-ghost btn-sm" href={~p"/faq"}>FAQ</a>
          <a class="btn btn-ghost btn-sm" href={~p"/kontakt"}>Kontakt</a>
          <Layouts.theme_toggle />
          <%= if @current_user do %>
            <a class="btn btn-outline btn-sm" href={~p"/profil"}>{@current_user.name}</a>
            <.link href={~p"/auth/logout"} method="delete" class="btn btn-ghost btn-sm">Odjava</.link>
          <% else %>
            <a class="btn btn-outline btn-sm" href={~p"/prijava"}>Prijava</a>
          <% end %>
        </div>
      </div>
    </nav>
    """
  end

  attr :title, :string, required: true
  attr :name, :string, required: true
  attr :selected, :list, required: true
  attr :values, :map, required: true

  defp facet_list(assigns) do
    entries =
      assigns.values
      |> Enum.sort_by(fn {_k, c} -> -c end)
      |> Enum.take(12)

    assigns = assign(assigns, :entries, entries)

    ~H"""
    <div class="mb-4">
      <div class="mb-1 text-sm font-medium">{@title}</div>
      <div class="space-y-1">
        <%= for {name, count} <- @entries do %>
          <button phx-click={@name} phx-value-value={name} class={["block w-full rounded px-2 py-1 text-left text-sm hover:bg-base-200", if(filter_selected?(@selected, name), do: "bg-base-200 font-medium", else: "")]}>
            {name} ({count})
          </button>
        <% end %>
      </div>
    </div>
    """
  end

  defp site_footer(assigns) do
    ~H"""
    <footer class="mt-10 border-t border-base-300 bg-base-100">
      <div class="container mx-auto grid gap-6 px-4 py-8 md:grid-cols-4">
        <div>
          <div class="text-xl font-bold text-green-600">Aposteka</div>
          <p class="mt-2 text-sm text-base-content/70">Uporedite cene proizvoda i pronadjite najbolje ponude.</p>
        </div>
        <div><a class="link link-hover" href={~p"/o-nama"}>O nama</a></div>
        <div><a class="link link-hover" href={~p"/privatnost"}>Politika privatnosti</a></div>
        <div><a class="link link-hover" href={~p"/kontakt"}>Kontakt</a></div>
      </div>
    </footer>
    """
  end

  defp wishlisted?(wishlist_ids, group_id) do
    case Integer.parse(to_string(group_id)) do
      {id, ""} -> MapSet.member?(wishlist_ids, id)
      _ -> false
    end
  end

  defp standalone_groups(groups) do
    Enum.reject(groups, fn group ->
      length(Map.get(group, :catalog_product_ids, [])) > 1 or length(Map.get(group, :products, [])) > 1
    end)
  end
end
