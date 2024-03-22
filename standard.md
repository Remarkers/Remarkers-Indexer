# Basic Concept

DOT-721 is a standard for non-fungible tokens (NFTs) on the Polkadot network. 

# Specification

## Global rules

1. Polkadot inscriptions operate by creating transactions of utility batchAll(calls) and are based on the parsing of the memo within the system remarkWithEvent(remark).
2. The `remark` context must be a valid JSON string.
3. All content is case insensitive, the indexer needs to convert the `remark` content to lowercase.
4. When the data type does not match is considered invalid inscription.
5. The `protocol` field is the standard identifier, it must be `DOT-721`.
6. In addition to the fields specified by the operator, other fields in the `remark` context will not be recognized by the indexer. However, this transaction may still be a valid inscription operation and can be used to extend the protocol's usage in certain scenarios.
7. Only the first call in a batchAll(calls) is indexed, if the first call does not follow the specification, the entire transaction is considered invalid.

## Operators

### Create

Create a new NFT collection.

```json
{
  "protocol": "DOT-721", // string(required)
  "operation": "create", // string(required)
  "metadata": "ipfs://ipfs/QmVgs8P4awhZpFXhkkgnCwBp4AdKRj3F9K58mCZ6fxvn3j", // string(required): metadata URI, JSON text, it can be IPFS URI or HTTP(s) URL collection logo profile
  "issuer": "0x1234567890abcdef", // string(optional): issuer address, if not set, it is the same as the sender, the account format need follow the SS58 format standard and use the address prefix(0) of the Polkadot network
  "supply": 1000, // number(optional): NFT total supply, if not set or <= 0, it can be minted without limit
  "royalty": 10, // number(optional): 
  "mint_settings":{  // object(optional): Mint settings
    "type": "whitelist", // string(optional): mint type, whitelist: whitelist mode
    "start": 0, // number(optional) start block, if not set or <= 0, it can be minted immediately
    "end": 0, // number(optional) end block, if not set or <= 0, it can be minted forever
    "price": 0, // number(optional) price to mint, if not set or <= 0, it can be minted for free
    "max_mint": 0, // number(optional) limit of per account, if not set or <= 0, it can be minted without limit
  }
}
```

When indexer recognizes the `create` operation, it will create a new NFT collection by `Extrinsic ID` as the collection ID, such as `20006173-1`.

### Add Whitelist

When `mint_settings.type` is `whitelist`, can add whitelist address by issuer.

```json
{
  "protocol": "DOT-721", // string(required)
  "operation": "modify_whitelist", // string(required)
  "id": "20006173-1", // string(required): NFT collection ID
  "data": ["0x1234567890abcdef", "0x1234567890abcdef"] // array(required): whitelist address
}
```
### Public mint
This operation will create a new collection which can be minted by anyone but only specified metadatas can be only minted

```json
{
  "protocol": "DOT-721", // string(required)
  "operation": "create", // string(required)
  "metadata": "ipfs://ipfs/QmVgs8P4awhZpFXhkkgnCwBp4AdKRj3F9K58mCZ6fxvn3j", // string(required): metadata URI, JSON text, it can be IPFS URI or HTTP(s) URL collection logo profile
  "issuer": "0x1234567890abcdef", // string(optional): issuer address, if not set, it is the same as the sender, the account format need follow the SS58 format standard and use the address prefix(0) of the Polkadot network
  "supply": 1000, // number(optional): NFT total supply, if not set or <= 0, it can be minted without limit
  "royalty": 10, // number(optional): 
  "mint_settings":{  // object(optional): Mint settings
    "type": "public", // string(optional): mint type, public: public mode anyone can mint the nft from collection
    "start": 0, // number(optional) start block, if not set or <= 0, it can be minted immediately
    "end": 0, // number(optional) end block, if not set or <= 0, it can be minted forever
    "price": 0, // number(optional) price to mint, if not set or <= 0, it can be minted for free
    "max_mint": 0, // number(optional) limit of per account, if not set or <= 0, it can be minted without limit
    "metadata": "ipfs://ipfs/bafybeicf7md3hsba3m2thhhnrfyct4dyu36bysw7ol7lw5agopf5vbxeqe" this a example json list which contains metadata for every nft specified this allows creator to restrict minter from minting spam nft with unknown metadata if someone mints any nft with two same ipfs urls metadata then the first one minted will be indexed with the help checking their timestamps and the other one will be spam nft
  }
}
```
### Creator mint
This operation will create a new collection which can be minted by only creator issuer

```json
{
  "protocol": "DOT-721", // string(required)
  "operation": "create", // string(required)
  "metadata": "ipfs://ipfs/QmVgs8P4awhZpFXhkkgnCwBp4AdKRj3F9K58mCZ6fxvn3j", // string(required): metadata URI, JSON text, it can be IPFS URI or HTTP(s) URL collection logo profile
  "issuer": "0x1234567890abcdef", // string(optional): issuer address, if not set, it is the same as the sender, the account format need follow the SS58 format standard and use the address prefix(0) of the Polkadot network
  "supply": 1000, // number(optional): NFT total supply, if not set or <= 0, it can be minted without limit
  "royalty": 10, // number(optional): 
  "mint_settings": null // null means no mint settings the creator will use the marketplace to create nft and sell them
}
```

### Mint

Mint a new NFT.can be only minted by the creator if specified or public mint or whitelist mint

```json
{
  "protocol": "DOT-721", // string(required)
  "operation": "mint", // string(required)
  "id": "20006173-1" // string(required): NFT collection ID
  "metadata": "ipfs://ipfs/QmavoTVbVHnGEUztnBT2p3rif3qBPeCfyyUE5v4Z7oFvs4" // ipfs url for the nft content
}
```

### Send
send an NFT this will transfer the nft from the current owner to the a new owner by checking the list of past owners transfers from the date of nft mint using the id specified if any tx seems inappropriate during this filter then the last owner (who is ending at the last filter of the indexer without causing any issue) will be the owner specified by the indexer
``` JSON
{
"protocol": "DOT-721", // string(required)
"operation": "send", //  string(required)
"id": "20006173-1_20006174-8", // string(required): NFT ID consisting of collection id 20006173 followed by nft extrinsic id in which nft minted 20006174-8 seprated by _
"recipient": "1HzwKkNGv4gdWq4ds1C5k63u8hvmjC6ULneAaZbwUBZEauF" // receiver address must be chain specified if you send to a wrong address who doesn't have existential balance or a wrong address then nft will be burned for ever or transaction will fail or may be recoreded but not fully received in case of nft sent to right chain address but without considering existential balance then it can be received once the receiver makes the account alive never send nft without a keep alive check in marketplace or without verifying the chain destination address
}

```
### Burn
Burn an NFT this operation will remove the NFT from being indexed by the indexer if this call gets excuted for any nft by it's owner it will not recovered again
```JSON
{
"protocol": "DOT-721", // string(required)
"operation": "burn", //  string(required)
"id": "20006173-1_20006174-8", // string(required): NFT ID consisting of collection id 20006173 followed by nft extrinsic id in which nft minted 20006174-8 seprated by _
}
```
