export interface StoryVolume {
  id: string;
  novelId: string;
  position: number;
  title: string;
  outline: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryScene {
  id: string;
  chapterId: string;
  position: number;
  title: string;
  summary: string;
  viewpoint: string;
  location: string;
  targetWords: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoryStructure {
  volumes: StoryVolume[];
  scenes: StoryScene[];
}

export interface SaveVolumeInput {
  id?: string;
  novelId: string;
  title: string;
  outline: string;
}

export interface SaveSceneInput {
  id?: string;
  chapterId: string;
  title: string;
  summary: string;
  viewpoint: string;
  location: string;
  targetWords: number;
}

export function moveItem<T extends { id: string }>(
  items: T[],
  itemId: string,
  direction: -1 | 1,
): T[] {
  const index = items.findIndex((item) => item.id === itemId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
