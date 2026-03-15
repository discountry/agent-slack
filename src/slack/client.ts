import { getUserAgent } from "../lib/version.ts";

export type FetchImpl = typeof globalThis.fetch;

export type SlackAuth =
  | { auth_type: "standard"; token: string }
  | { auth_type: "browser"; xoxc_token: string; xoxd_cookie: string };

const SLACK_API_BASE = "https://slack.com/api/";

export class SlackApiClient {
  private auth: SlackAuth;
  private workspaceUrl?: string;
  private fetchImpl: FetchImpl;

  constructor(auth: SlackAuth, options?: { workspaceUrl?: string; fetchImpl?: FetchImpl }) {
    this.auth = auth;
    this.workspaceUrl = options?.workspaceUrl;
    this.fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  }

  async api(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (this.auth.auth_type === "standard") {
      return this.standardApi(method, params);
    }

    if (!this.workspaceUrl) {
      throw new Error(
        "Browser auth requires workspace URL. Provide --workspace-url or set SLACK_WORKSPACE_URL, or call via a Slack message URL.",
      );
    }
    const { auth } = this;
    if (auth.auth_type !== "browser") {
      throw new Error("Browser API requires browser auth");
    }
    return this.browserApi({
      workspaceUrl: this.workspaceUrl,
      auth,
      method,
      params,
    });
  }

  /**
   * Calls the Slack Web API using a standard bot/user token (xoxb-/xoxp-).
   * Uses the injected fetchImpl instead of @slack/web-api's axios-based WebClient.
   */
  private async standardApi(
    method: string,
    params: Record<string, unknown>,
    attempt = 0,
  ): Promise<Record<string, unknown>> {
    const { auth } = this;
    if (auth.auth_type !== "standard") {
      throw new Error("Standard API requires standard auth");
    }

    const url = `${SLACK_API_BASE}${method}`;
    const cleanedEntries = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]);
    const formBody = new URLSearchParams(Object.fromEntries(cleanedEntries));

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": getUserAgent(),
      },
      body: formBody,
    });

    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After") ?? "5");
      const delayMs = Math.min(Math.max(retryAfter, 1) * 1000, 30000);
      await new Promise((r) => setTimeout(r, delayMs));
      return this.standardApi(method, params, attempt + 1);
    }

    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Slack HTTP ${response.status} calling ${method}`);
    }
    if (!isRecord(data) || data.ok !== true) {
      const error = isRecord(data) && typeof data.error === "string" ? data.error : null;
      throw new Error(error || `Slack API error calling ${method}`);
    }
    return data;
  }

  private async browserApi(input: {
    workspaceUrl: string;
    auth: Extract<SlackAuth, { auth_type: "browser" }>;
    method: string;
    params: Record<string, unknown>;
    attempt?: number;
  }): Promise<Record<string, unknown>> {
    const attempt = input.attempt ?? 0;
    const url = `${input.workspaceUrl.replace(/\/$/, "")}/api/${input.method}`;
    const cleanedEntries = Object.entries(input.params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]);
    const formBody = new URLSearchParams({
      token: input.auth.xoxc_token,
      ...Object.fromEntries(cleanedEntries),
    });
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Cookie: `d=${encodeURIComponent(input.auth.xoxd_cookie)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://app.slack.com",
        "User-Agent": getUserAgent(),
      },
      body: formBody,
    });

    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After") ?? "5");
      const delayMs = Math.min(Math.max(retryAfter, 1) * 1000, 30000);
      await new Promise((r) => setTimeout(r, delayMs));
      return this.browserApi({
        ...input,
        attempt: attempt + 1,
      });
    }

    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Slack HTTP ${response.status} calling ${input.method}`);
    }
    if (!isRecord(data) || data.ok !== true) {
      const error = isRecord(data) && typeof data.error === "string" ? data.error : null;
      throw new Error(error || `Slack API error calling ${input.method}`);
    }
    return data;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
