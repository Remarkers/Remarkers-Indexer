import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  transactionOptions: {
    timeout: 120000,
  },
});

void (async function () {
  console.log('init')
})();
