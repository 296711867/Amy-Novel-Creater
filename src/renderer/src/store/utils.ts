import type { NovelState } from "./novel-store";

export function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export type NovelStateSet = (
  partial: Partial<NovelState> | ((state: NovelState) => Partial<NovelState>),
) => void;
export type NovelStateGet = () => NovelState;
