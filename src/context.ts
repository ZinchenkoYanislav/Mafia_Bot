import type { Context } from "grammy";
import type { Conversation, ConversationFlavor } from "@grammyjs/conversations";

// Контекст «снаружи» — знает про все плагины бота
export type MyContext = ConversationFlavor<Context>;
// Контекст «внутри» диалога
export type MyConversationContext = Context;
// Тип самого диалога
export type MyConversation = Conversation<MyContext, MyConversationContext>;