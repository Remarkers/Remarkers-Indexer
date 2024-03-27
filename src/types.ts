import { decodeAddress, encodeAddress, isAddress } from '@polkadot/util-crypto';
import { MintMode, OP } from '@prisma/client';
import dotenv from 'dotenv';
import z from 'zod';

dotenv.config();

function validSS58Address(value: string): boolean {
  if (!isAddress(value)) {
    return false;
  }
  const ss58Prefix = parseInt(process.env.CHAIN_SS58_PREFIX!);
  const targetAddress = encodeAddress(decodeAddress(value), ss58Prefix);
  return targetAddress === value;
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
  op: z.nativeEnum(OP),
});

export type BaseContent = z.infer<typeof BaseContentSchema>;

export const CreateContentSchema = BaseContentSchema.extend({
  metadata: z.string().refine(validUri),
  issuer: z.string().refine(validSS58Address).optional(),
  base_uri: z.string().refine(validUri).optional(),
  supply: z.number().int().optional(),
  mint_settings: z
    .object({
      mode: z.nativeEnum(MintMode).optional(),
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
  data: z.array(z.string().refine(validSS58Address)),
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
    case OP.create:
      return CreateContentSchema.parse(temp);
    case OP.addwl:
      return AddwlContentSchema.parse(temp);
    case OP.mint:
      return MintContentSchema.parse(temp);
    case OP.approve:
      return ApproveContentSchema.parse(temp);
    case OP.send:
      return SendContentSchema.parse(temp);
    case OP.burn:
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
  | 'mint_exceed_limit'
  | 'mint_missing_metadata'
  | 'mint_not_eligible'
  | 'token_not_found'
  | 'token_burned'
  | 'not_token_owner';
