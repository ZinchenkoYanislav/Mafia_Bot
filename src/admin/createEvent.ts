import { Composer } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import type { MyContext, MyConversation, MyConversationContext } from "../context";
import { prisma } from "../db";
import { isAdmin } from "../config";
import { pickDateTime, pickHost, pickLocation } from "./pickers";


async function ask(
  conversation: MyConversation,
  ctx: MyConversationContext,
  prompt: string
): Promise<string | null> {
  await ctx.reply(prompt);
  const { message } = await conversation.waitFor("message:text");
  return message.text === "/cancel" ? null : message.text;
}

async function createEvent(conversation: MyConversation, ctx: MyConversationContext) {
  await ctx.reply("📝 Создаём афишу. В любой момент /cancel — отмена.");

  const title = await ask(conversation, ctx, "Введи заголовок игры:");
  if (title === null) { await ctx.reply("Отменено."); return; }

  const eventDate = await pickDateTime(conversation, ctx);
  if (eventDate === null) return; // pickDateTime уже написал «Отменено.»

  const loc = await pickLocation(conversation, ctx);
  if (loc === null) return; // pickLocation уже написал «Отменено.»

  let maxPlayers: number | null = null;
  while (maxPlayers === null) {
    const raw = await ask(conversation, ctx, "Введи макс. число игроков (число):");
    if (raw === null) { await ctx.reply("Отменено."); return; }
    const n = Number(raw.trim());
    if (Number.isInteger(n) && n > 0) maxPlayers = n;
    else await ctx.reply("Нужно целое число больше 0.");
  }

  let price = await ask(conversation, ctx, "Введи цену/взнос (или - если бесплатно):");
  if (price === null) { await ctx.reply("Отменено."); return; }
  if (price.trim() === "-") price = null;

  const host = await pickHost(conversation, ctx); // null = не указан

  await ctx.reply("Пришли постер картинкой (или напиши - чтобы пропустить):");
  let posterFileId: string | null = null;
  const posterCtx = await conversation.wait();
  if (posterCtx.message?.photo) {
    const photos = posterCtx.message.photo;
    posterFileId = photos[photos.length - 1].file_id;
  } else if (posterCtx.message?.text === "/cancel") {
    await ctx.reply("Отменено."); return;
  }

  let description = await ask(conversation, ctx, "Введи описание (или - чтобы пропустить):");
  if (description === null) { await ctx.reply("Отменено."); return; }
  if (description.trim() === "-") description = null;

  const eventId = await conversation.external(() =>
    prisma.event
      .create({
        data: {
          title,
          eventDate: eventDate!,
          location: loc.location,
          address: loc.address,
          latitude: loc.latitude,
          longitude: loc.longitude,
          maxPlayers: maxPlayers!,
          price,
          host,
          posterFileId,
          description,
        },
      })
      .then((e) => e.id)
  );

  await ctx.reply(`✅ Афиша #${eventId} создана!`);
}

async function enterCreate(ctx: MyContext) {
  if (!isAdmin(ctx.from?.id)) return;
  await ctx.conversation.enter("createEvent");
}

export const adminModule = new Composer<MyContext>();
adminModule.use(createConversation(createEvent));
adminModule.command("newevent", enterCreate);
adminModule.hears("➕ Создать афишу", enterCreate); // та же кнопка снизу