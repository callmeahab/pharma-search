defmodule PharmaLive.Accounts.Password do
  @moduledoc false

  @iterations 100_000
  @key_length 32
  @digest :sha256
  @salt_length 16

  def hash(password) when is_binary(password) do
    salt = :crypto.strong_rand_bytes(@salt_length)
    digest = :crypto.pbkdf2_hmac(@digest, password, salt, @iterations, @key_length)
    "pbkdf2$#{@iterations}$#{Base.encode64(salt)}$#{Base.encode64(digest)}"
  end

  def verify(password, encoded) when is_binary(password) and is_binary(encoded) do
    with ["pbkdf2", iter, salt64, digest64] <- String.split(encoded, "$"),
         {iterations, ""} <- Integer.parse(iter),
         {:ok, salt} <- Base.decode64(salt64),
         {:ok, stored_digest} <- Base.decode64(digest64) do
      computed = :crypto.pbkdf2_hmac(@digest, password, salt, iterations, byte_size(stored_digest))
      secure_compare(computed, stored_digest)
    else
      _ -> false
    end
  end

  def verify(_, _), do: false

  defp secure_compare(a, b) when byte_size(a) == byte_size(b) do
    Plug.Crypto.secure_compare(a, b)
  end

  defp secure_compare(_, _), do: false
end
