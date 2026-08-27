import { Bot } from "grammy";
import { conversations } from "@grammyjs/conversations";
import type { MyContext } from "./context";
import { config, isAdmin } from "./config";
import { prisma } from "./db";
import { adminModule } from "./admin/createEvent";
import { playerModule } from "./player/games";
import { adminMenu, playerMenu } from "./keyboards";
import { startCleanupJob } from "./cleanup";
import { manageModule } from "./admin/manageEvents";
import { startRemindersJob } from "./reminders";

const bot = new Bot<MyContext>(config.botToken);

bot.use(conversations());
bot.use(adminModule);
bot.use(playerModule);
bot.use(manageModule);

bot.command("start", async (ctx) => {
  const from = ctx.from;
  if (from) {
    await prisma.user.upsert({
      where: { id: BigInt(from.id) },
      update: { username: from.username, firstName: from.first_name },
      create: { id: BigInt(from.id), username: from.username, firstName: from.first_name },
    });
  }

  const admin = isAdmin(from?.id);
  const text =
    "Привет! Это бот для записи на игры в Мафию 🕵️\n\n" +
    "Нажми «🎲 Игры», чтобы посмотреть ближайшие игры и записаться." +
    (admin ? "\n\n🛠 Ты админ: кнопка «➕ Создать афишу» или /newevent." : "");
  await ctx.reply(text, { reply_markup: admin ? adminMenu : playerMenu });
});

bot.catch((err) => console.error("Ошибка бота:", err.error));

startCleanupJob(); // archive
startRemindersJob(bot.api); // reminders

bot.start({ onStart: (info) => console.log(`Бот запущен: @${info.username}`) });