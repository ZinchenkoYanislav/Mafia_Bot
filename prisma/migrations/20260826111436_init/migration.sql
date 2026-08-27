-- CreateTable
CREATE TABLE "User" (
    "id" BIGINT NOT NULL PRIMARY KEY,
    "username" TEXT,
    "firstName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "eventDate" DATETIME NOT NULL,
    "location" TEXT NOT NULL,
    "maxPlayers" INTEGER NOT NULL,
    "price" TEXT,
    "posterFileId" TEXT,
    "host" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" BIGINT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Registration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Registration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Registration_userId_eventId_key" ON "Registration"("userId", "eventId");
