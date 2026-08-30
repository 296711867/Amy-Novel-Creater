export type ForeshadowStatus =
  "planned" | "planted" | "developing" | "resolved" | "abandoned";
export type CanonSource = "manual" | "accepted_chapter" | "ai_candidate";

export interface TimelineEvent {
  id: string;
  novelId: string;
  chapterId: string | null;
  storyTime: string;
  title: string;
  detail: string;
  participantIds: string[];
  source: CanonSource;
  createdAt: string;
  updatedAt: string;
}

export interface ForeshadowThread {
  id: string;
  novelId: string;
  title: string;
  detail: string;
  setupChapterId: string | null;
  payoffChapterId: string | null;
  status: ForeshadowStatus;
  source: CanonSource;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterState {
  id: string;
  novelId: string;
  characterId: string;
  chapterId: string | null;
  summary: string;
  location: string;
  physical: string;
  emotional: string;
  knowledge: string[];
  goals: string[];
  inventory: string[];
  source: CanonSource;
  createdAt: string;
  updatedAt: string;
}

export type SaveTimelineEventInput = Omit<
  TimelineEvent,
  "id" | "createdAt" | "updatedAt" | "source"
> & { id?: string; source?: CanonSource };
export type SaveForeshadowInput = Omit<
  ForeshadowThread,
  "id" | "createdAt" | "updatedAt" | "source"
> & { id?: string; source?: CanonSource };
export type SaveCharacterStateInput = Omit<
  CharacterState,
  "id" | "createdAt" | "updatedAt" | "source"
> & { id?: string; source?: CanonSource };

export const FORESHADOW_STATUS_LABELS: Record<ForeshadowStatus, string> = {
  planned: "待埋设",
  planted: "已埋设",
  developing: "发展中",
  resolved: "已回收",
  abandoned: "已放弃",
};

export function normalizeStateList(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}
export function canMoveForeshadow(
  from: ForeshadowStatus,
  to: ForeshadowStatus,
): boolean {
  if (from === to) return true;
  const allowed: Record<ForeshadowStatus, ForeshadowStatus[]> = {
    planned: ["planted", "abandoned"],
    planted: ["developing", "resolved", "abandoned"],
    developing: ["resolved", "abandoned"],
    resolved: [],
    abandoned: ["planned"],
  };
  return allowed[from].includes(to);
}
