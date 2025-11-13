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

type ContactFormStatus = "idle" | "submitting" | "success" | "error";
type ContactFormState = {
  company: string;
  phone: string;
  status: ContactFormStatus;
  error?: string | null;
  opened: boolean;
};

const createDefaultFormState = (
  o?: Partial<ContactFormState>
): ContactFormState => ({
  company: "",
  phone: "",
  status: "idle",
  error: null,
  opened: false,
  ...o,
});

type ContactFormOverlayProps = {
  form: ContactFormState;
  onClose: () => void;
  onChange: (field: "company" | "phone", value: string) => void;
  onSubmit: () => void;
};

/** Contact overlay UI (used for manual submissions & post-tool success) */
function ContactFormOverlay({
  form,
  onClose,
  onChange,
  onSubmit,
}: ContactFormOverlayProps) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0F172A]/40 px-3 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-full text-[#94A3B8] transition hover:bg-[#F1F5F9] hover:text-[#2F806E]"
          aria-label="Close contact form"
        >
          <span className="sr-only">Close</span>✕
        </button>

        {form.status === "success" ? (
          <div className="flex flex-col gap-4 pt-1">
            <div className="rounded-2xl bg-[#F6FFFC] p-4 text-[#185A4C]">
              <h3 className="text-base font-semibold">Thanks!</h3>
              <p className="mt-1 text-sm text-[#256B5A]">
                We will reach out within one business day.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex justify-center rounded-full bg-[#2F806E] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pt-2">
            <div>
              <h3 className="text-lg font-semibold text-[#0F172A]">
                Let us stay in touch
              </h3>
              <p className="text-sm text-[#4B5563]">
                Share your details and we will call you back.
              </p>
            </div>

            <div className="grid gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-[#256B5A]">
                Company name
                <input
                  type="text"
                  value={form.company}
                  onChange={(e) => onChange("company", e.target.value)}
                  placeholder="e.g. AnyID BV"
                  className="rounded-lg border border-[#CBE5DE] bg-white px-3 py-2 text-sm text-[#1F2937] outline-none transition focus:border-[#3C8D72] focus:ring-2 focus:ring-[#9FDAE0]/50"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium text-[#256B5A]">
                Phone number
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => onChange("phone", e.target.value)}
                  placeholder="+31 6 12345678"
                  className="rounded-lg border border-[#CBE5DE] bg-white px-3 py-2 text-sm text-[#1F2937] outline-none transition focus:border-[#3C8D72] focus:ring-2 focus:ring-[#9FDAE0]/50"
                />
              </label>
            </div>

            {form.error && (
              <p className="text-xs text-[#DC2626]">{form.error}</p>
            )}
            <div className="mt-1 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-full bg-transparent px-4 py-2 text-xs font-semibold text-[#64748B] underline-offset-2 hover:underline"
                onClick={onClose}
              >
                Maybe later
              </button>

              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-[#3C8D72] to-[#2F806E] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#3C8D72]/60 disabled:opacity-50"
                disabled={
                  form.status === "submitting" ||
                  !(form.company.trim() && form.phone.trim())
                }
                onClick={onSubmit}
              >
                {form.status === "submitting" ? "Sending..." : "Submit"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Media helper */
type YouTubeVideo = { url: string; embedUrl: string; title: string };

function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes("youtu.be")) {
      const id = parsed.pathname.replace(/^\//, "");
      return id ? id.split("/")[0] : null;
    }
    if (host.includes("youtube.com")) {
      if (parsed.pathname.startsWith("/watch"))
        return parsed.searchParams.get("v");
      if (parsed.pathname.startsWith("/embed/"))
        return parsed.pathname.split("/")[2] ?? null;
      if (parsed.pathname.startsWith("/shorts/"))
        return parsed.pathname.split("/")[2] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Make sure the web component can actually fill height */
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

type ChatKitPanelProps = {
  theme: ColorScheme;
  onResponseEnd: () => void;
  onThemeRequest: (scheme: ColorScheme) => void; // still in the type, but unused here
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

  // Contact form (for manual use + success confirmation)
  const [form, setForm] = useState<ContactFormState>(() =>
    createDefaultFormState()
  );
  const [showFormOverlay, setShowFormOverlay] = useState(false);
  const [showPassiveFormButton, setShowPassiveFormButton] = useState(false);

  // Media docks
  const [videoDock, setVideoDock] = useState<YouTubeVideo[]>([]);
  const [imageDock, setImageDock] = useState<string[]>([]);

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
    setVideoDock([]);
    setImageDock([]);
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
              file_upload: { enabled: true },
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

  const openForm = useCallback((active: boolean) => {
    setShowPassiveFormButton(!active);
    setShowFormOverlay(active);
    setForm((f) => ({ ...f, opened: true }));
  }, []);

  const handleResponseEnd = useCallback(() => {
    onResponseEnd();
  }, [onResponseEnd]);

  /** Manual form submit (for the button-driven overlay) */
  const submitContactForm = useCallback(async () => {
    const digitsOnly = form.phone.replace(/\D/g, "");
    const looksValid =
      /^\+?[0-9 ()-]{6,20}$/.test(form.phone) && digitsOnly.length >= 8;
    if (!form.company.trim() || !form.phone.trim() || !looksValid) {
      setForm((prev) => ({
        ...prev,
        status: "idle",
        error:
          !form.company.trim() || !form.phone.trim()
            ? "Add both company name and phone number so we can reach out."
            : "Enter a valid phone number.",
      }));
      return;
    }

    setForm((f) => ({ ...f, status: "submitting", error: null }));
    try {
      await fetch(
        "https://anyid.app.n8n.cloud/webhook/agent-contact-submission",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company: form.company, phone: form.phone }),
        }
      );
      setForm((f) => ({ ...f, status: "success" }));
    } catch (e) {
      setForm((f) => ({
        ...f,
        status: "error",
        error:
          e instanceof Error
            ? e.message
            : "We couldn't submit right now. Please try again.",
      }));
    }
  }, [form.company, form.phone]);

  const chatkit = useChatKit({
    api: { getClientSecret },
    theme: { colorScheme: theme, ...getThemeConfig(theme) },
    startScreen: {
      greeting: GREETING,
      prompts: STARTER_PROMPTS,
    },
    composer: {
      placeholder: PLACEHOLDER_INPUT,
      attachments: { enabled: true },
    },
    threadItemActions: { feedback: false },

    // 🔧 Client tools invoked by the agent
    onClientTool: async (toolCall: {
      name: string;
      params: Record<string, unknown>;
    }) => {
      console.log("[ClientTool invoked]", toolCall);

      switch (toolCall.name) {
        case "submit_contact_form": {
          const { name, email, subject, message, phone } = toolCall.params as {
            name: string;
            email: string;
            subject: string;
            message: string;
            phone: string;
          };

          await fetch(
            "https://anyid.app.n8n.cloud/webhook/agent-contact-submission",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, email, subject, message, phone }),
            }
          );

          // Show "success" overlay
          setForm((f) => ({
            ...f,
            status: "success",
            opened: true,
          }));
          setShowFormOverlay(true);

          return {};
        }

        case "view_image": {
          const { image_url } = toolCall.params as {
            image_url: string;
            caption?: string;
            fit_mode?: "fit" | "fill" | "stretch" | "original";
          };

          setImageDock((prev) => {
            const set = new Set(prev);
            set.add(image_url);
            return Array.from(set);
          });

          return {};
        }

        case "view_video": {
          const { youtube_url } = toolCall.params as {
            youtube_url: string;
            width?: number;
            height?: number;
            allow_fullscreen?: boolean;
          };

          const id = extractYouTubeId(youtube_url);
          if (!id) return {};

          const embedUrl = `https://www.youtube.com/embed/${id}`;

          setVideoDock((prev) => {
            const already = prev.some((v) => v.embedUrl === embedUrl);
            if (already) return prev;
            return [...prev, { url: youtube_url, embedUrl, title: "Video" }];
          });

          return {};
        }

        default:
          return {};
      }
    },

    onResponseStart: () =>
      setErrorState({ integration: null, retryable: false }),
    onResponseEnd: handleResponseEnd,
    onThreadChange: () => {
      // Reset media between threads
      setVideoDock([]);
      setImageDock([]);
    },
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

              {/* Image dock */}
              {imageDock.length > 0 && (
                <div className="mt-2 px-2 pb-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {imageDock.map((src) => (
                      <div
                        key={src}
                        className="overflow-hidden rounded-2xl border border-white/70 bg-white shadow"
                      >
                        <img
                          src={src}
                          alt="Image"
                          className="w-full h-auto block"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Video dock */}
              {videoDock.length > 0 && (
                <div className="mt-2 px-2 pb-2">
                  <div className="flex flex-col gap-3">
                    {videoDock.map((video) => (
                      <div
                        key={video.url}
                        className="overflow-hidden rounded-2xl border border-white/70 bg-black shadow"
                      >
                        <div className="relative w-full pt-[56.25%]">
                          <iframe
                            src={`${video.embedUrl}?rel=0`}
                            title={video.title}
                            className="absolute inset-0 h-full w-full"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                            allowFullScreen
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Passive contact button + hint (manual, optional) */}
          <div className="mt-auto flex flex-col gap-2">
            {showPassiveFormButton && !showFormOverlay && (
              <div className="flex w-full justify-center">
                <button
                  onClick={() => openForm(true)}
                  className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-[#2F806E] shadow ring-1 ring-[#2F806E]/30 transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  Open contact form
                </button>
              </div>
            )}
            <p className="px-1 text-center text-xs text-[#94A3B8]">
              Type in the box and press Enter to send
            </p>
          </div>
        </div>

        {/* Contact overlay (manual + post-tool success) */}
        {showFormOverlay && (
          <ContactFormOverlay
            form={form}
            onClose={() => setShowFormOverlay(false)}
            onChange={(field, value) =>
              setForm((f) => ({ ...f, [field]: value, error: null }))
            }
            onSubmit={submitContactForm}
          />
        )}

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
