import { Composer, InlineKeyboard } from "grammy";
import type { MyContext } from "../context";
import { prisma } from "../db";

// --- helpers ---
const pad = (n: number) => String(n).padStart(2, "0");
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function formatDate(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} (${WD[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function ensureUser(ctx: MyContext) {
  const f = ctx.from;
  if (!f) return;
  await prisma.user.upsert({
    where: { id: BigInt(f.id) },
    update: { username: f.username, firstName: f.first_name },
    create: { id: BigInt(f.id), username: f.username, firstName: f.first_name },
  });
}

// Собираем текст карточки + кнопки под неё
// Имя игрока для списка: @username, иначе имя
function displayName(u: { username: string | null; firstName: string | null }): string {
  if (u.username) return "@" + u.username;
  return u.firstName ?? "Игрок";
}

async function renderCard(
  event: NonNullable<Awaited<ReturnType<typeof prisma.event.findUnique>>>,
  userId: bigint | null
) {
  // Все актуальные записи + данные игроков, по времени записи
  const regs = await prisma.registration.findMany({
    where: { eventId: event.id, status: { in: ["registered", "waitlist"] } },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  const mainList = regs.filter((r) => r.status === "registered");
  const waitList = regs.filter((r) => r.status === "waitlist");

  // Статус текущего игрока
  let myStatus: string | null = null;
  let waitPos = 0;
  if (userId !== null) {
    const mine = regs.find((r) => r.userId === userId);
    if (mine) {
      myStatus = mine.status;
      if (mine.status === "waitlist") {
        waitPos = waitList.findIndex((r) => r.userId === userId) + 1;
      }
    }
  }

  const lines = [
    `🎲 ${event.title}`,
    `📅 ${formatDate(event.eventDate)}`,
    `📍 ${event.location}${event.address ? `, ${event.address}` : ""}`,
  ];
  if (event.host) lines.push(`🎩 Ведущий: ${event.host}`);
  if (event.price) lines.push(`💰 ${event.price}`);
  if (event.description) lines.push(`\n${event.description}`);

  lines.push(
    `\n👥 Занято: ${mainList.length}/${event.maxPlayers}` +
      (waitList.length ? ` • Лист ожидания: ${waitList.length}` : "")
  );

  // Список записавшихся
  if (mainList.length > 0) {
    lines.push("\n📋 Игроки:");
    mainList.forEach((r, i) => lines.push(`${i + 1}. ${displayName(r.user)}`));
  }
  if (waitList.length > 0) {
    lines.push("\n⏳ Очередь:");
    waitList.forEach((r, i) => lines.push(`${i + 1}. ${displayName(r.user)}`));
  }

  if (myStatus === "registered") lines.push("\n✅ Ты записан");
  else if (myStatus === "waitlist") lines.push(`\n⏳ Ты в очереди (#${waitPos})`);

  const kb = new InlineKeyboard();
  if (myStatus === "registered" || myStatus === "waitlist")
    kb.text("❌ Отменить запись", `cancel:${event.id}`);
  else kb.text("✅ Записаться", `reg:${event.id}`);
  if (event.latitude != null && event.longitude != null)
    kb.row().url("🗺 На карте", `https://maps.google.com/?q=${event.latitude},${event.longitude}`);

  return { text: lines.join("\n"), keyboard: kb };
}

// Перерисовать текущее сообщение (фото/текст) после нажатия
async function rerender(ctx: MyContext, eventId: number, userId: bigint) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return;
  const { text, keyboard } = await renderCard(event, userId);
  try {
    if (ctx.callbackQuery?.message && "photo" in ctx.callbackQuery.message)
      await ctx.editMessageCaption({ caption: text, reply_markup: keyboard });
    else await ctx.editMessageText(text, { reply_markup: keyboard });
  } catch {
    /* «message is not modified» — игнорируем */
  }
}

// --- бизнес-логика записи ---
async function registerForEvent(userId: bigint, eventId: number): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event || event.status !== "open") return "Запись на эту игру закрыта.";

    const existing = await tx.registration.findUnique({
      where: { userId_eventId: { userId, eventId } },
    });
    if (existing?.status === "registered") return "Ты уже записан.";
    if (existing?.status === "waitlist") return "Ты уже в листе ожидания.";

    const registered = await tx.registration.count({
      where: { eventId, status: "registered" },
    });
    const status = registered < event.maxPlayers ? "registered" : "waitlist";

    if (existing)
      await tx.registration.update({
        where: { id: existing.id },
        data: { status, createdAt: new Date() },
      });
    else await tx.registration.create({ data: { userId, eventId, status } });

    return status === "registered" ? "✅ Ты записан!" : "⏳ Мест нет — ты в листе ожидания.";
  });
}

