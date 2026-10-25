// Typed client for the FastAPI backend (proxied through /api on the same origin).

export type Stage = "new" | "contacted" | "replied" | "meeting" | "won" | "lost";
export type Tier = "hot" | "warm" | "cold";
export type EmailStatus = "valid" | "risky" | "invalid";

export const STAGES: { value: Stage; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "replied", label: "Replied" },
  { value: "meeting", label: "Meeting" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export interface EmailCheck {
  email: string;
  status: EmailStatus;
  reason: string;
  is_role: boolean;
  is_free: boolean;
  source: string;
}

export interface ScoreFactor {
  key: string;
  label: string;
  points: number;
  max: number;
  reason: string;
  sentiment: "positive" | "neutral" | "negative";
}

export interface LeadListItem {
  id: number;
  company_name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  employee_count: number | null;
  revenue_usd: number | null;
  founded_year: number | null;
  owner_name: string | null;
  best_email: string | null;
  email_status: EmailStatus | null;
  phone: string | null;
  score: number;
  score_tier: Tier;
  top_reason: string | null;
  stage: Stage;
  enrichment_status: string;
  tags: string[];
  follow_up_at: string | null;
  follow_up_due: boolean;
  created_at: string;
}

export interface Lead extends Omit<LeadListItem, "best_email" | "email_status" | "top_reason"> {
  description: string | null;
  country: string | null;
  owner_title: string | null;
  linkedin_url: string | null;
  emails: EmailCheck[];
  phones: string[];
  socials: Record<string, string>;
  tech_stack: string[];
  signals: Record<string, unknown>;
  enrichment_error: string | null;
  enriched_at: string | null;
  score_breakdown: ScoreFactor[];
  notes: string | null;
  source: string;
  last_contacted_at: string | null;
  next_action: string;
  updated_at: string;
}

export interface LeadPage {
  items: LeadListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface Stats {
  total: number;
  enriched: number;
  with_email: number;
  avg_score: number;
  by_tier: Record<Tier, number>;
  by_stage: Record<Stage, number>;
  by_industry: { industry: string; count: number; avg_score: number }[];
  score_distribution: { bucket: string; count: number }[];
  top_leads: { id: number; company_name: string; industry: string | null; state: string | null; score: number; score_tier: Tier; stage: Stage }[];
}

export interface ICP {
  id: number;
  name: string;
  mode: "acquisition" | "sales";
  target_industries: string[];
  target_states: string[];
  min_employees: number | null;
  max_employees: number | null;
  min_revenue: number | null;
  max_revenue: number | null;
  min_years_in_business: number | null;
  weights: Record<string, number>;
  updated_at: string;
}

export interface Job {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  total: number;
  completed: number;
  failed: number;
  errors: { lead_id: number; error: string }[];
  created_at: string;
  finished_at: string | null;
}

export interface OutreachDraft {
  id: number;
  lead_id: number;
  goal: string;
  tone: string;
  subject: string;
  email_body: string;
  linkedin_note: string;
  call_opener: string;
  follow_up: string;
  personalization_points: string[];
  generator: string;
  created_at: string;
}

export interface Activity {
  id: number;
  kind: "created" | "enriched" | "enrichment_failed" | "stage" | "score" | "outreach" | "note" | "follow_up" | "edited";
  message: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface ActionCard {
  id: number;
  company_name: string;
  industry: string | null;
  state: string | null;
  score: number;
  score_tier: Tier;
  stage: Stage;
  owner_name: string | null;
  follow_up_at: string | null;
  days_overdue: number;
}

export interface Actions {
  follow_ups_due: ActionCard[];
  upcoming: ActionCard[];
  hot_untouched: ActionCard[];
}

export interface ImportResult {
  created: number;
  merged: number;
  skipped: number;
  errors: string[];
  columns_mapped: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0] as { msg?: string; loc?: (string | number)[] };
      const field = first.loc?.filter((p) => p !== "body").join(".");
      return field ? `${field}: ${first.msg}` : (first.msg ?? "Invalid input");
    }
  }
  return status >= 500 ? "Server error - please try again" : `Request failed (${status})`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: isForm ? init?.headers : { "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new ApiError(errorMessage(body, res.status), res.status);
  return body as T;
}

export const fetcher = <T,>(path: string) => api<T>(path);

export function qs(params: Record<string, string | number | boolean | string[] | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const leadsApi = {
  create: (body: Record<string, unknown>) => api<Lead>("/leads", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: Partial<Omit<Lead, "follow_up_at">> & { follow_up_at?: string | null }) => api<Lead>(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: number) => api<void>(`/leads/${id}`, { method: "DELETE" }),
  enrich: (id: number) => api<Lead>(`/leads/${id}/enrich`, { method: "POST" }),
  bulkEnrich: (ids: number[], force = false) =>
    api<Job>("/leads/enrich", { method: "POST", body: JSON.stringify({ ids, force }) }),
  job: (id: string) => api<Job>(`/leads/jobs/${id}`),
  bulkStage: (ids: number[], stage: Stage) =>
    api<{ updated: number }>("/leads/bulk/stage", { method: "POST", body: JSON.stringify({ ids, stage }) }),
  bulkDelete: (ids: number[]) =>
    api<{ deleted: number }>("/leads/bulk/delete", { method: "POST", body: JSON.stringify({ ids }) }),
  importCsv: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api<ImportResult>("/leads/import", { method: "POST", body: fd });
  },
  dedupe: () => api<{ groups_merged: number; records_removed: number }>("/leads/dedupe", { method: "POST" }),
  outreach: (id: number, body: { goal: string; tone: string; sender_context?: string }) =>
    api<OutreachDraft>(`/leads/${id}/outreach`, { method: "POST", body: JSON.stringify(body) }),
};

export const icpApi = {
  save: (body: Omit<ICP, "id" | "updated_at">) => api<ICP>("/icp", { method: "PUT", body: JSON.stringify(body) }),
};

/** SWR key matcher for everything derived from leads (lists, stats, action center, timelines). */
export const isLeadDataKey = (key: unknown): boolean =>
  typeof key === "string" && (key.startsWith("/leads") || key === "/stats");

export interface LeadFilters {
  tiers: Tier[];
  stages: Stage[];
  industries: string[];
  states: string[];
  min_score: number;
  has_email: boolean;
  follow_up_due: boolean;
  keywords: string;
  sort: string;
}

export interface AISearchResult {
  filters: LeadFilters;
  explanation: string;
  generator: string;
}

export interface PipelineBrief {
  headline: string;
  insights: { title: string; detail: string; lead_id: number }[];
  focus_today: string;
  generator: string;
}

export const aiApi = {
  search: (query: string) => api<AISearchResult>("/ai/search", { method: "POST", body: JSON.stringify({ query }) }),
  brief: () => api<PipelineBrief>("/ai/brief", { method: "POST" }),
};

/** Leads-page URL for a set of AI filters; the leads view reads these params as its initial state. */
export function leadsUrlForFilters(f: LeadFilters, query: string, explanation: string): string {
  return `/leads${qs({
    tier: f.tiers,
    stage: f.stages,
    industry: f.industries,
    state: f.states,
    min_score: f.min_score || undefined,
    has_email: f.has_email || undefined,
    follow_up_due: f.follow_up_due || undefined,
    q: f.keywords || undefined,
    sort: f.sort !== "-score" ? f.sort : undefined,
    ai: query,
    why: explanation,
  })}`;
}
