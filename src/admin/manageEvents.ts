import { Composer, InlineKeyboard } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import type { MyContext, MyConversation, MyConversationContext } from "../context";
import { prisma } from "../db";
import { isAdmin } from "../config";
import { notifyParticipants } from "../notify";

const pad = (n: number) => String(n).padStart(2, "0");
function fmt(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_LABEL: Record<string, string> = {
  open: "🟢 открыта",
  closed: "🔴 закрыта",
  cancelled: "✖️ отменена",
  finished: "🏁 завершена",
};

function displayName(u: { username: string | null; firstName: string | null }): string {
  return u.username ? "@" + u.username : (u.firstName ?? "Игрок");
}

async function renderAdminCard(eventId: number) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return null;

  const regs = await prisma.registration.findMany({
    where: { eventId, status: { in: ["registered", "waitlist"] } },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  const main = regs.filter((r) => r.status === "registered");
  const wait = regs.filter((r) => r.status === "waitlist");

  const lines = [
    `🛠 Афиша #${event.id} — ${STATUS_LABEL[event.status] ?? event.status}`,
    `🎲 ${event.title}`,
    `📅 ${fmt(event.eventDate)}`,
    `📍 ${event.location}`,
    `👥 Записано: ${main.length}/${event.maxPlayers}` + (wait.length ? ` • очередь: ${wait.length}` : ""),
  ];
  if (main.length) {
    lines.push("\n📋 Игроки:");
    main.forEach((r, i) => lines.push(`${i + 1}. ${displayName(r.user)}`));
  }
  if (wait.length) {
    lines.push("\n⏳ Очередь:");
    wait.forEach((r, i) => lines.push(`${i + 1}. ${displayName(r.user)}`));
  }
  if (!main.length && !wait.length) lines.push("\nПока никто не записался.");

  const kb = new InlineKeyboard();
  if (event.status === "open") kb.text("🔴 Закрыть запись", `ev:close:${event.id}`).row();
  else if (event.status === "closed") kb.text("🟢 Открыть запись", `ev:open:${event.id}`).row();
  if (event.status !== "cancelled")
    kb.text("✖️ Отменить игру", `ev:cancel:${event.id}`).row();
  if (event.status !== "cancelled" && event.status !== "finished")
    kb.text("📢 Оповестить участников", `ev:notify:${event.id}`).row();
  kb.text("🗑 Удалить", `ev:delask:${event.id}`).row();
  kb.text("⬅️ К списку", "ev:list");

  return { text: lines.join("\n"), keyboard: kb };
}

async function renderList() {
  const events = await prisma.event.findMany({ orderBy: { eventDate: "desc" } });
  if (events.length === 0)
    return { text: "Афиш пока нет. Создай через «➕ Создать афишу».", keyboard: new InlineKeyboard() };

  const kb = new InlineKeyboard();
  for (const e of events) {
    const count = await prisma.registration.count({
      where: { eventId: e.id, status: "registered" },
    });
    const mark = STATUS_LABEL[e.status]?.split(" ")[0] ?? "•";
    kb.text(`${mark} ${fmt(e.eventDate)} — ${e.title} (${count}/${e.maxPlayers})`, `ev:open:card:${e.id}`).row();
  }
  return { text: "🗂 Все афиши. Нажми на игру для управления:", keyboard: kb };
}

export const manageModule = new Composer<MyContext>();

async function showList(ctx: MyContext) {
  if (!isAdmin(ctx.from?.id)) return;
  const { text, keyboard } = await renderList();
  await ctx.reply(text, { reply_markup: keyboard });
}

manageModule.command("events", showList);
manageModule.hears("🗂 Афиши", showList);

manageModule.callbackQuery(/^ev:open:card:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery();
  const card = await renderAdminCard(Number(ctx.match[1]));
  await ctx.answerCallbackQuery();
  if (card) await ctx.editMessageText(card.text, { reply_markup: card.keyboard });
});

manageModule.callbackQuery("ev:list", async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery();
  const { text, keyboard } = await renderList();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(text, { reply_markup: keyboard });
});

// Смена статуса: close / open / cancel (+ оповещение при отмене)
manageModule.callbackQuery(/^ev:(close|open|cancel):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery();
  const action = ctx.match[1];
  const eventId = Number(ctx.match[2]);
  const newStatus = action === "close" ? "closed" : action === "open" ? "open" : "cancelled";

  await prisma.event.update({ where: { id: eventId }, data: { status: newStatus } });

  let note = "Готово";
  if (action === "cancel") {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (event) {
      const { sent, total } = await notifyParticipants(
        ctx.api,
        eventId,
        `❌ Игра «${event.title}» (${fmt(event.eventDate)}) отменена организатором.`
      );
      note = `Отменено. Оповещено: ${sent}/${total}`;
    }
  }
  await ctx.answerCallbackQuery(note);

  const card = await renderAdminCard(eventId);
  if (card) await ctx.editMessageText(card.text, { reply_markup: card.keyboard });
});

// Удаление — подтверждение
manageModule.callbackQuery(/^ev:delask:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery();
  const eventId = Number(ctx.match[1]);
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard()
    .text("🗑 Да, удалить", `ev:delyes:${eventId}`)
    .text("↩️ Нет", `ev:open:card:${eventId}`);
  await ctx.editMessageText("Удалить афишу вместе со всеми записями? Это необратимо.", {
    reply_markup: kb,
  });
});

manageModule.callbackQuery(/^ev:delyes:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery();
  const eventId = Number(ctx.match[1]);
  await prisma.registration.deleteMany({ where: { eventId } });
  await prisma.event.delete({ where: { id: eventId } });
  await ctx.answerCallbackQuery("Удалено");
  const { text, keyboard } = await renderList();
  await ctx.editMessageText(text, { reply_markup: keyboard });
});

// --- Свободное оповещение участников ---
async function broadcast(
  conversation: MyConversation,
  ctx: MyConversationContext,
  eventId: number
) {
  await ctx.reply("✍️ Напиши текст оповещения для участников (или /cancel):");
  const { message } = await conversation.waitFor("message:text");
  if (message.text === "/cancel") {
    await ctx.reply("Отменено.");
    return;
  }

  const data = await conversation.external(() =>
    prisma.event
      .findUnique({
        where: { id: eventId },
        include: {
          registrations: {
            where: { status: { in: ["registered", "waitlist"] } },
            select: { userId: true },
          },
        },
      })
      .then((e) =>
        e ? { title: e.title, ids: e.registrations.map((r) => Number(r.userId)) } : null
      )
  );

  if (!data) {
    await ctx.reply("Игра не найдена.");
    return;
  }

  let sent = 0;
  for (const uid of data.ids) {
    try {
      await ctx.api.sendMessage(uid, `📢 По игре «${data.title}»:\n\n${message.text}`);
      sent++;
    } catch {
      // пропускаем недоступных
    }
  }
  await ctx.reply(`✅ Отправлено: ${sent} из ${data.ids.length}.`);
}

manageModule.use(createConversation(broadcast));

manageModule.callbackQuery(/^ev:notify:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery();
  const eventId = Number(ctx.match[1]);
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("broadcast", eventId);
});