"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";

import {
  STARTER_PROMPTS,
  PLACEHOLDER_INPUT,
  GREETING,
  CREATE_SESSION_ENDPOINT,
  WORKFLOW_ID,
  getThemeConfig,
} from "@/lib/config";
import { ErrorOverlay } from "./ErrorOverlay";
import type { ColorScheme } from "@/hooks/useColorScheme";

/* ────────────────────────────────────────────────────────────────────────────
   Types & helpers
──────────────────────────────────────────────────────────────────────────── */

type ChatKitPanelProps = {
  theme: ColorScheme;
  onResponseEnd: () => void;
  onThemeRequest: (scheme: ColorScheme) => void;
};

type ErrorState = {
  script: string | null;
  session: string | null;
  integration: string | null;
  retryable: boolean;
};

const isBrowser = typeof window !== "undefined";
const isDev = process.env.NODE_ENV !== "production";

const createInitialErrors = (): ErrorState => ({
  script: null,
  session: null,
  integration: null,
  retryable: false,
});

function ensureChatKitElementStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("chatkit-expand-style")) return;
  const style = document.createElement("style");
  style.id = "chatkit-expand-style";
  style.textContent = `
    openai-chatkit {
      display: block;
      height: 100%;
      min-height: 0;
      outline: none !important;
      border: 0 !important;
      border-radius: 24px;
      overflow: hidden;
      background-clip: padding-box;
      -webkit-mask-image: -webkit-radial-gradient(white, black);
      mask-image: radial-gradient(white, black);
    }
    openai-chatkit:focus,
    openai-chatkit:focus-visible { outline: none !important; }
  `;
  document.head.appendChild(style);
}

/* ────────────────────────────────────────────────────────────────────────────
   Component
──────────────────────────────────────────────────────────────────────────── */

