import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, CreateTaskInput, PatchTaskInput } from '../api';
import { Task } from '../types';

const TASKS_KEY = ['tasks'] as const;
const TODOS_KEY = ['todos'] as const;
const META_KEY = ['meta'] as const;

// Every read resolves from the same in-memory tasks.json snapshot, so polling
// costs one conditional GET — GitHub answers 304 when nothing changed and does
// not bill it against the rate limit.
const POLL_MS = 20_000;

export function useTasks() {
  return useQuery({
    queryKey: TASKS_KEY,
    queryFn: () => api.listTasks(),
    refetchInterval: POLL_MS,
    staleTime: 5_000,
  });
}

export function useMeta() {
  return useQuery({
    queryKey: META_KEY,
    queryFn: () => api.meta(),
    staleTime: 60_000,
  });
}

export function useTodos() {
  return useQuery({
    queryKey: TODOS_KEY,
    queryFn: () => api.listTodos(),
    refetchInterval: POLL_MS,
    staleTime: 5_000,
  });
}

// Every mutation rewrites the whole blob, so anything derived from it is stale.
function useStoreMutation<V, R>(mutationFn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TASKS_KEY });
      qc.invalidateQueries({ queryKey: TODOS_KEY });
    },
  });
}

// Mutations that return the updated Task can patch the cached list in place, so
// the drawer re-renders without waiting for a refetch.
function useTaskMutation<V>(mutationFn: (vars: V) => Promise<Task>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (updated: Task) => {
      qc.setQueryData<Task[]>(TASKS_KEY, prev =>
        prev?.map(t => (t.id === updated.id ? updated : t)),
      );
      qc.invalidateQueries({ queryKey: TODOS_KEY });
    },
  });
}

export function useCreateTask() {
  return useStoreMutation((data: CreateTaskInput) => api.createTask(data));
}

export function usePatchTask() {
  return useTaskMutation(({ id, data }: { id: number; data: PatchTaskInput }) =>
    api.patchTask(id, data));
}

export function useAddNote() {
  return useStoreMutation(({ id, text }: { id: number; text: string }) => api.addNote(id, text));
}

export function useAddTodo() {
  return useTaskMutation(({ id, text, due }: { id: number; text: string; due?: string | null }) =>
    api.addTodo(id, text, due));
}

export function usePatchTodo() {
  return useTaskMutation(
    ({ id, todoId, data }: {
      id: number;
      todoId: number;
      data: { text?: string; done?: boolean; due?: string | null };
    }) => api.patchTodo(id, todoId, data));
}

export function useDeleteTodo() {
  return useTaskMutation(({ id, todoId }: { id: number; todoId: number }) =>
    api.deleteTodo(id, todoId));
}

export function useCompleteTask() {
  return useStoreMutation((id: number) => api.completeTask(id));
}

export function useDeleteTask() {
  return useStoreMutation((id: number) => api.deleteTask(id));
}

export function useSendInbox() {
  return useMutation({
    mutationFn: ({ prompt, taskId }: { prompt: string; taskId?: number | null }) =>
      api.sendInbox(prompt, taskId),
  });
}

// Replaces useAttachBug: `input` is anything parseIssueInput accepts —
// owner/repo#123, a pasted issue URL, or a bare number when a default repo is set.
export function useAttachIssue() {
  return useStoreMutation(({ id, input }: { id: number; input: string }) =>
    api.attachIssue(id, input));
}

export function useMergeTask() {
  return useStoreMutation(({ targetId, sourceId }: { targetId: number; sourceId: number }) =>
    api.mergeTask(targetId, sourceId));
}

export function useSetCurrentMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: string | null) => api.setCurrentMilestone(value),
    onSuccess: () => qc.invalidateQueries({ queryKey: META_KEY }),
  });
}
