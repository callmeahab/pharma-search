defmodule PharmaLiveWeb.PageController do
  use PharmaLiveWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
