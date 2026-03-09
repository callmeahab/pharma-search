defmodule PharmaLive.Scrapers.Product do
  @enforce_keys [:title]
  defstruct [:external_id, :title, :url, :price_cents, currency: "RSD", in_stock: true, raw_payload: %{}]

  @type t :: %__MODULE__{
          external_id: String.t() | nil,
          title: String.t(),
          url: String.t() | nil,
          price_cents: integer() | nil,
          currency: String.t(),
          in_stock: boolean(),
          raw_payload: map()
        }
end
