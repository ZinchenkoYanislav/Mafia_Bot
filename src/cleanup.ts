import { prisma } from "./db";

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

// В архив уходят игры, старт которых был больше 12 часов назад
export async function archiveFinishedEvents() {
  const cutoff = new Date(Date.now() - TWELVE_HOURS);
  const result = await prisma.event.updateMany({
    where: { status: "open", eventDate: { lt: cutoff } },
    data: { status: "finished" },
  });
  if (result.count > 0) {
    console.log(`Архивировано игр: ${result.count}`);
  }
}

// Проверка сразу при старте и далее раз в час
export function startCleanupJob() {
  archiveFinishedEvents().catch((e) => console.error("Ошибка автоархивации:", e));
  setInterval(() => {
    archiveFinishedEvents().catch((e) => console.error("Ошибка автоархивации:", e));
  }, 60 * 60 * 1000);
}