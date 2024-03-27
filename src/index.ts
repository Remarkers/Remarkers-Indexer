import {
  Collection,
  Prisma,
  PrismaClient,
  Token,
  TransactionStatus,
} from '@prisma/client';
import {
  DefaultArgs,
  PrismaClientKnownRequestError,
} from '@prisma/client/runtime/library';
import dotenv from 'dotenv';
import Scanner from './scanner.js';
import {
  AddwlContent,
  ApproveContent,
  BurnContent,
  CollectionMetadata,
  CollectionMetadataSchema,
  Config,
  CreateContent,
  FailReason,
  Inscription,
  MintContent,
  SendContent,
  TokenMetadataSchema,
} from './types.js';

type PrismaTransactionClient = Omit<
  PrismaClient<Prisma.PrismaClientOptions, never, DefaultArgs>,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

type TransactionParams = {
  inscription: Inscription;
  collectionId: string;
  tokenId?: number;
  status: TransactionStatus;
  failReason?: FailReason;
};

const prisma = new PrismaClient({
  transactionOptions: {
    timeout: 120000,
  },
});

dotenv.config();

const config: Config = {
  chainEndpoint: process.env.CHAIN_ENDPOINT!,
  chainSs58Prefix: parseInt(process.env.CHAIN_SS58_PREFIX!),
  scanStartBlock: parseInt(process.env.SCAN_START_BLOCK!),
  scanConcurrency: parseInt(process.env.SCAN_CONCURRENCY!) || 1,
  ipfsGateway: process.env.IPFS_GATEWAY!,
};

void (async function () {
  // Query last block number from database
  const lastBlock = await prisma.transaction.findFirst({
    orderBy: {
      id: 'desc',
    },
  });
  config.scanStartBlock = Math.max(
    lastBlock?.block_number ?? 0,
    config.scanStartBlock,
  );

  const scanner = new Scanner(config);

  await scanner.init();
  await scanner.scan(async (blockInscriptions) => {
    for (let i = 0; i < blockInscriptions.length; ) {
      const inscription = blockInscriptions[i];
      try {
        switch (inscription.content.op) {
          case 'create': {
            await handleCreate(inscription);
            break;
          }
          case 'addwl': {
            await handleAddwl(inscription);
            break;
          }
          case 'mint': {
            await handleMint(inscription);
            break;
          }
          case 'approve': {
            await handleApprove(inscription);
            break;
          }
          case 'send': {
            await handleSend(inscription);
            break;
          }
          case 'burn': {
            await handleBurn(inscription);
            break;
          }
        }
        // If handled successfully, move to the next inscription
        i++;
      } catch (e) {
        console.error(
          'handle inscription error',
          JSON.stringify(inscription),
          e,
        );
      }
    }
  });
})();

async function handleCreate(inscription: Inscription) {
  const content = inscription.content as CreateContent;
  const transactionParams = buildTransactionParams(
    inscription,
    buildCollectionId(inscription),
  );
  const { ok, metadataJson } = await fetchMetadata(content.metadata);
  if (!ok) {
    transactionParams.status = 'fail';
    transactionParams.failReason = 'invalid_metadata';
    console.warn(
      `create operation failed: ${transactionParams.failReason}`,
      JSON.stringify(inscription),
    );
    await submitTransaction(transactionParams);
    return;
  }
  let metadata: CollectionMetadata;
  try {
    metadata = CollectionMetadataSchema.parse(metadataJson);
  } catch (e) {
    transactionParams.status = 'fail';
    transactionParams.failReason = 'invalid_metadata';
    console.warn(
      `create operation failed: ${transactionParams.failReason}`,
      JSON.stringify(inscription),
      e,
    );
    await submitTransaction(transactionParams);
    return;
  }

  // Save metadata to database and transaction
  const collectionId = buildCollectionId(inscription);
  await submitTransaction(transactionParams, async (tx) => {
    await tx.collection.create({
      data: {
        collection_id: collectionId,
        name: metadata.name,
        description: metadata.description,
        image: metadata.image,
        issuer: inscription.sender,
        base_uri: content.base_uri,
        supply: content.supply,
        ms_mode: content?.mint_settings?.mode,
        ms_start: content?.mint_settings?.start,
        ms_end: content?.mint_settings?.end,
        ms_price: content?.mint_settings?.price
          ? BigInt(content.mint_settings.price)
          : null,
        ms_limit: content?.mint_settings?.limit,
        create_time: inscription.timestamp,
        update_time: inscription.timestamp,
      },
    });
  });
}

