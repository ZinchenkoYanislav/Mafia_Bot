-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "eventDate" DATETIME NOT NULL,
    "location" TEXT NOT NULL,
    "address" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "maxPlayers" INTEGER NOT NULL,
    "price" TEXT,
    "posterFileId" TEXT,
    "host" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Event" ("address", "createdAt", "description", "eventDate", "host", "id", "latitude", "location", "longitude", "maxPlayers", "posterFileId", "price", "status", "title") SELECT "address", "createdAt", "description", "eventDate", "host", "id", "latitude", "location", "longitude", "maxPlayers", "posterFileId", "price", "status", "title" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
