import { Collection, PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import Scanner from './scanner.js';
import {
  AddwlContent,
  CollectionMetadata,
  CollectionMetadataSchema,
  Config,
  CreateContent,
  Inscription,
  MintContent,
  SendContent,
  TokenMetadataSchema,
} from './types.js';

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
  scanConcurrency: parseInt(process.env.SCAN_CONCURRENCY!),
  ipfsGateway: process.env.IPFS_GATEWAY!,
};

void (async function () {
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
  const metadataText = await fetchMetadata(content.metadata);
  let metadata: CollectionMetadata;
  try {
    metadata = CollectionMetadataSchema.parse(metadataText);
  } catch (e) {
    console.warn('create operation failed, invalid metadata', e);
    return;
  }

  // Save metadata to database and transaction
  const collectionId = buildCollectionId(inscription);
  await prisma.$transaction([
    prisma.collection.create({
      data: {
        collection_id: collectionId,
        name: metadata.name,
        description: metadata.description,
        image: metadata.image,
        issuer: inscription.sender,
        base_uri: content.base_uri,
        supply: content.supply,
        royalty: content.royalty,
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
    }),
    createTransaction(inscription, collectionId),
  ]);
}

async function handleAddwl(inscription: Inscription) {
  const content = inscription.content as AddwlContent;
  const collection = await findAndCheckCollection(
    buildCollectionId(inscription),
  );
  if (!collection) {
    console.warn('addwl operation failed, collection not found');
    return;
  }

  // save whitelist to database and transaction
  await prisma.$transaction([
    prisma.whitelist.createMany({
      data: content.data.map((address) => ({
        collection_id: collection.collection_id,
        address,
        create_time: inscription.timestamp,
      })),
    }),
    createTransaction(inscription, collection.collection_id),
  ]);
}

async function handleMint(inscription: Inscription) {
  const content = inscription.content as MintContent;
  const collection = await findAndCheckCollection(
    buildCollectionId(inscription),
  );
  if (!collection) {
    console.warn('mint operation failed, collection not found');
    return;
  }

  // check it is in mint block range
  if (
    (collection.ms_start ?? 0) > 0 &&
    inscription.blockNumber < collection.ms_start!
  ) {
    console.warn(
      'mint operation failed, current block less than start block',
      JSON.stringify(inscription),
    );
    return;
  }
  if (
    (collection.ms_end ?? 0) > 0 &&
    inscription.blockNumber > collection.ms_end!
  ) {
    console.warn(
      'mint operation failed, current block greater than end block',
      JSON.stringify(inscription),
    );
    return;
  }

  // check mint price
  if ((collection.ms_price ?? 0n) > 0n) {
  }

  // check user is exceed mint limit
  if ((collection.ms_limit ?? 0) > 0) {
    const mintedCount = await prisma.transaction.count({
      where: {
        collection_id: collection.collection_id,
        op: 'mint',
        sender: inscription.sender,
      },
    });
    if (mintedCount >= collection.ms_limit!) {
      console.warn('mint operation failed, exceed mint limit');
      return;
    }
  }

  // When collection mint mode is creator, metadata is required
  if (collection.ms_mode === 'creator' && !content.metadata) {
    console.warn(
      'metadata is required for creator mint mode',
      JSON.stringify(inscription),
    );
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
        console.warn('mint operation failed, not in whitelist');
        return;
      }
      break;
    }
    case 'creator': {
      if (inscription.sender !== collection.issuer) {
        console.warn('mint operation failed, not the issuer');
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
  const nextTokenId = lastToken ? lastToken.token_id + 1n : 0;
  // Get token metadata uri
  const metadataUri =
    collection.ms_mode === 'creator'
      ? content.metadata!
      : `${collection.base_uri}${nextTokenId}.json`;
  // Fetch metadata
  const metadataText = await fetchMetadata(metadataUri);
  let metadata: CollectionMetadata;
  try {
    metadata = TokenMetadataSchema.parse(metadataText);
  } catch (e) {
    console.warn('mint operation failed, invalid metadata', e);
    return;
  }

  await prisma.token.create({
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
}

async function handleSend(inscription: Inscription) {
  const content = inscription.content as SendContent;

  // Validate token and owner
  const token = await prisma.token.findUnique({
    where: {
      collection_id_token_id: {
        collection_id: buildCollectionId(inscription),
        token_id: content.token_id,
      },
    },
  });
  if (!token) {
    console.warn(
      'send operation failed, token not found',
      JSON.stringify(inscription),
    );
    return;
  }
  if (token?.owner !== inscription.sender) {
    console.warn(
      'send operation failed, invalid owner',
      JSON.stringify(inscription),
    );
    return;
  }

  // Update token owner
  await prisma.token.update({
    where: {
      collection_id_token_id: {
        collection_id: buildCollectionId(inscription),
        token_id: content.token_id,
      },
    },
    data: {
      owner: content.recipient,
      update_time: inscription.timestamp,
    },
  });
}

async function handleBurn(inscription: Inscription) {}

async function fetchMetadata(url: string): Promise<string> {
  const u = new URL(url);

  const fetchUrl =
    u.protocol === 'ipfs:'
      ? `${config.ipfsGateway}${u.pathname.replace('//', '')}`
      : url;

  const response = await fetch(fetchUrl);
  return await response.text();
}

function buildCollectionId(inscription: Inscription) {
  return `${inscription.blockNumber}-${inscription.extrinsicIndex}`;
}

function createTransaction(
  inscription: Inscription,
  collectionId: string,
  tokenId: bigint | undefined = undefined,
) {
  return prisma.transaction.create({
    data: {
      op: inscription.content.op,
      content: inscription.rawContent,
      collection_id: collectionId,
      token_id: tokenId,
      block_number: inscription.blockNumber,
      extrinsic_hash: inscription.extrinsicHash,
      extrinsic_index: inscription.extrinsicIndex,
      sender: inscription.sender,
      create_time: inscription.timestamp,
    },
  });
}

async function findAndCheckCollection(
  collectionId: string,
): Promise<Collection | undefined> {
  const collection = await prisma.collection.findUnique({
    where: {
      collection_id: collectionId,
    },
  });

  if (!collection) {
    return;
  }

  return collection;
}
