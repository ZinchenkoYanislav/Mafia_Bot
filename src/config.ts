import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная окружения: ${name}`);
  return value;
}

export const config = {
  botToken: required("BOT_TOKEN"),
  adminIds: (process.env.ADMIN_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n)),
};

export const isAdmin = (userId?: number): boolean =>
  userId !== undefined && config.adminIds.includes(userId);