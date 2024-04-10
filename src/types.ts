import { SubmittableExtrinsic } from '@polkadot/api/types';
import { Extrinsic } from '@polkadot/types/interfaces';
import { isAddress } from '@polkadot/util-crypto';
import z from 'zod';

export type MintMode = 'public' | 'whitelist' | 'creator';
const zodMintMode: z.ZodType<MintMode> = z.enum([
  'public',
  'whitelist',
  'creator',
]);

export type OP = 'create' | 'addwl' | 'mint' | 'approve' | 'send' | 'burn';
const zodOP: z.ZodType<OP> = z.enum([
  'create',
  'addwl',
  'mint',
  'approve',
  'send',
  'burn',
]);

function validSS58Address(value: string): boolean {
  return isAddress(value);
}

function validBigInt(value: string): boolean {
  try {
    BigInt(value);
    return true;
  } catch {
    return false;
  }
}

function validUri(value: string): boolean {
  const u = new URL(value);
  return (
    u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'ipfs:'
  );
}

export type Config = {
  chainEndpoint: string;
  chainSs58Prefix: number;
  scanStartBlock: number;
  scanConcurrency: number;
  ipfsGateway: string;
};

export const BaseContentSchema = z.object({
  p: z.string().refine((v) => v === 'dot-721'),
  op: zodOP,
});
export type BaseContent = z.infer<typeof BaseContentSchema>;

export const CreateContentSchema = BaseContentSchema.extend({
  metadata: z.string().refine(validUri),
  issuer: z.string().refine(validSS58Address).optional(),
  base_uri: z.string().refine(validUri).optional(),
  supply: z.number().int().optional(),
  mint_settings: z
    .object({
      mode: zodMintMode.optional(),
      start: z.number().int().optional(),
      end: z.number().int().optional(),
      price: z.string().refine(validBigInt).optional(),
      limit: z.number().int().optional(),
    })
    .optional(),
});
export type CreateContent = z.infer<typeof CreateContentSchema>;

export const AddwlContentSchema = BaseContentSchema.extend({
  id: z.string(),
  data: z.array(z.string().refine(validSS58Address)).min(1),
});
export type AddwlContent = z.infer<typeof AddwlContentSchema>;

export const MintContentSchema = BaseContentSchema.extend({
  id: z.string(),
  metadata: z.string().refine(validUri).optional(),
});
export type MintContent = z.infer<typeof MintContentSchema>;

export const ApproveContentSchema = BaseContentSchema.extend({
  id: z.string(),
  approved: z.string().refine(validSS58Address),
  token_id: z.number().int().min(0),
});
export type ApproveContent = z.infer<typeof ApproveContentSchema>;

export const SendContentSchema = BaseContentSchema.extend({
  id: z.string(),
  token_id: z.number().int().min(0),
  recipient: z.string().refine(validSS58Address),
});
export type SendContent = z.infer<typeof SendContentSchema>;

export const BurnContentSchema = BaseContentSchema.extend({
  id: z.string(),
  token_id: z.number().int().min(0),
});
export type BurnContent = z.infer<typeof BurnContentSchema>;

export type Content =
  | CreateContent
  | AddwlContent
  | MintContent
  | SendContent
  | BurnContent;

export const CollectionMetadataSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  image: z.string().refine(validUri),
});

export type CollectionMetadata = z.infer<typeof CollectionMetadataSchema>;

export const TokenMetadataSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  image: z.string().refine(validUri),
  attributes: z
    .array(z.object({ trait_type: z.string(), value: z.string() }))
    .optional(),
});

export type TokenMetadata = z.infer<typeof TokenMetadataSchema>;

export function assertContent(content: string): Content {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const temp = JSON.parse(content);
  switch (temp.op as OP) {
    case 'create':
      return CreateContentSchema.parse(temp);
    case 'addwl':
      return AddwlContentSchema.parse(temp);
    case 'mint':
      return MintContentSchema.parse(temp);
    case 'approve':
      return ApproveContentSchema.parse(temp);
    case 'send':
      return SendContentSchema.parse(temp);
    case 'burn':
      return BurnContentSchema.parse(temp);
  }
}

export type Inscription = {
  blockNumber: number;
  extrinsicHash: string;
  extrinsicIndex: number;
  sender: string;
  transfer?: bigint; // Mint price transfer to NFT collection creator
  transferTo?: string;
  rawContent: string;
  content: Content;
  timestamp: Date;
};

export type FailReason =
  | 'invalid_metadata'
  | 'missing_base_uri'
  | 'collection_duplicate'
  | 'collection_not_found'
  | 'not_collection_owner'
  | 'mint_not_started'
  | 'mint_finished'
  | 'mint_not_paid'
  | 'mint_invalid_payee'
  | 'mint_insufficient_amount'
  | 'mint_exceed_supply'
  | 'mint_exceed_limit'
  | 'mint_missing_metadata'
  | 'mint_not_eligible'
  | 'token_not_found'
  | 'token_burned'
  | 'not_token_owner';

export function parseInscription(
  ex: Extrinsic | SubmittableExtrinsic<'promise'>,
): Inscription | undefined {
  if (!ex.isSigned) {
    return;
  }

  // Check if it is a batchAll
  if (ex.method.method !== 'batchAll' || ex.method.section !== 'utility') {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const methodJson = ex.method.toHuman() as any;
  if (!methodJson?.args?.calls || !methodJson.args.calls.length) {
    return;
  }

  const call0 = methodJson.args.calls[0];
  if (call0?.method !== 'remarkWithEvent' || call0?.section !== 'system') {
    return;
  }

  // Check if call1 is a valid transferKeepAlive
  let call1 = methodJson.args.calls[1];
  if (
    call1?.method !== 'transferKeepAlive' ||
    call1?.section !== 'balances' ||
    !call1?.args?.dest?.Id ||
    !call1?.args?.value
  ) {
    call1 = null;
  }

  const rawRemark = call0.args.remark as string;
  const remark = rawRemark.toLowerCase();
  // Try to parse and validate the content
  let content: Content;
  try {
    content = assertContent(remark);
  } catch (e) {
    throw new Error(`Failed to parse content: ${rawRemark}`);
  }

  return {
    extrinsicHash: ex.hash.toHex(),
    sender: ex.signer.toString(),
    transfer: call1?.args?.value
      ? BigInt((call1.args.value as string).replace(/,/g, ''))
      : undefined,
    transferTo: call1?.args?.dest?.Id,
    rawContent: rawRemark,
    content: content,
  } as Inscription;
}
