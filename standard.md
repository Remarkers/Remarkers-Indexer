# Basic Concept

DOT-721 is a standard for non-fungible tokens (NFTs) on the Polkadot network.

# Specification

## Global rules

1. Polkadot `DOT-721` operate by creating transactions of utility batchAll(calls) and are based on the parsing of the memo within the system remarkWithEvent(remark).
2. The `Extrinsic` must be successful, i.e. the event contains a `system(ExtrinsicSuccess)` event.
3. The `remark` context must be a valid JSON string.
4. All content is case insensitive, the indexer needs to convert the `remark` content to lowercase.
5. When the data type does not match is considered invalid inscription.
6. The `p` field is the standard identifier, it must be `DOT-721`.
7. In addition to the fields specified by the operator, other fields in the `remark` context will not be recognized by the indexer. However, this transaction may still be a valid inscription operation and can be used to extend the protocol's usage in certain scenarios.
8. Only the first call in a batchAll(calls) is indexed, if the first call does not follow the specification, the entire transaction is considered invalid.
9. If mint price is set, the second call in a batchAll(calls) must be a transfer_keep_alive call to the creator address, the amount must be equal or greater than the mint price.

## NFT Collection Metadata JSON Schema

The metadata of the NFT collection is a JSON object, which must contain the following fields:

```json
{
  "name": "Polkadot Punks", // string(required): NFT collection name
  "description": "Polkadot Punks are the first ever nft collection to be Minted on Polkadot Network over 10,000 items will be minted in the collection", // string(optional): A human-readable description of the item.Markdown is supported.
  "image": "ipfs://QmXJUEVyrC6wUMfgHMe89Qv93pR3LazrvQMCPc9vjCSrL5" // string(required): NFT collection image URI, it can be IPFS URI or HTTP(s) URL
}
```

## NFT Token Metadata JSON Schema

The metadata of the NFT is a JSON object, which must contain the following fields:

```json
{
  "name": "Polkadot Punks  #1", // string(required): Name of the item.
  "description": "Polkadot Punks are the first ever nft collection to be Minted on Polkadot Network over 10,000 items will be minted in the collection", // string(optional): A human-readable description of the item. Markdown is supported.
  "image": "ipfs://QmXJUEVyrC6wUMfgHMe89Qv93pR3LazrvQMCPc9vjCSrL5", // string(required): NFT image URI, it can be IPFS URI or HTTP(s) URL
  "attributes": [
    // array(optional): These are the attributes for the item
    {
      "trait_type": "Background", // string(required): attribute name
      "value": "Blue" // string(required): attribute value
    }
  ]
}
```

## Operators

### Create

Create a new NFT collection.

```json
{
  "p": "dot-721", // string(required)
  "op": "create", // string(required)
  "metadata": "ipfs://QmXJUEVyrC6wUMfgHMe89Qv93pR3LazrvQMCPc9vjCSrL5", // string(required): metadata URI, follow the NFT Collection Metadata JSON Schema
  "issuer": "1HzwKkNGv4gdWq4ds1C5k63u8hvmjC6ULneAaZbwUBZEauF", // string(optional): issuer address, if not set, it is the same as the sender, the account format need follow the SS58 account format
  "base_uri": "ipfs://bafybeicf7md3hsba3m2thhhnrfyct4dyu36bysw7ol7lw5agopf5vbxeqe", // string(required): base uri for the nft content, it can be IPFS URI or HTTP(s) URL, it will be used to generate the nft uri such as `${base_uri}${token_id}.json`
  "supply": 1000, // number(optional): NFT total supply, if not set or <= 0, it can be minted without limit
  "mint_settings": {
    // object(optional): Mint settings
    "mode": "public", // string(optional): mint mode, support  public | whitelist | creator, default is public
    "start": 0, // number(optional) start block, if not set or <= 0, it can be minted immediately
    "end": 0, // number(optional) end block, if not set or <= 0, it can be minted forever
    "price": "1000000000", // string(optional) mint price to the creator, Planck unit, if not set or <= 0, it can be free mint
    "limit": 0 // number(optional) limit of per account, if not set or <= 0, it can be minted without limit
  }
}
```

