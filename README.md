# Remarkers-Indexer

A offcial indexer for Remarkers. Follow the [standard](/standard.md) to implement the indexer.

# How to use

## Prerequisites

- Node.js
- MySQL

```bash
CREATE DATABASE remarkers CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## Installation

1. Install the dependencies

```bash
pnpm install
```

2. Generate the database schema

```bash
echo DATABASE_URL="mysql://username:password@localhost:3306/remarkers" > .env
npx prisma migrate dev --name init
```

3. Run the server

```bash
pnpm build
node build/src/index.js
```
