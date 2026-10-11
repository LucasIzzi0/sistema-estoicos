import { SCHEDULES, type Queue, type QueueName } from '@estoicos/queue';

/**
 * Registra los jobs programados con IDs FIJOS. upsertJobScheduler es idempotente: correrlo en
 * cada arranque (o desde dos instancias durante un deploy) no crea duplicados.
 */
export async function registerSchedulers(queues: Map<QueueName, Queue>): Promise<string[]> {
  const registered: string[] = [];
  for (const schedule of SCHEDULES) {
    const queue = queues.get(schedule.queue);
    if (!queue) throw new Error(`No existe la cola ${schedule.queue}`);
    await queue.upsertJobScheduler(schedule.schedulerId, schedule.repeat, {
      name: schedule.jobName,
      opts: { removeOnComplete: 100, removeOnFail: 500 },
    });
    registered.push(schedule.schedulerId);
  }
  return registered;
}