export function ChatKitPanel({ theme, onResponseEnd }: ChatKitPanelProps) {
  const [errors, setErrors] = useState<ErrorState>(() => createInitialErrors());
  const [isInitializingSession, setIsInitializingSession] = useState(true);
  const isMountedRef = useRef(true);
  const [scriptStatus, setScriptStatus] = useState<
    "pending" | "ready" | "error"
  >(() =>
    isBrowser && (window as any).customElements?.get("openai-chatkit")
      ? "ready"
      : "pending"
  );
  const [widgetInstanceKey, setWidgetInstanceKey] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const setErrorState = useCallback((updates: Partial<ErrorState>) => {
    setErrors((current) => ({ ...current, ...updates }));
  }, []);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    []
  );

  useEffect(() => {
    ensureChatKitElementStyles();
  }, []);

  const isWorkflowConfigured = Boolean(
    WORKFLOW_ID && !WORKFLOW_ID.startsWith("wf_replace")
  );

  useEffect(() => {
    if (!isWorkflowConfigured && isMountedRef.current) {
      setErrorState({
        session: "Set NEXT_PUBLIC_CHATKIT_WORKFLOW_ID in your .env.local file.",
        retryable: false,
      });
      setIsInitializingSession(false);
    }
  }, [isWorkflowConfigured, setErrorState]);

  const handleResetChat = useCallback(() => {
    if (isBrowser) {
      setScriptStatus(
        (window as any).customElements?.get("openai-chatkit")
          ? "ready"
          : "pending"
      );
    }
    setIsInitializingSession(true);
    setErrors(createInitialErrors());
    setWidgetInstanceKey((prev) => prev + 1);
  }, []);

  const getClientSecret = useCallback(
    async (currentSecret: string | null) => {
      if (isDev) {
        console.info("[ChatKitPanel] getClientSecret", {
          currentSecretPresent: Boolean(currentSecret),
          workflowId: WORKFLOW_ID,
          endpoint: CREATE_SESSION_ENDPOINT,
        });
      }

      if (!isWorkflowConfigured) {
        const detail =
          "Set NEXT_PUBLIC_CHATKIT_WORKFLOW_ID in your .env.local file.";
        if (isMountedRef.current) {
          setErrorState({ session: detail, retryable: false });
          setIsInitializingSession(false);
        }
        throw new Error(detail);
      }

      if (isMountedRef.current) {
        if (!currentSecret) setIsInitializingSession(true);
        setErrorState({ session: null, integration: null, retryable: false });
      }

      try {
        const response = await fetch(CREATE_SESSION_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflow: { id: WORKFLOW_ID },
            chatkit_configuration: {
              client_tools: { enabled: true },
            },
          }),
        });

        const raw = await response.text();

        if (isDev) {
          console.info("[ChatKitPanel] createSession response", {
            status: response.status,
            ok: response.ok,
            bodyPreview: raw.slice(0, 1600),
          });
        }

        let data: Record<string, unknown> = {};
        if (raw) {
          try {
            data = JSON.parse(raw) as Record<string, unknown>;
          } catch (parseError) {
            console.error(
              "Failed to parse create-session response",
              parseError
            );
          }
        }

        if (!response.ok) {
          const detail =
            (data as any)?.error?.message ??
            (data as any)?.details ??
            response.statusText;
          console.error("Create session request failed", {
            status: response.status,
            body: data,
          });
          throw new Error(detail);
        }

        const clientSecret = (data?.client_secret ?? "") as string;
        if (!clientSecret) throw new Error("Missing client secret in response");

        if (isMountedRef.current)
          setErrorState({ session: null, integration: null });
        return clientSecret;
      } catch (error) {
        console.error("Failed to create ChatKit session", error);
        const detail =
          error instanceof Error
            ? error.message
            : "Unable to start ChatKit session.";
        if (isMountedRef.current)
          setErrorState({ session: detail, retryable: false });
        throw error instanceof Error ? error : new Error(detail);
      } finally {
        if (isMountedRef.current && !currentSecret)
          setIsInitializingSession(false);
      }
    },
    [isWorkflowConfigured, setErrorState]
  );

  const handleResponseEnd = useCallback(() => {
    onResponseEnd();
  }, [onResponseEnd]);

  const chatkit = useChatKit({
    api: { getClientSecret },
    theme: { colorScheme: theme, ...getThemeConfig(theme) },
    startScreen: {
      greeting: GREETING,
      prompts: STARTER_PROMPTS,
    },
    composer: {
      placeholder: PLACEHOLDER_INPUT,
    },
    threadItemActions: { feedback: false },

    widgets: {
      async onAction(action, widgetItem) {
        console.log("[Widget Action]", { action, widgetItem });

        if (action.type === "contact.submit") {
          const values =
            (action.payload as Record<string, unknown> | undefined) ?? {};

          const contact = {
            business: values["contact.business"] as string | undefined,
            fullName: values["contact.fullName"] as string | undefined,
            phone: values["contact.phone"] as string | undefined,
            email: values["contact.email"] as string | undefined,
          };

          const getSessionId = () => {
            const existing = localStorage.getItem("faqSession");
            if (existing) return existing;
            const created = crypto.randomUUID();
            localStorage.setItem("faqSession", created);
            return created;
          };

          const sessionId = getSessionId();
          console.log("[ContactForm] Submitting contact form", {
            sessionId,
            contact,
          });

          await fetch(
            "https://anyid.app.n8n.cloud/webhook-test/agent-contact-submission",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId,
                action: "contactForm",
                contact,
              }),
            }
          );

          return;
        }

        if (action.type === "contact.cancel") {
          return;
        }
      },
    },

    onClientTool: async (toolCall: {
      name: string;
      params: Record<string, unknown>;
    }) => {
      console.log("[ClientTool invoked]", toolCall);
      return {};
    },

    onResponseStart: () =>
      setErrorState({ integration: null, retryable: false }),
    onResponseEnd: handleResponseEnd,
    onThreadChange: () => {},
    onError: ({ error }: { error: unknown }) => {
      console.error("ChatKit error", error);
    },
  });

  const activeError = errors.session ?? errors.integration;
  const blockingError = errors.script ?? activeError;

  const outerStyles = useMemo(
    () => ({
      background:
        "radial-gradient(1200px 600px at 75% -200px, rgba(47,128,110,0.18), transparent 60%), radial-gradient(900px 500px at -150px 60%, rgba(84,171,154,0.18), transparent 60%), linear-gradient(180deg, #EEF3FF 0%, #F5F9FF 35%, #F0FFF8 100%)",
    }),
    []
  );

  return (
    <div
      ref={containerRef}
      className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen flex h-[100dvh] overflow-hidden"
      style={outerStyles}
    >
      <div
        className="pointer-events-none absolute inset-0 mix-blend-multiply"
        aria-hidden
      />

      <div className="relative z-10 mx-auto flex h-full w-full max-w-5xl flex-1 flex-col px-4 sm:px-6 pb-3 pt-2">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/60 bg-white/60 p-3 backdrop-blur">
          <div className="px-1">
            <p className="text-base font-semibold text-[#0F172A]">Andy</p>
            <p className="text-xs text-[#64748B]">
              Quick, friendly answers about AnyID.
            </p>
          </div>
          <span className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-xs font-medium text-[#2F806E] shadow">
            Beta
          </span>
        </div>

        {/* Chat card */}
        <div className="mt-4 flex flex-1 flex-col gap-4 ">
          <div className="flex-1 rounded-[28px] bg-white/60 p-1 backdrop-blur shadow-xl ring-1 ring-white/50 ">
            <div className="relative flex h-full flex-1 flex-col rounded-[24px] bg-white/90">
              <div className="flex-1 min-h-[70vh] ">
                <ChatKit
                  key={widgetInstanceKey}
                  control={chatkit.control}
                  className={
                    blockingError || isInitializingSession
                      ? "pointer-events-none opacity-0"
                      : "h-full w-full rounded-[24px] focus:outline-none"
                  }
                  style={{
                    display: "block",
                    minHeight: "70vh",
                    height: "100%",
                    width: "100%",
                    borderRadius: "24px",
                    outline: "none",
                  }}
                />
              </div>
            </div>
          </div>

          <div className="mt-auto flex flex-col gap-2">
            <p className="px-1 text-center text-xs text-[#94A3B8]">
              Type in the box and press Enter to send
            </p>
          </div>
        </div>

        {(blockingError || isInitializingSession) && (
          <ErrorOverlay
            error={
              errors.script ?? errors.session ?? errors.integration ?? null
            }
            fallbackMessage={
              blockingError || !isInitializingSession
                ? null
                : "Loading assistant session..."
            }
            onRetry={blockingError && errors.retryable ? handleResetChat : null}
            retryLabel="Restart chat"
          />
        )}
      </div>
    </div>
  );
}
