# Basic Concept

DOT-721 is a standard for non-fungible tokens (NFTs) on the Polkadot network. 

# Specification

## Global rules

1. Polkadot inscriptions operate by creating transactions of utility batchAll(calls) and are based on the parsing of the memo within the system remarkWithEvent(remark).
2. The `remark` context must be a valid JSON string.
3. All content is case insensitive, the indexer needs to convert the `remark` content to lowercase.
4. When the data type does not match is considered invalid inscription.
5. The `p` field is the standard identifier, it must be `dot-721`.
6. In addition to the fields specified by the operator, other fields in the `remark` context will not be recognized by the indexer. However, this transaction may still be a valid inscription operation and can be used to extend the protocol's usage in certain scenarios.
7. Only the first call in a batchAll(calls) is indexed, if the first call does not follow the specification, the entire transaction is considered invalid.

## Operators

### Create

Create a new NFT collection.

```json
{
  "p": "dot-721", // string(required)
  "op": "create", // string(required)
  "meta": "ipfs://ipfs/QmVgs8P4awhZpFXhkkgnCwBp4AdKRj3F9K58mCZ6fxvn3j", // string(required): metadata URI, JSON text, it can be IPFS URI or HTTP(s) URL
  "issuer": "0x1234567890abcdef", // string(optional): issuer address, if not set, it is the same as the sender, the account format need follow the SS58 format standard and use the address prefix(0) of the Polkadot network
  "supply": 1000, // number(optional): NFT total supply, if not set or <= 0, it can be minted without limit
  "royalty": 10, // number(optional): 
  "ms":{  // object(optional): Mint settings
    "type": "wl", // string(optional): mint type, wl: whitelist mode
    "start": 0, // number(optional) start block, if not set or <= 0, it can be minted immediately
    "end": 0, // number(optional) end block, if not set or <= 0, it can be minted forever
    "price": 0, // number(optional) price to mint, if not set or <= 0, it can be minted for free
    "limit": 0, // number(optional) limit of per account, if not set or <= 0, it can be minted without limit
  }
}
```

When indexer recognizes the `create` operation, it will create a new NFT collection by `Extrinsic ID` as the collection ID, such as `20006173-1`.

### Add Whitelist

When `ms.type` is `wl`, can add whitelist address by issuer.

```json
{
  "p": "dot-721", // string(required)
  "op": "addwl", // string(required)
  "id": "20006173-1", // string(required): NFT collection ID
  "data": ["0x1234567890abcdef", "0x1234567890abcdef"] // array(required): whitelist address
}
```

### Mint

Mint a new NFT.

```json
{
  "p": "dot-721", // string(required)
  "op": "mint", // string(required)
  "id": "20006173-1" // string(required): NFT collection ID
}
```