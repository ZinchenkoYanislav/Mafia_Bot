import { Keyboard } from "grammy";

export const playerMenu = new Keyboard()
  .text("🎲 Игры").text("🗓 Мои игры")
  .resized().persistent();

export const adminMenu = new Keyboard()
  .text("🎲 Игры").text("🗓 Мои игры").row()
  .text("➕ Создать афишу").text("🗂 Афиши")
  .resized().persistent();