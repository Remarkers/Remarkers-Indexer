import { ApiPromise, WsProvider } from '@polkadot/api';

(async function () {
  const provider = new WsProvider('wss://rpc.polkadot.io');
  const api = await ApiPromise.create({ provider });

  const signedBlock = await api.rpc.chain.getBlock(
    '0x666ff7c64bd0cde5e031a1ca8c71e2bbfd64dcf26baf18e8bcaea29844ce0cf6',
  );
  const apiAt = await api.at(
    '0x666ff7c64bd0cde5e031a1ca8c71e2bbfd64dcf26baf18e8bcaea29844ce0cf6',
  );
  const events = await apiAt.query.system.events();

  events
    // find/filter for failed events
    .filter(({ event }) => api.events.system.ExtrinsicFailed.is(event))
    // we know that data for system.ExtrinsicFailed is
    // (DispatchError, DispatchInfo)
    .forEach(
      ({
        event: {
          data: [error, info],
        },
      }) => {
        if (error.isModule) {
          // for module errors, we have the section indexed, lookup
          const decoded = api.registry.findMetaError(error.asModule);
          const { docs, method, section } = decoded;

          console.log(`${section}.${method}: ${docs.join(' ')}`);
        } else {
          // Other, CannotLookup, BadOrigin, no extra info
          console.log(error.toString());
        }
      },
    );
})();
