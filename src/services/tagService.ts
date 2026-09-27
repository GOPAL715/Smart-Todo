import { supabase } from "@/services/supabase";
import { chunkIds, DEFAULT_BATCH_SIZE } from "@/utils/batching";
import { getServiceErrorMessage } from "@/utils/serviceErrors";
import type { Tag } from "@/types";

export async function getTags(): Promise<Tag[]> {
  const { data, error } = await supabase.from("tags").select("*").order("name", { ascending: true });
  if (error) throw new Error(getServiceErrorMessage(error));
  return (data ?? []) as Tag[];
}

export async function createTag(name: string): Promise<Tag> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Tag name cannot be empty");
  }
  const { data, error } = await supabase.from("tags").insert({ name: trimmed }).select("*").single();
  if (error) {
    // 23505 = unique_violation on the personal (user_id, name) index.
    if (error.code === "23505") {
      throw new Error("You already have a tag with that name");
    }
    throw new Error(getServiceErrorMessage(error));
  }
  return data as Tag;
}

/**
 * Returns the tags attached to a task. Supabase may embed the to-one `tags`
 * relation as either an object or a one-element array depending on inferred
 * schema types, so both shapes are normalised here.
 */
export async function getTaskTags(taskId: string): Promise<Tag[]> {
  const { data, error } = await supabase
    .from("task_tags")
    .select("tag_id, tags(name, id, user_id, created_at)")
    .eq("task_id", taskId);
  if (error) throw new Error(getServiceErrorMessage(error));
  const rows = (data ?? []) as { tag_id: string; tags: unknown }[];
  const tags: Tag[] = [];
  for (const row of rows) {
    const embedded = row.tags;
    const tag = (Array.isArray(embedded) ? embedded[0] : embedded) as Tag | null;
    if (tag) tags.push(tag);
  }
  return tags;
}

/**
 * Maximum number of task ids sent in a single `task_tags` `.in()` lookup.
 *
 * Re-exported from `@/utils/batching` so task and tag lookups share one
 * bounding rule. For the common case (well under 200 visible tasks) this is
 * still exactly one request, so there is no extra round trip in practice.
 */
export const TAG_MAP_BATCH_SIZE = DEFAULT_BATCH_SIZE;

export { chunkIds };

/**
 * Maps `task_id -> tags` for a **single** bounded batch of tasks, in one request.
 *
 * The caller is responsible for keeping each batch within
 * `TAG_MAP_BATCH_SIZE`; `chunkIds` in `@/utils/batching` does that. Splitting the
 * fetch out from the batching matters because it lets the caller cache *each
 * batch* independently: when the task list grows by a page, only the new batch
 * needs fetching, and the batches already held are reused from the cache.
 *
 * Duplicate ids are removed first, so a repeated id cannot appear twice in the
 * request or produce a duplicated tag.
 */
export async function getTaskTagMapChunk(taskIds: string[]): Promise<Record<string, Tag[]>> {
  const map: Record<string, Tag[]> = {};
  const unique = [...new Set(taskIds)];
  if (unique.length === 0) return map;

  const { data, error } = await supabase
    .from("task_tags")
    .select("task_id, tag_id, tags(name, id, user_id, created_at)")
    .in("task_id", unique);
  if (error) throw new Error(getServiceErrorMessage(error));

  return rowsToTagMap((data ?? []) as { task_id: string; tags: unknown }[], map);
}

/** Folds `task_tags` rows into the given map, preserving any earlier entries. */
function rowsToTagMap(
  rows: { task_id: string; tags: unknown }[],
  map: Record<string, Tag[]>
): Record<string, Tag[]> {
  for (const row of rows) {
    const embedded = row.tags;
    const tag = (Array.isArray(embedded) ? embedded[0] : embedded) as Tag | null;
    if (!tag) continue;
    if (!map[row.task_id]) map[row.task_id] = [];
    map[row.task_id].push(tag);
  }
  return map;
}

/**
 * Merges several batch results into the single map the list renders.
 *
 * Pure and exported so the merge rule is testable on its own. A task id present
 * in more than one batch keeps every tag it was given, and a batch that has not
 * loaded yet contributes nothing rather than clearing a sibling's rows — which
 * is what makes it safe to render while later pages are still in flight.
 */
export function mergeTagMaps(
  maps: (Record<string, Tag[]> | undefined)[]
): Record<string, Tag[]> {
  const merged: Record<string, Tag[]> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [taskId, tags] of Object.entries(map)) {
      if (tags.length === 0) continue;
      if (!merged[taskId]) merged[taskId] = [];
      for (const tag of tags) merged[taskId].push(tag);
    }
  }
  return merged;
}

export async function attachTag(taskId: string, tagId: string): Promise<void> {
  const { error } = await supabase.from("task_tags").insert({ task_id: taskId, tag_id: tagId });
  if (error) throw new Error(getServiceErrorMessage(error));
}

export async function detachTag(taskId: string, tagId: string): Promise<void> {
  const { error } = await supabase.from("task_tags").delete().eq("task_id", taskId).eq("tag_id", tagId);
  if (error) throw new Error(getServiceErrorMessage(error));
}
