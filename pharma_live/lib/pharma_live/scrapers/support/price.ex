defmodule PharmaLive.Scrapers.Support.Price do
  @moduledoc false

  def parse_cents(nil), do: nil

  def parse_cents(value) when is_binary(value) do
    value
    |> String.replace(~r/[^\d,\.]/u, "")
    |> normalize_decimal()
    |> case do
      "" -> nil
      normalized ->
        case Float.parse(normalized) do
          {amount, _} -> trunc(amount * 100)
          :error -> nil
        end
    end
  end

  defp normalize_decimal(raw) do
    dot_count = raw |> String.graphemes() |> Enum.count(&(&1 == "."))
    comma_count = raw |> String.graphemes() |> Enum.count(&(&1 == ","))

    cond do
      comma_count >= 1 and dot_count >= 1 and Regex.match?(~r/.*\..*,.*/, raw) ->
        raw |> String.replace(".", "") |> String.replace(",", ".")

      comma_count == 1 and dot_count == 0 ->
        String.replace(raw, ",", ".")

      dot_count > 1 and comma_count == 0 ->
        String.replace(raw, ".", "")

      true ->
        String.replace(raw, ",", "")
    end
  end
end