async function handleAddwl(inscription: Inscription) {
  const content = inscription.content as AddwlContent;
  const transactionParams = buildTransactionParams(inscription, content.id);
  const { collection, failReason } = await findCollectionAndCheckOwner(
    transactionParams.collectionId,
    inscription.sender,
  );
  if (!collection) {
    transactionParams.status = 'fail';
    transactionParams.failReason = failReason;
    console.warn(
      `addwl operation failed: ${transactionParams.failReason}`,
      JSON.stringify(inscription),
    );
    await submitTransaction(transactionParams);
    return;
  }

  // save whitelist to database and transaction
  await submitTransaction(transactionParams, async (tx) => {
    await tx.whitelist.createMany({
      data: content.data.map((address) => ({
        collection_id: collection.collection_id,
        address,
        create_time: inscription.timestamp,
      })),
    });
  });
}

async function handleMint(inscription: Inscription) {
  const content = inscription.content as MintContent;
  const transactionParams = buildTransactionParams(inscription, content.id);
  const { collection, failReason } = await findCollection(
    transactionParams.collectionId,
  );
  if (!collection) {
    transactionParams.status = 'fail';
    transactionParams.failReason = failReason;
    console.warn(
      `mint operation failed: ${transactionParams.failReason}`,
      JSON.stringify(inscription),
    );
    await submitTransaction(transactionParams);
    return;
  }

  // check it is in mint block range
  if (
    (collection.ms_start ?? 0) > 0 &&
    inscription.blockNumber < collection.ms_start!
  ) {
    transactionParams.status = 'fail';
    transactionParams.failReason = 'mint_not_started';
    console.warn(
      `mint operation failed: ${transactionParams.failReason}`,
      JSON.stringify(inscription),
    );
    await submitTransaction(transactionParams);
    return;
  }
  if (
    (collection.ms_end ?? 0) > 0 &&
    inscription.blockNumber > collection.ms_end!
  ) {
    transactionParams.status = 'fail';
    transactionParams.failReason = 'mint_finished';
    console.warn(
      `mint operation failed: ${transactionParams.failReason}`,
      JSON.stringify(inscription),
    );
    await submitTransaction(transactionParams);
    return;
  }

  // check mint price is valid
  if ((collection.ms_price ?? 0n) > 0n) {
    if (!inscription.transfer) {
      transactionParams.status = 'fail';
      transactionParams.failReason = 'mint_not_paid';
      console.warn(
        `mint operation failed: ${transactionParams.failReason}`,
        JSON.stringify(inscription),
      );
      await submitTransaction(transactionParams);
      return;
    }
    if (inscription.transferTo !== collection.issuer) {
      transactionParams.status = 'fail';
      transactionParams.failReason = 'mint_invalid_payee';
      console.warn(
        `mint operation failed: ${transactionParams.failReason}`,
        JSON.stringify(inscription),
      );
      await submitTransaction(transactionParams);
      return;
    }
    if (inscription.transfer < collection.ms_price!) {
      transactionParams.status = 'fail';
      transactionParams.failReason = 'mint_insufficient_amount';
      console.warn(
        `mint operation failed: ${transactionParams.failReason}`,
        JSON.stringify(inscription),
      );
      await submitTransaction(transactionParams);
      return;
    }
  }

  // check user is exceed mint limit
  if ((collection.ms_limit ?? 0) > 0) {
    const mintedCount = await prisma.transaction.count({
      where: {
        collection_id: collection.collection_id,
        op: 'mint',
        sender: inscription.sender,
        status: 'success',
      },
    });
    if (mintedCount >= collection.ms_limit!) {
      transactionParams.status = 'fail';
      transactionParams.failReason = 'mint_exceed_limit';
      console.warn(
        `mint operation failed: ${transactionParams.failReason}`,
        JSON.stringify(inscription),
      );
      await submitTransaction(transactionParams);
      return;
    }
  }

  // When collection mint mode is creator, metadata is required
  if (collection.ms_mode === 'creator' && !content.metadata) {
    transactionParams.status = 'fail';
    transactionParams.failReason = 'mint_missing_metadata';
    console.warn(
      `mint operation failed: ${transactionParams.failReason}`,
      JSON.stringify(inscription),
    );
    await submitTransaction(transactionParams);
    return;
  }

  // Check mint eligibility
  switch (collection.ms_mode) {
    case 'whitelist': {
      const isEligible = await prisma.whitelist.findFirst({
        where: {
          collection_id: collection.collection_id,
          address: inscription.sender,
        },
      });
      if (!isEligible) {
        transactionParams.status = 'fail';
        transactionParams.failReason = 'mint_not_eligible';
        console.warn(
          `mint operation failed: ${transactionParams.failReason}`,
          JSON.stringify(inscription),
        );
        await submitTransaction(transactionParams);
        return;
      }
      break;
    }
    case 'creator': {
      if (inscription.sender !== collection.issuer) {
        transactionParams.status = 'fail';
        transactionParams.failReason = 'not_collection_owner';
        console.warn(
          `mint operation failed: ${transactionParams.failReason}`,
          JSON.stringify(inscription),
        );
        await submitTransaction(transactionParams);
        return;
      }
      break;
    }
  }

  // Select last token_id within the collection
  const lastToken = await prisma.token.findFirst({
    where: {
      collection_id: collection.collection_id,
    },
    orderBy: {
      token_id: 'desc',
    },
  });
  // Get next token_id
  const nextTokenId = lastToken ? lastToken.token_id + 1 : 0;
  // Get token metadata uri
  const metadataUri =
    collection.ms_mode === 'creator'
      ? content.metadata!
      : `${collection.base_uri}${nextTokenId}.json`;
  // Fetch metadata
  const { ok, metadataJson } = await fetchMetadata(metadataUri);
  if (!ok) {
    transactionParams.status = 'fail';
    transactionParams.failReason = 'invalid_metadata';
    console.warn(
      `mint operation failed: ${transactionParams.failReason}`,
      JSON.stringify(inscription),
    );
    await submitTransaction(transactionParams);
    return;
  }
  let metadata: CollectionMetadata;
  try {
    metadata = TokenMetadataSchema.parse(metadataJson);
  } catch (e) {
    transactionParams.status = 'fail';
    transactionParams.failReason = 'invalid_metadata';
    console.warn(
      `mint operation failed: ${transactionParams.failReason}`,
      JSON.stringify(inscription),
    );
    await submitTransaction(transactionParams);
    return;
  }

  await submitTransaction(transactionParams, async (tx) => {
    await tx.token.create({
      data: {
        collection_id: collection.collection_id,
        token_id: nextTokenId,
        name: metadata.name,
        description: metadata.description,
        image: metadata.image,
        owner: inscription.sender,
        create_time: inscription.timestamp,
        update_time: inscription.timestamp,
      },
    });
  });
}

