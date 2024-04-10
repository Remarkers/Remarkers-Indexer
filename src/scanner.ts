import { ApiPromise, WsProvider } from '@polkadot/api';
import { ApiDecoration } from '@polkadot/api/types';
import { Extrinsic } from '@polkadot/types/interfaces';
import { Config, Inscription, parseInscription } from './types.js';

class Scanner {
  config: Config;

  private api!: ApiPromise;

  constructor(config: Config) {
    this.config = config;
  }

  async init() {
    const wsProvider = new WsProvider(this.config.chainEndpoint);
    this.api = await ApiPromise.create({ provider: wsProvider });
  }

  async reconnect() {
    await this.api.disconnect();
    await this.init();
  }

  private async getHeadBlockNumber(): Promise<number> {
    const finalizedHead = await this.api.rpc.chain.getFinalizedHead();
    const header = await this.api.rpc.chain.getHeader(finalizedHead);
    return header.number.toNumber();
  }

  private async resolveBlock(number: number): Promise<Inscription[]> {
    const blockHash = await this.api.rpc.chain.getBlockHash(number);
    const signedBlock = await this.api.rpc.chain.getBlock(blockHash);
    if (!signedBlock.block.extrinsics.length) {
      return [];
    }
    const apiAt = await this.api.at(blockHash);
    const isSuccess = await this.isSuccessPredicate(apiAt);
    const blockTime = await this.getBlockTime(apiAt);
    return (
      await Promise.all(
        signedBlock.block.extrinsics.map((ex, ei) => {
          if (!isSuccess(ei)) {
            return;
          }

          try {
            const inscription = parseInscription(ex as unknown as Extrinsic);
            if (!inscription) {
              return;
            }
            inscription.blockNumber = number;
            inscription.extrinsicIndex = ei;
            inscription.timestamp = new Date(blockTime);
            return inscription;
          } catch (e) {
            console.warn('Failed to parse inscription', e);
          }
        }),
      )
    ).filter((e) => e) as Inscription[];
  }

  // eslint-disable-next-line no-unused-vars
  async scan(handler: (blockInscriptions: Inscription[]) => Promise<void>) {
    let current = this.config.scanStartBlock;
    let headBlockNumber = await this.getHeadBlockNumber();
    const startTime = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const diff = headBlockNumber - current;
        const blocksToScan = Math.min(diff, this.config.scanConcurrency);
        if (blocksToScan === 0) {
          // waiting for new blocks
          await new Promise((resolve) => setTimeout(resolve, 6000));
          headBlockNumber = await this.getHeadBlockNumber();
          continue;
        }
        const tasks = Array.from({ length: blocksToScan }, (_, i) =>
          this.resolveBlock(current + i),
        );

        const blockInscriptionsBatch = await Promise.all(tasks);
        for (const blockInscriptions of blockInscriptionsBatch) {
          if (!blockInscriptions.length) {
            continue;
          }
          await handler(blockInscriptions);
        }

        const used = (Date.now() - startTime) / 1000;
        const scaned = current - this.config.scanStartBlock;
        console.log(
          `scanning blocks ${current} to ${current + blocksToScan - 1}: head=${headBlockNumber}, progress=${(
            (current / headBlockNumber) *
            100
          ).toFixed(4)}%, used=${used.toFixed(2)}s, remaining=${(
            (used / scaned) *
            (headBlockNumber - current)
          ).toFixed(2)}s, speed=${(scaned / used).toFixed(2)} blocks/s`,
        );

        current += blocksToScan;
      } catch (error) {
        console.error('scan error', error);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await this.reconnect();
      }
    }
  }

  private async getBlockTime(apiAt: ApiDecoration<'promise'>): Promise<number> {
    return parseInt((await apiAt.query.timestamp.now()).toString());
  }

  private async isSuccessPredicate(
    apiAt: ApiDecoration<'promise'>,
  ): Promise<(extrinsicIndex: number) => boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (await apiAt.query.system.events()) as unknown as any[];
    return (extrinsicIndex: number) =>
      events
        .filter(
          ({ phase }) =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            phase.isApplyExtrinsic && phase.asApplyExtrinsic.eq(extrinsicIndex),
        )
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        .some(({ event }) => this.api.events.system.ExtrinsicSuccess.is(event));
  }
}

export default Scanner;
