import type { Api } from "grammy";
import { prisma } from "./db";

// Рассылает текст всем записанным на игру (основа + очередь).
// Возвращает, скольким реально дошло.
export async function notifyParticipants(
  api: Api,
  eventId: number,
  text: string
): Promise<{ sent: number; total: number }> {
  const regs = await prisma.registration.findMany({
    where: { eventId, status: { in: ["registered", "waitlist"] } },
    select: { userId: true },
  });
  let sent = 0;
  for (const r of regs) {
    try {
      await api.sendMessage(Number(r.userId), text);
      sent++;
    } catch {
      // игрок не стартовал бота или заблокировал — пропускаем
    }
  }
  return { sent, total: regs.length };
}