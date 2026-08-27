import type { Api } from "grammy";
import { prisma } from "./db";

const REMINDER_HOURS = 2;                  // за сколько часов до старта напоминать
const CHECK_INTERVAL = 15 * 60 * 1000;     // проверка каждые 15 минут

const pad = (n: number) => String(n).padStart(2, "0");
function fmt(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Находит игры, до старта которых осталось <= REMINDER_HOURS, и шлёт напоминания
export async function sendDueReminders(api: Api) {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_HOURS * 60 * 60 * 1000);

  const events = await prisma.event.findMany({
    where: {
      status: "open",
      reminderSent: false,
      eventDate: { gt: now, lte: windowEnd }, // старт ещё впереди, но уже близко
    },
  });

  for (const event of events) {
    const regs = await prisma.registration.findMany({
      where: { eventId: event.id, status: "registered" }, // только основа, не очередь
      select: { userId: true },
    });

    const text =
      `⏰ Напоминание: скоро игра «${event.title}»\n` +
      `📅 ${fmt(event.eventDate)}\n` +
      `📍 ${event.location}`;

    for (const r of regs) {
      try {
        await api.sendMessage(Number(r.userId), text);
      } catch {
        // игрок заблокировал бота — пропускаем
      }
    }

    // помечаем, чтобы не напоминать повторно
    await prisma.event.update({
      where: { id: event.id },
      data: { reminderSent: true },
    });

    console.log(`Напоминание по игре #${event.id} отправлено (${regs.length} игр.)`);
  }
}

// Запуск сразу и далее каждые 15 минут
export function startRemindersJob(api: Api) {
  sendDueReminders(api).catch((e) => console.error("Ошибка напоминаний:", e));
  setInterval(() => {
    sendDueReminders(api).catch((e) => console.error("Ошибка напоминаний:", e));
  }, CHECK_INTERVAL);
}