defmodule PharmaLiveWeb.StaticLive do
  use PharmaLiveWeb, :live_view

  @impl true
  def mount(_params, _session, socket) do
    {:ok, assign(socket, page_title: "Aposteka", sent?: false)}
  end

  @impl true
  def handle_event("send_contact", _params, socket) do
    {:noreply, put_flash(assign(socket, :sent?, true), :info, "Poruka je poslata. Hvala!")}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <div class="min-h-screen bg-base-100">
      <nav class="border-b border-base-300 bg-base-100">
        <div class="container mx-auto flex items-center justify-between px-4 py-4">
          <a href={~p"/"} class="text-2xl font-bold text-green-600">Aposteka</a>
          <div class="flex gap-2">
            <a class="btn btn-ghost btn-sm" href={~p"/"}>Pocetna</a>
            <a class="btn btn-ghost btn-sm" href={~p"/faq"}>FAQ</a>
            <a class="btn btn-ghost btn-sm" href={~p"/kontakt"}>Kontakt</a>
          </div>
        </div>
      </nav>

      <main class="container mx-auto px-4 py-10">
        <%= case @live_action do %>
          <% :about -> %>
            <div class="mx-auto max-w-4xl space-y-4">
              <h1 class="text-4xl font-bold">Aposteka - Vas digitalni vodic za zdravlje</h1>
              <p>Aposteka omogucava pregled i poredjenje cena proizvoda iz vise apoteka i prodavnica suplemenata.</p>
              <p>Nas cilj je da pretraga bude brza, transparentna i korisna za svakodnevnu kupovinu.</p>
            </div>
          <% :privacy -> %>
            <div class="mx-auto max-w-4xl space-y-4">
              <h1 class="text-4xl font-bold">Politika privatnosti</h1>
              <p>Vasa privatnost nam je vazna. Prikupljamo samo podatke potrebne za rad aplikacije i unapredjenje iskustva.</p>
              <p>Ne delimo podatke sa trecim stranama osim kada je to zakonski obavezno.</p>
              <p>Kontakt: <a class="link" href="mailto:apostekafm@gmail.com">apostekafm@gmail.com</a></p>
            </div>
          <% :faq -> %>
            <div class="mx-auto max-w-4xl">
              <h1 class="mb-6 text-4xl font-bold">Najcesce postavljana pitanja</h1>
              <div class="space-y-3">
                <details class="rounded-box border border-base-300 p-4"><summary class="cursor-pointer font-semibold">Sta je Aposteka?</summary><p class="mt-2">Platforma za poredjenje cena zdravstvenih proizvoda.</p></details>
                <details class="rounded-box border border-base-300 p-4"><summary class="cursor-pointer font-semibold">Da li je besplatno?</summary><p class="mt-2">Da, koriscenje platforme je besplatno.</p></details>
                <details class="rounded-box border border-base-300 p-4"><summary class="cursor-pointer font-semibold">Kako se azuriraju cene?</summary><p class="mt-2">Podaci se osvezavaju kroz automatizovane scrape run-ove.</p></details>
              </div>
            </div>
          <% :contact -> %>
            <div class="mx-auto grid max-w-5xl gap-8 md:grid-cols-2">
              <div>
                <h1 class="mb-4 text-4xl font-bold">Kontaktirajte nas</h1>
                <p class="text-base-content/70">Podrska je nas prioritet. Posaljite poruku i javicemo se uskoro.</p>
                <div class="mt-4 text-sm">
                  <p>Email: <a class="link" href="mailto:apostekafm@gmail.com">apostekafm@gmail.com</a></p>
                  <p>Adresa: WEB, 11000 Beograd, Srbija</p>
                </div>
              </div>
              <form phx-submit="send_contact" class="space-y-3 rounded-box border border-base-300 p-4">
                <input required class="input input-bordered w-full" placeholder="Ime i prezime" />
                <input required type="email" class="input input-bordered w-full" placeholder="Email adresa" />
                <textarea required class="textarea textarea-bordered h-32 w-full" placeholder="Poruka"></textarea>
                <button class="btn btn-primary w-full">Posalji poruku</button>
              </form>
            </div>
        <% end %>
      </main>
    </div>
    """
  end
end
