import { InlineKeyboard } from "grammy";
import type { MyConversation, MyConversationContext } from "../context";
import { prisma } from "../db";
import { config } from "../config";

const MONTHS = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
const cancelRow = (kb: InlineKeyboard) => kb.row().text("✖️ Отмена", "cancel");

// Ждём нажатие кнопки с нужным префиксом. value === null означает «Отмена».
async function waitButton(
  conversation: MyConversation,
  prefix: string
): Promise<{ ctx: MyConversationContext; value: string | null }> {
  while (true) {
    const cb = await conversation.waitFor("callback_query:data");
    await cb.answerCallbackQuery();
    const data = cb.callbackQuery.data;
    if (data === "cancel") return { ctx: cb, value: null };
    if (data.startsWith(prefix + ":")) return { ctx: cb, value: data.slice(prefix.length + 1) };
    // чужие кнопки игнорируем и ждём дальше
  }
}

export async function pickDateTime(
  conversation: MyConversation,
  ctx: MyConversationContext
): Promise<Date | null> {
  const nowMs = await conversation.external(() => Date.now());
  const baseYear = new Date(nowMs).getFullYear();

  // Год
  const yearKb = new InlineKeyboard();
  [baseYear, baseYear + 1, baseYear + 2].forEach((y) => yearKb.text(String(y), `year:${y}`));
  cancelRow(yearKb);
  await ctx.reply("📅 Выбери год:", { reply_markup: yearKb });

  const yr = await waitButton(conversation, "year");
  if (yr.value === null) { await yr.ctx.editMessageText("Отменено."); return null; }
  const year = Number(yr.value);

  // Месяц
  const monthKb = new InlineKeyboard();
  MONTHS.forEach((name, i) => {
    monthKb.text(name, `month:${i + 1}`);
    if ((i + 1) % 3 === 0) monthKb.row();
  });
  cancelRow(monthKb);
  await yr.ctx.editMessageText(`Год: ${year}\nВыбери месяц:`, { reply_markup: monthKb });

  const mo = await waitButton(conversation, "month");
  if (mo.value === null) { await mo.ctx.editMessageText("Отменено."); return null; }
  const month = Number(mo.value);

  // День
  const dayKb = new InlineKeyboard();
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    dayKb.text(String(d), `day:${d}`);
    if (d % 7 === 0) dayKb.row();
  }
  cancelRow(dayKb);
  await mo.ctx.editMessageText(`${MONTHS[month - 1]} ${year}\nВыбери день:`, { reply_markup: dayKb });

  const dy = await waitButton(conversation, "day");
  if (dy.value === null) { await dy.ctx.editMessageText("Отменено."); return null; }
  const day = Number(dy.value);

  // Час
  const hourKb = new InlineKeyboard();
  for (let h = 10; h <= 23; h++) {
    hourKb.text(`${h}:00`, `hour:${h}`);
    if ((h - 9) % 5 === 0) hourKb.row();
  }
  cancelRow(hourKb);
  await dy.ctx.editMessageText(`${day} ${MONTHS[month - 1]} ${year}\nВыбери час:`, { reply_markup: hourKb });

  const hr = await waitButton(conversation, "hour");
  if (hr.value === null) { await hr.ctx.editMessageText("Отменено."); return null; }
  const hour = Number(hr.value);

  // Минуты
  const minKb = new InlineKeyboard();
  [0, 15, 30, 45].forEach((m) => minKb.text(`${pad(hour)}:${pad(m)}`, `min:${m}`));
  cancelRow(minKb);
  await hr.ctx.editMessageText(`${day} ${MONTHS[month - 1]} ${year}, ${hour}:00\nВыбери минуты:`, { reply_markup: minKb });

  const mn = await waitButton(conversation, "min");
  if (mn.value === null) { await mn.ctx.editMessageText("Отменено."); return null; }
  const minute = Number(mn.value);

  await mn.ctx.editMessageText(`✅ Дата игры: ${pad(day)}.${pad(month)}.${year} ${pad(hour)}:${pad(minute)}`);
  return new Date(year, month - 1, day, hour, minute);
}

export async function pickHost(
  conversation: MyConversation,
  ctx: MyConversationContext
): Promise<string | null> {
  // Админы из базы (только те, кто уже нажимал /start). Возвращаем простые поля — без BigInt/Date.
  const admins = await conversation.external(() =>
    prisma.user
      .findMany({ where: { id: { in: config.adminIds.map((n) => BigInt(n)) } } })
      .then((rows) => rows.map((r) => ({ username: r.username, firstName: r.firstName })))
  );

  const labelOf = (a: { username: string | null; firstName: string | null }, i: number) =>
    a.firstName ?? (a.username ? "@" + a.username : `Админ ${i + 1}`);

  const kb = new InlineKeyboard();
  admins.forEach((a, i) => kb.text(labelOf(a, i), `host:${i}`).row());
  kb.text("✏️ Ввести вручную", "host:manual").row();
  kb.text("⏭ Пропустить", "host:skip");
  await ctx.reply("🎩 Выбери ведущего:", { reply_markup: kb });

  const cb = await conversation.waitFor("callback_query:data");
  await cb.answerCallbackQuery();
  const data = cb.callbackQuery.data;

  if (data === "host:skip") { await cb.editMessageText("Ведущий: не указан"); return null; }
  if (data === "host:manual") {
    await cb.editMessageText("Введи имя ведущего:");
    const { message } = await conversation.waitFor("message:text");
    return message.text;
  }

  const idx = Number(data.split(":")[1]);
  const name = labelOf(admins[idx], idx);
  await cb.editMessageText(`Ведущий: ${name}`);
  return name;

  
}

// Выбор локации: venue (ресторан с названием), геопозиция или текст
export async function pickLocation(
  conversation: MyConversation,
  ctx: MyConversationContext
): Promise<{
  location: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
} | null> {
  await ctx.reply(
    "📍 Укажи место:\n" +
      "• Нажми 📎 → «Геопозиция» → найди ресторан/место и отправь (придёт с названием и координатами)\n" +
      "• Или просто напиши название текстом\n\n" +
      "/cancel — отмена"
  );

  const msg = await conversation.wait();
  const m = msg.message;

  if (m?.text === "/cancel") {
    await ctx.reply("Отменено.");
    return null;
  }

  // Venue — место с названием (ресторан), адресом и координатами
  if (m?.venue) {
    return {
      location: m.venue.title,
      address: m.venue.address,
      latitude: m.venue.location.latitude,
      longitude: m.venue.location.longitude,
    };
  }

  // Чистая геопозиция — координаты без названия, спросим название отдельно
  if (m?.location) {
    const { latitude, longitude } = m.location;
    await ctx.reply("Координаты получил. Введи название места (например, «Ресторан Мафия»):");
    const res = await conversation.waitFor("message:text");
    return { location: res.message.text, address: null, latitude, longitude };
  }

  // Просто текст — только название, без координат
  if (m?.text) {
    return { location: m.text, address: null, latitude: null, longitude: null };
  }

  // Что-то иное — просим повторить
  await ctx.reply("Не понял. Отправь геопозицию или напиши название текстом.");
  return pickLocation(conversation, ctx);
}
