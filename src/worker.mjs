import { updateTask } from './store.mjs';

/** Binds writes to one declared owner and task; this is not authentication. */
export function createWorkerWriter(db, binding) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(binding)) ||
      Reflect.ownKeys(binding).some((key) => key !== 'task_id' && key !== 'actor') ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(binding.task_id ?? '') ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(binding.actor ?? '') ||
      typeof binding.task_id !== 'string' || typeof binding.actor !== 'string') {
    const error = new Error('Worker binding requires only valid task_id and actor.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const { task_id, actor } = binding;
  return Object.freeze({
    write(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
          Reflect.ownKeys(input).some((key) => !['expected_revision', 'operation_id', 'status', 'checkpoint', 'next_action'].includes(key))) {
        const error = new Error('Worker write accepts only revision, operation id, and task state fields.');
        error.code = 'VALIDATION_ERROR';
        throw error;
      }
      return updateTask(db, { ...input, task_id, actor });
    },
  });
}
