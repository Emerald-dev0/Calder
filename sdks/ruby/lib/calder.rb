# frozen_string_literal: true

# Official Calder Ruby SDK — transactional email, durable delivery,
# idempotent sends. Stdlib-only: net/http json securerandom.
#
#   require_relative "calder"
#   calder = Calder::Client.new # reads ENV["CALDER_API_KEY"]
#   result = calder.emails.send(
#     from: "app@yourdomain.com",
#     to: "customer@example.com",
#     subject: "Your receipt",
#     text: "Thanks!",
#   )
#   result["id"] # => "em_…"
#
# Retry contract (parity with the Node/Python SDKs): 5xx, 429 and network
# errors retry once with jittered backoff; 4xx never retries. Sends are
# idempotent by default — a UUID is generated per call unless you pass
# idempotency_key: to bind retries to your business entity.

require "json"
require "net/http"
require "securerandom"

module Calder
  DEFAULT_BASE_URL = "https://api.calder.click"
  MAX_ATTEMPTS = 2

  class Error < StandardError
    attr_reader :status, :body

    def initialize(message, status, body = nil)
      super(message)
      @status = status
      @body = body
    end
  end

  # 401/403 — bad key or missing scope. Never retried.
  class AuthError < Error
    def initialize(message, body = nil) = super(message, 401, body)
  end

  # 429 — rate limit or quota, exposes retry_after_seconds when sent.
  class RateLimitError < Error
    attr_reader :retry_after_seconds

    def initialize(message, retry_after_seconds = nil, body = nil)
      super(message, 429, body)
      @retry_after_seconds = retry_after_seconds
    end
  end

  # 4xx other than 401/429 — the request itself is wrong. Never retried.
  class RequestError < Error; end

  class Client
    attr_reader :emails

    def initialize(api_key: nil, base_url: DEFAULT_BASE_URL, timeout_seconds: 10.0)
      @api_key = api_key || ENV["CALDER_API_KEY"]
      raise ArgumentError, "Calder SDK: no API key. Pass api_key: or set CALDER_API_KEY." if @api_key.to_s.empty?

      @base_url = base_url.sub(%r{/\z}, "")
      @timeout = timeout_seconds
      @emails = EmailsResource.new(self)
    end

    # Internal transport — reties per the module-level contract.
    def request(method, path, body: nil, query: nil, idempotency_key: nil)
      last_error = nil
      1.upto(MAX_ATTEMPTS) do |attempt|
        begin
          uri = URI("#{@base_url}#{path}")
          uri.query = URI.encode_www_form(query.compact) if query && !query.empty?
          http = Net::HTTP.new(uri.host, uri.port)
          http.use_ssl = uri.scheme == "https"
          http.open_timeout = @timeout
          http.read_timeout = @timeout

          klass = { get: Net::HTTP::Get, post: Net::HTTP::Post }.fetch(method)
          req = klass.new(uri)
          req["authorization"] = "Bearer #{@api_key}"
          req["content-type"] = "application/json"
          req["idempotency-key"] = idempotency_key if idempotency_key
          req.body = JSON.generate(body) if body

          res = http.request(req)
          parsed = res.body.to_s.empty? ? nil : (JSON.parse(res.body) rescue res.body)

          return parsed if res.is_a?(Net::HTTPSuccess)

          status = res.code.to_i
          err = parsed.is_a?(Hash) ? parsed["error"] : nil
          message =
            if err.is_a?(Hash) && err["message"].is_a?(String)
              err["message"] # public API shape { error: { code, message } }
            elsif err.is_a?(String) && !err.empty?
              err            # legacy flat-string shape
            else
              "Calder API error #{status}"
            end
          raise AuthError, message if [401, 403].include?(status)
          if status == 429
            ra = res["retry-after"]&.to_f
            raise RateLimitError.new(message, ra, parsed)
          end
          if status >= 500
            last_error = Error.new(message, status, parsed)
            raise last_error
          end
          raise RequestError.new(message, status, parsed)
        rescue AuthError, RateLimitError, RequestError
          raise
        rescue Error => e
          last_error = e # 5xx path: retry once
          sleep(backoff_seconds(attempt)) if attempt < MAX_ATTEMPTS
        rescue StandardError => e
          last_error = e # network failure: retry once
          sleep(backoff_seconds(attempt)) if attempt < MAX_ATTEMPTS
        end
      end
      raise last_error
    end

    private

    def backoff_seconds(attempt)
      0.25 * attempt + (rand * 0.25)
    end
  end

  class EmailsResource
    def initialize(client) = (@client = client)

    # Send one transactional email. Idempotent by default.
    def send(from:, to:, subject:, text: nil, html: nil, cc: nil, bcc: nil,
             reply_to: nil, headers: nil, metadata: nil, idempotency_key: nil)
      raise RequestError.new("send() requires from, to and subject.", 400) if from.to_s.empty? || to.to_s.empty? || subject.to_s.empty?

      unless text || html
        raise RequestError.new("send() requires text or html content.", 400)
      end

      body = { from:, to:, subject: }
      body[:text] = text if text
      body[:html] = html if html
      body[:cc] = cc if cc
      body[:bcc] = bcc if bcc
      body[:replyTo] = reply_to if reply_to
      body[:headers] = headers if headers
      body[:metadata] = metadata if metadata
      @client.request(:post, "/v1/emails", body:, idempotency_key: idempotency_key || SecureRandom.uuid)
    end

    def get(id)
      @client.request(:get, "/v1/emails/#{URI.encode_www_form_component(id)}")
    end

    def list(limit: nil, cursor: nil, status: nil)
      query = { limit:, cursor:, status: }.compact.transform_values(&:to_s)
      @client.request(:get, "/v1/emails", query:)
    end
  end
end