async function cancelRegistration(userId: bigint, eventId: number) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.registration.findUnique({
      where: { userId_eventId: { userId, eventId } },
    });
    if (!existing || existing.status === "cancelled")
      return { msg: "Ты и так не записан." };

    const wasRegistered = existing.status === "registered";
    await tx.registration.update({
      where: { id: existing.id },
      data: { status: "cancelled" },
    });

    let promotedUserId: bigint | undefined;
    if (wasRegistered) {
      const next = await tx.registration.findFirst({
        where: { eventId, status: "waitlist" },
        orderBy: { createdAt: "asc" },
      });
      if (next) {
        await tx.registration.update({ where: { id: next.id }, data: { status: "registered" } });
        promotedUserId = next.userId;
      }
    }
    const event = await tx.event.findUnique({ where: { id: eventId } });
    return { msg: "Запись отменена.", promotedUserId, eventTitle: event?.title };
  });
}

// --- модуль ---
export const playerModule = new Composer<MyContext>();

async function showGames(ctx: MyContext) {
  const userId = ctx.from ? BigInt(ctx.from.id) : null;
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000); // 12 часов после старта
  const events = await prisma.event.findMany({
    where: { status: "open", eventDate: { gte: cutoff } },
    orderBy: { eventDate: "asc" },
  });
  if (events.length === 0) {
    await ctx.reply("Пока нет открытых игр. Загляни позже 🙌");
    return;
  }
  for (const event of events) {
    const { text, keyboard } = await renderCard(event, userId);
    if (event.posterFileId)
      await ctx.replyWithPhoto(event.posterFileId, { caption: text, reply_markup: keyboard });
    else await ctx.reply(text, { reply_markup: keyboard });
  }
}

async function showMyGames(ctx: MyContext) {
  const userId = BigInt(ctx.from!.id);
  const regs = await prisma.registration.findMany({
    where: {
      userId,
      status: { in: ["registered", "waitlist"] },
      event: { eventDate: { gte: new Date() }, status: { not: "cancelled" } },
    },
    include: { event: true },
    orderBy: { event: { eventDate: "asc" } },
  });
  if (regs.length === 0) {
    await ctx.reply("У тебя пока нет записей на игры.");
    return;
  }
  for (const r of regs) {
    const { text, keyboard } = await renderCard(r.event, userId);
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

playerModule.command("games", showGames);
playerModule.hears("🎲 Игры", showGames);
playerModule.command("mygames", showMyGames);
playerModule.hears("🗓 Мои игры", showMyGames);

playerModule.callbackQuery(/^reg:(\d+)$/, async (ctx) => {
  await ensureUser(ctx);
  const eventId = Number(ctx.match[1]);
  const userId = BigInt(ctx.from.id);
  const msg = await registerForEvent(userId, eventId);
  await ctx.answerCallbackQuery(msg);
  await rerender(ctx, eventId, userId);
});

playerModule.callbackQuery(/^cancel:(\d+)$/, async (ctx) => {
  const eventId = Number(ctx.match[1]);
  const userId = BigInt(ctx.from.id);
  const { msg, promotedUserId, eventTitle } = await cancelRegistration(userId, eventId);
  await ctx.answerCallbackQuery(msg);
  await rerender(ctx, eventId, userId);
  if (promotedUserId !== undefined) {
    try {
      await ctx.api.sendMessage(
        Number(promotedUserId),
        `🎉 Освободилось место на игре «${eventTitle}» — ты автоматически записан!`
      );
    } catch {
      /* игрок мог не стартовать бота — молча пропускаем */
    }
  }
});