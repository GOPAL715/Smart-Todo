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
 * Maps `task_id -> tags` for a set of tasks, in bounded batches.
 *
 * The previous implementation issued one request with every id inlined. It is
 * now split into batches of `TAG_MAP_BATCH_SIZE`, so the request URL stays
 * bounded no matter how many tasks are visible. For the common case (well under
 * 200 visible tasks) this is still exactly one request, so there is no extra
 * round trip in practice.
 */
export async function getTaskTagMap(taskIds: string[]): Promise<Record<string, Tag[]>> {
  const map: Record<string, Tag[]> = {};
  const unique = [...new Set(taskIds)];
  if (unique.length === 0) return map;

  for (const batch of chunkIds(unique)) {
    const { data, error } = await supabase
      .from("task_tags")
      .select("task_id, tag_id, tags(name, id, user_id, created_at)")
      .in("task_id", batch);
    if (error) throw new Error(getServiceErrorMessage(error));

    const rows = (data ?? []) as { task_id: string; tags: unknown }[];
    for (const row of rows) {
      const embedded = row.tags;
      const tag = (Array.isArray(embedded) ? embedded[0] : embedded) as Tag | null;
      if (!tag) continue;
      if (!map[row.task_id]) map[row.task_id] = [];
      map[row.task_id].push(tag);
    }
  }

  return map;
}

export async function attachTag(taskId: string, tagId: string): Promise<void> {
  const { error } = await supabase.from("task_tags").insert({ task_id: taskId, tag_id: tagId });
  if (error) throw new Error(getServiceErrorMessage(error));
}

export async function detachTag(taskId: string, tagId: string): Promise<void> {
  const { error } = await supabase.from("task_tags").delete().eq("task_id", taskId).eq("tag_id", tagId);
  if (error) throw new Error(getServiceErrorMessage(error));
}