When indexer recognizes the `create` operation, it will create a new NFT collection by `Extrinsic ID` as the collection ID, such as `20006173-1`.

#### Mint Settings Mode

- `public`: Public mint, anyone can mint the NFT from the collection.
- `whitelist`: Whitelist mint, only the specified address can mint, more detail please refer to the [Add Whitelist](#add-whitelist) operation.
- `creator`: Creator mint, only the NFT collection creator can mint.

### Add Whitelist

Only when mint mode is `whitelist`, can add whitelist address by issuer.

```json
{
  "p": "dot-721", // string(required)
  "op": "addwl", // string(required)
  "id": "20006173-1", // string(required): A created NFT collection ID
  "data": ["0x1234567890abcdef", "0x1234567890abcdef"] // array(required): whitelist address
}
```

### Mint

Mint a new NFT, can be only minted by the creator if specified or public mint or whitelist mint.

```json
{
  "p": "dot-721", // string(required)
  "op": "mint", // string(required)
  "id": "20006173-1", // string(required): A created NFT collection ID
  "metadata": "ipfs://QmXJUEVyrC6wUMfgHMe89Qv93pR3LazrvQMCPc9vjCSrL5" // string(optional): metadata URI, follow the NFT Token Metadata JSON Schema, only when mint mode is `creator` need to set
}
```

When mint successfully, the indexer will create a id for the NFT, incremental from 0, one by one, such as `0`, `1`, `2` until the supply limit.

### Approve

Change or reaffirm the approved address for an NFT, the approved address can transfer the NFT on behalf of the owner, only the NFT token owner can approve the address.

```json
{
  "p": "dot-721", // string(required)
  "op": "approve", // string(required)
  "id": "20006173-1", // string(required): A created NFT collection ID
  "token_id": 0, // number(required):  The new approved NFT controller
  "address": "1HzwKkNGv4gdWq4ds1C5k63u8hvmjC6ULneAaZbwUBZEauF" // string(optional): The new approved NFT controller, if not set, clear the approved address
}
```

### Send

Send an NFT this will transfer the nft from the current owner to the a new owner send transactions will be validate by checking all sends contaning same nft id and validating them one by one if any tx seems inappropriate during this filter then the last owner (who is ending at the last filter of the indexer without causing any issue) will be the owner specified by the indexer

```JSON
{
  "p": "dot-721", // string(required)
  "op": "send", //  string(required)
  "id": "20006173-1", // string(required): A created NFT collection ID
  "token_id": 0, // number(required): A minted NFT token ID.
  "from": "1HzwKkNGv4gdWq4ds1C5k63u8hvmjC6ULneAaZbwUBZEauF", // string(required): The current owner of the NFT
  "to": "1HzwKkNGv4gdWq4ds1C5k63u8hvmjC6ULneAaZbwUBZEauF" // string(required): receiver address must be chain specified if you send to a wrong address who doesn't have existential balance or a wrong address then nft will be burned for ever or transaction will fail or may be recoreded but not fully received in case of nft sent to right chain address but without considering existential balance then it can be received once the receiver makes the account alive never send nft without a keep alive check in marketplace or without verifying the chain destination address
}

```

When send successfully, indexer will clear the approved address for the NFT automatically.

### Burn

Burn an NFT this operation will remove the NFT from being indexed by the indexer if this call gets excuted for any nft by it's owner it will be not recovered again.

```JSON
{
  "p": "dot-721", // string(required)
  "op": "burn", //  string(required)
  "id": "20006173-1", // string(required): A created NFT collection ID
  "token_id": 0, // number(required): A minted NFT token ID.
}
```

Burn nft will be ignored by the indexer.
