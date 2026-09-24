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

export async function reorderSubtasks(taskId: string, subtaskIds: string[]): Promise<void> {
  const updates = subtaskIds.map((id, i) => ({ id, position: i }));
  const { error } = await supabase.from("subtasks").upsert(updates);
  if (error) throw new Error(getServiceErrorMessage(error));
}
