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

interface ChromeTab {
  id?: number;
  windowId?: number;
  title?: string;
  url?: string;
}

interface ChromeMessageSender {
  tab?: ChromeTab;
  id?: string;
}

interface ChromeStorageArea {
  get(keys?: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  onChanged: {
    addListener(listener: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => void): void;
  };
}

// 쓰는 만큼만 선언한다(@types/chrome 미사용). 새 API를 쓰면 여기에 한 줄 늘린다.
declare const chrome: {
  storage: {
    local: ChromeStorageArea & {
      setAccessLevel(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
    };
    /** 브라우저 세션 동안만 남는 저장소. 기본 접근 레벨이 신뢰된 컨텍스트 전용이다. */
    session: ChromeStorageArea;
  };
  runtime: {
    sendMessage<T = unknown>(message: unknown): Promise<T>;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: ChromeMessageSender,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  };
  tabs: {
    query(query: { active?: boolean; currentWindow?: boolean }): Promise<ChromeTab[]>;
    sendMessage<T = unknown>(tabId: number, message: unknown): Promise<T>;
    onActivated: {
      addListener(listener: (info: { tabId: number; windowId: number }) => void): void;
    };
    onUpdated: {
      addListener(listener: (tabId: number, changeInfo: { status?: string }, tab: ChromeTab) => void): void;
    };
  };
  action: {
    onClicked: {
      addListener(listener: (tab: ChromeTab) => void): void;
    };
  };
  commands: {
    /** manifest의 commands에 등록한 브라우저 단축키. 포커스가 페이지에 있어도 여기로 온다. */
    onCommand: {
      addListener(listener: (command: string, tab?: ChromeTab) => void): void;
    };
  };
  sidePanel: {
    /** 사용자 제스처 안에서만 호출된다. windowId를 주면 그 창의 패널을 연다. */
    open(options: { windowId?: number; tabId?: number }): Promise<void>;
  };
};
