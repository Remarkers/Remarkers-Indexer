import z from 'zod';

const schema = z.object({
  num: z.bigint(),
});

const data = schema.parse({ num: 123 }); // OK

console.log(data.num); // 123n