async function handleApprove(inscription: Inscription) {
  const content = inscription.content as ApproveContent;
  const transactionParams = buildTransactionParams(inscription, content.id);
  const { token, failReason } = await findTokenAndCheckOwner(
    transactionParams.collectionId,
    content.token_id,
    inscription.sender,
  );
  if (!token) {
    transactionParams.status = 'fail';
    transactionParams.failReason = failReason;
    console.warn(
      `approve operation failed: ${transactionParams.failReason}`,
      JSON.stringify(inscription),
    );
    await submitTransaction(transactionParams);
    return;
  }

  // Save approval to database and transaction
  await submitTransaction(transactionParams, async (tx) => {
    await tx.approval.create({
      data: {
        collection_id: content.id,
        token_id: content.token_id,
        approved: content.approved,
        status: 'normal',
        create_time: inscription.timestamp,
        update_time: inscription.timestamp,
      },
    });
  });
}

async function handleSend(inscription: Inscription) {
  const content = inscription.content as SendContent;
  const transactionParams = buildTransactionParams(inscription, content.id);
  const { token, failReason } = await findTokenAndCheckSendable(
    transactionParams.collectionId,
    content.token_id,
    inscription.sender,
  );
  if (!token) {
    transactionParams.status = 'fail';
    transactionParams.failReason = failReason;
    console.warn(
      `send operation failed: ${transactionParams.failReason}`,
      JSON.stringify(inscription),
    );
    await submitTransaction(transactionParams);
    return;
  }

  // Change token owner and revoke all approval
  await submitTransaction(transactionParams, async (tx) => {
    await tx.token.update({
      where: {
        collection_id_token_id: {
          collection_id: content.id,
          token_id: content.token_id,
        },
      },
      data: {
        owner: content.recipient,
        update_time: inscription.timestamp,
      },
    });
    await tx.approval.updateMany({
      where: {
        collection_id: content.id,
        token_id: content.token_id,
        status: 'normal',
      },
      data: {
        status: 'revoked',
        update_time: inscription.timestamp,
      },
    });
  });
}

