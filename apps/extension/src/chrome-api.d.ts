interface WebGilStoredProviderConfig {
  provider: "openai" | "gemini" | "anthropic";
  apiKey: string;
  model: string;
}

interface WebGilStoredTTSConfig {
  provider: "elevenlabs";
  apiKey: string;
  voiceId: string;
  model: "eleven_multilingual_v2";
}

interface ChromeRuntimeMessageResponse {
  ok: boolean;
  value?: unknown;
  error?: string;
}

declare const chrome: {
  storage: {
    local: {
      get(keys?: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      setAccessLevel(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
    };
  };
  runtime: {
    sendMessage<T = unknown>(message: unknown): Promise<T>;
    onMessage: {
      addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void): void;
    };
  };
};
