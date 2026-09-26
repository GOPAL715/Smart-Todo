import { supabase } from "@/services/supabase";
import { getServiceErrorMessage } from "@/utils/serviceErrors";
import type { Subtask } from "@/types";

export async function getSubtasks(taskId: string): Promise<Subtask[]> {
  const { data, error } = await supabase
    .from("subtasks")
    .select("*")
    .eq("task_id", taskId)
    .order("position", { ascending: true });
  if (error) throw new Error(getServiceErrorMessage(error));
  return (data ?? []) as Subtask[];
}

export async function createSubtask(taskId: string, title: string): Promise<Subtask> {
  const { data, error } = await supabase
    .from("subtasks")
    .insert({ task_id: taskId, title })
    .select("*")
    .single();
  if (error) throw new Error(getServiceErrorMessage(error));
  return data as Subtask;
}

export async function updateSubtask(subtaskId: string, updates: { title?: string; is_completed?: boolean }): Promise<Subtask> {
  const { data, error } = await supabase.from("subtasks").update(updates).eq("id", subtaskId).select("*").single();
  if (error) throw new Error(getServiceErrorMessage(error));
  return data as Subtask;
}

export async function deleteSubtask(subtaskId: string): Promise<void> {
  const { error } = await supabase.from("subtasks").delete().eq("id", subtaskId);
  if (error) throw new Error(getServiceErrorMessage(error));
}

/*
 * Removed: `reorderSubtasks`.
 *
 * It was dead code — nothing imported or called it, and there is no reordering
 * UI. It was also unsafe: `upsert` with `{ id, position }` partial rows would
 * attempt to INSERT a row for any id that did not already exist, and
 * `subtasks.task_id` is NOT NULL, so a stale id would have thrown a constraint
 * error after other rows had already been updated. Reordering should be
 * reintroduced with a deliberate, ownership-checked implementation if and when
 * the UI needs it.
 */
