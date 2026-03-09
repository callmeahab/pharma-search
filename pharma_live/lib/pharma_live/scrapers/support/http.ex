defmodule PharmaLive.Scrapers.Support.Http do
  @moduledoc false

  def fetch_html(url, opts \\ []) do
    retries = Keyword.get(opts, :retries, 2)
    timeout = Keyword.get(opts, :receive_timeout, 20_000)

    do_fetch_html(url, retries, timeout)
  end

  defp do_fetch_html(_url, retries, _timeout) when retries < 0, do: {:error, :retries_exhausted}

  defp do_fetch_html(url, retries, timeout) do
    case Req.get(url, receive_timeout: timeout) do
      {:ok, %{status: code, body: body}} when code in 200..299 ->
        Floki.parse_document(body)

      {:ok, %{status: _code}} when retries > 0 ->
        Process.sleep(1_000)
        do_fetch_html(url, retries - 1, timeout)

      {:ok, %{status: code}} ->
        {:error, {:http_error, code}}

      {:error, _reason} when retries > 0 ->
        Process.sleep(1_000)
        do_fetch_html(url, retries - 1, timeout)

      {:error, reason} ->
        {:error, reason}
    end
  end

  def absolute_url(nil, _base), do: nil

  def absolute_url(url, base) when is_binary(url) and is_binary(base) do
    if String.starts_with?(url, "http://") or String.starts_with?(url, "https://") do
      url
    else
      URI.merge(base, url) |> to_string()
    end
  rescue
    _ -> url
  end

  def text(node, selector) do
    node
    |> Floki.find(selector)
    |> Floki.text()
    |> String.trim()
  end

  def attr(node, selector, attribute) do
    node
    |> Floki.find(selector)
    |> Floki.attribute(attribute)
    |> List.first()
  end
end
