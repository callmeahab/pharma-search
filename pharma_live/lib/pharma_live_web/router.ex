defmodule PharmaLiveWeb.Router do
  use PharmaLiveWeb, :router

  import PharmaLiveWeb.UserAuth

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {PharmaLiveWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
    plug :fetch_current_user
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", PharmaLiveWeb do
    pipe_through :browser

    post "/auth/register", AuthController, :register
    post "/auth/login", AuthController, :login
    delete "/auth/logout", AuthController, :logout
  end

  scope "/", PharmaLiveWeb do
    pipe_through :browser

    live_session :current_user, on_mount: [{PharmaLiveWeb.UserAuth, :mount_current_user}] do
      live "/", HomeLive.Index
      live "/scrapers", ScraperLive.Index
      live "/o-nama", StaticLive, :about
      live "/kontakt", StaticLive, :contact
      live "/faq", StaticLive, :faq
      live "/privatnost", StaticLive, :privacy
      live "/prijava", AuthLive, :login
      live "/registracija", AuthLive, :register
      live "/reset-lozinke", AuthLive, :reset_password
    end
  end

  scope "/", PharmaLiveWeb do
    pipe_through :browser

    live_session :authenticated_user, on_mount: [{PharmaLiveWeb.UserAuth, :ensure_authenticated}] do
      live "/profil", AuthLive, :profile
    end
  end

  # Other scopes may use custom stacks.
  # scope "/api", PharmaLiveWeb do
  #   pipe_through :api
  # end

  # Enable LiveDashboard in development
  if Application.compile_env(:pharma_live, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: PharmaLiveWeb.Telemetry
    end
  end
end