async function handleBurn(inscription: Inscription) {
  const content = inscription.content as BurnContent;
  const transactionParams = buildTransactionParams(inscription, content.id);
  const { token, failReason } = await findTokenAndCheckOwner(
    transactionParams.collectionId,
    content.token_id,
    inscription.sender,
  );
  if (!token) {
    transactionParams.status = 'fail';
    transactionParams.failReason = failReason;
    console.warn(
      `burn operation failed: ${transactionParams.failReason}`,
      JSON.stringify(inscription),
    );
    await submitTransaction(transactionParams);
    return;
  }

  // Update token status to burned
  await submitTransaction(transactionParams, async (tx) => {
    await tx.token.update({
      where: {
        collection_id_token_id: {
          collection_id: content.id,
          token_id: content.token_id,
        },
      },
      data: {
        status: 'burned',
        update_time: inscription.timestamp,
      },
    });
  });
}

async function fetchMetadata(
  url: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ ok: boolean; metadataJson: any }> {
  const u = new URL(url);

  const fetchUrl =
    u.protocol === 'ipfs:'
      ? `${config.ipfsGateway}${u.pathname.replace('//', '')}`
      : url;

  const response = await fetch(fetchUrl);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
    return { ok: true, metadataJson: json };
  } catch (e) {
    return { ok: false, metadataJson: null };
  }
}

function buildCollectionId(inscription: Inscription) {
  return `${inscription.blockNumber}-${inscription.extrinsicIndex}`;
}

function buildTransactionParams(
  inscription: Inscription,
  collectionId: string,
): TransactionParams {
  return {
    inscription,
    collectionId: collectionId,
    status: 'success',
  };
}

async function submitTransaction(
  params: TransactionParams,
  fn?: (tx: PrismaTransactionClient) => Promise<void>,
): Promise<void> {
  const { inscription, collectionId, tokenId, status, failReason } = params;

  return await prisma.$transaction(async (tx) => {
    try {
      await tx.transaction.create({
        data: {
          op: inscription.content.op,
          content: inscription.rawContent,
          collection_id: collectionId,
          token_id: tokenId,
          block_number: inscription.blockNumber,
          extrinsic_hash: inscription.extrinsicHash,
          extrinsic_index: inscription.extrinsicIndex,
          sender: inscription.sender,
          status,
          fail_reason: failReason,
          create_time: inscription.timestamp,
        },
      });
    } catch (e) {
      // Ignore duplicate transaction error
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        return;
      }
      throw e;
    }

    if (fn && status == 'success') {
      await fn(tx);
    }
  });
}

async function findCollection(
  collectionId: string,
): Promise<{ collection?: Collection; failReason?: FailReason }> {
  const collection = await prisma.collection.findUnique({
    where: {
      collection_id: collectionId,
    },
  });
  if (!collection) {
    return { failReason: 'collection_not_found' };
  }

  return { collection };
}

async function findCollectionAndCheckOwner(
  collectionId: string,
  sender: string,
): Promise<{ collection?: Collection; failReason?: FailReason }> {
  const result = await findCollection(collectionId);
  if (result.failReason) {
    return result;
  }

  if (result.collection?.issuer !== sender) {
    return { failReason: 'not_collection_owner' };
  }

  return result;
}

async function findToken(
  collectionId: string,
  tokenId: number,
): Promise<{ token?: Token; failReason?: FailReason }> {
  const token = await prisma.token.findUnique({
    where: {
      collection_id_token_id: {
        collection_id: collectionId,
        token_id: tokenId,
      },
    },
  });
  if (!token) {
    return { failReason: 'token_not_found' };
  }
  if (token.status === 'burned') {
    return { failReason: 'token_burned' };
  }

  return { token };
}

async function findTokenAndCheckOwner(
  collectionId: string,
  tokenId: number,
  sender: string,
): Promise<{ token?: Token; failReason?: FailReason }> {
  const result = await findToken(collectionId, tokenId);
  if (result.failReason) {
    return result;
  }

  if (result.token?.owner !== sender) {
    return { failReason: 'not_token_owner' };
  }

  return result;
}

async function findTokenAndCheckSendable(
  collectionId: string,
  tokenId: number,
  sender: string,
): Promise<{ token?: Token; failReason?: FailReason }> {
  const result = await findTokenAndCheckOwner(collectionId, tokenId, sender);
  if (result.failReason) {
    return result;
  }

  // Check token approval, find latest approval record
  const approval = await prisma.approval.findFirst({
    where: {
      collection_id: collectionId,
      token_id: tokenId,
      status: 'normal',
    },
    orderBy: {
      id: 'desc',
    },
  });
  if (approval?.approved !== sender) {
    return { failReason: 'not_token_owner' };
  }

  return result;
}
